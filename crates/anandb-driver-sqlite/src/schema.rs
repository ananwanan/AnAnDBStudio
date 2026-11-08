//! Bounded, read-only SQLite schema discovery.
//!
//! Names are always passed as bound parameters, never interpolated as SQL.

use rusqlite::Connection;
use serde::Serialize;

use crate::SqliteError;

pub const MAX_SCHEMA_OBJECTS: usize = 2048;
pub const MAX_COLUMNS_PER_OBJECT: usize = 2048;
pub const MAX_SCHEMA_COLUMNS: usize = 16384;
pub const MAX_METADATA_TEXT_BYTES: usize = 65536;
pub const MAX_SCHEMA_TEXT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SchemaObjectKind {
    Table,
    View,
    Index,
    Trigger,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaColumn {
    pub cid: i64,
    pub name: String,
    pub declared_type: String,
    pub not_null: bool,
    pub default_sql: Option<String>,
    pub primary_key_position: i64,
    /// 0 = normal, 1 = hidden virtual-table column, 2/3 = generated.
    pub hidden: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObject {
    pub kind: SchemaObjectKind,
    pub name: String,
    pub table_name: String,
    /// Only table/view objects have column metadata in M1.3.
    pub columns: Vec<SchemaColumn>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaSnapshot {
    pub schema: String,
    pub objects: Vec<SchemaObject>,
}

fn check_text(value: &str, used: &mut usize) -> Result<(), SqliteError> {
    if value.len() > MAX_METADATA_TEXT_BYTES
        || *used > MAX_SCHEMA_TEXT_BYTES.saturating_sub(value.len())
    {
        return Err(SqliteError::SchemaLimitExceeded(
            "SQLite schema metadata field exceeds the size limit",
        ));
    }
    *used += value.len();
    Ok(())
}

pub(crate) fn read_main_schema(connection: &mut Connection) -> Result<SchemaSnapshot, SqliteError> {
    // Keep object enumeration and per-table column discovery on one snapshot.
    // A DEFERRED read transaction also works for read-only SQLite handles.
    let transaction = connection.transaction().map_err(SqliteError::Database)?;
    let mut objects = Vec::new();
    let mut text_bytes = 0usize;

    {
        let mut statement = transaction
            .prepare(
                "SELECT type, name, tbl_name
                 FROM main.sqlite_schema
                 WHERE type IN ('table', 'view', 'index', 'trigger')
                 ORDER BY CASE type
                    WHEN 'table' THEN 0 WHEN 'view' THEN 1
                    WHEN 'index' THEN 2 ELSE 3 END,
                    name COLLATE BINARY
                 LIMIT ?1",
            )
            .map_err(SqliteError::Database)?;
        let mut rows = statement
            .query([MAX_SCHEMA_OBJECTS as i64 + 1])
            .map_err(SqliteError::Database)?;

        while let Some(row) = rows.next().map_err(SqliteError::Database)? {
            if objects.len() == MAX_SCHEMA_OBJECTS {
                return Err(SqliteError::SchemaLimitExceeded(
                    "SQLite schema has too many objects",
                ));
            }

            let raw_kind: String = row.get(0).map_err(SqliteError::Database)?;
            let kind = match raw_kind.as_str() {
                "table" => SchemaObjectKind::Table,
                "view" => SchemaObjectKind::View,
                "index" => SchemaObjectKind::Index,
                "trigger" => SchemaObjectKind::Trigger,
                _ => return Err(SqliteError::Database(rusqlite::Error::InvalidQuery)),
            };
            let name: String = row.get(1).map_err(SqliteError::Database)?;
            let table_name: String = row.get(2).map_err(SqliteError::Database)?;
            check_text(&name, &mut text_bytes)?;
            check_text(&table_name, &mut text_bytes)?;
            objects.push(SchemaObject {
                kind,
                name,
                table_name,
                columns: Vec::new(),
            });
        }
    }

    let mut total_columns = 0usize;
    // The table-valued PRAGMA accepts bound table names (including quotes).
    // The second parameter pins discovery to "main" rather than TEMP.
    for object in &mut objects {
        if !matches!(
            object.kind,
            SchemaObjectKind::Table | SchemaObjectKind::View
        ) {
            continue;
        }

        let mut statement = transaction
            .prepare(
                "SELECT cid, name, type, \"notnull\", dflt_value, pk, hidden
                 FROM pragma_table_xinfo(?1, ?2)
                 ORDER BY cid",
            )
            .map_err(SqliteError::Database)?;
        let mut rows = statement
            .query(rusqlite::params![object.name, "main"])
            .map_err(SqliteError::Database)?;
        while let Some(row) = rows.next().map_err(SqliteError::Database)? {
            if object.columns.len() == MAX_COLUMNS_PER_OBJECT || total_columns == MAX_SCHEMA_COLUMNS
            {
                return Err(SqliteError::SchemaLimitExceeded(
                    "SQLite schema has too many columns",
                ));
            }
            let name: String = row.get(1).map_err(SqliteError::Database)?;
            let declared_type: String = row.get(2).map_err(SqliteError::Database)?;
            let default_sql: Option<String> = row.get(4).map_err(SqliteError::Database)?;
            check_text(&name, &mut text_bytes)?;
            check_text(&declared_type, &mut text_bytes)?;
            if let Some(value) = &default_sql {
                check_text(value, &mut text_bytes)?;
            }
            let not_null: i64 = row.get(3).map_err(SqliteError::Database)?;
            object.columns.push(SchemaColumn {
                cid: row.get(0).map_err(SqliteError::Database)?,
                name,
                declared_type,
                not_null: not_null != 0,
                default_sql,
                primary_key_position: row.get(5).map_err(SqliteError::Database)?,
                hidden: row.get(6).map_err(SqliteError::Database)?,
            });
            total_columns += 1;
        }
    }

    transaction.commit().map_err(SqliteError::Database)?;
    Ok(SchemaSnapshot {
        schema: "main".to_owned(),
        objects,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{OpenMode, SqliteDatabase};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    struct Fixture {
        dir: PathBuf,
        file: PathBuf,
    }

    impl Fixture {
        fn new(sql: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock is valid")
                .as_nanos();
            let dir = std::env::temp_dir().join(format!(
                "anandb-m13-{}-{}-{nanos}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&dir).unwrap();
            let file = dir.join("schema.sqlite");
            let db = Connection::open(&file).unwrap();
            db.execute_batch(sql).unwrap();
            drop(db);
            Self { dir, file }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn discovers_quoted_names_indexes_triggers_views_and_generated_columns() {
        let fixture = Fixture::new(
            r#"
            CREATE TABLE "a""b" (
                id INTEGER PRIMARY KEY,
                "v""x" TEXT NOT NULL DEFAULT 'x',
                derived TEXT GENERATED ALWAYS AS ("v""x" || '!') STORED
            );
            CREATE INDEX "i""x" ON "a""b"("v""x");
            CREATE VIEW "v""q" AS SELECT id AS "we""ird" FROM "a""b";
            CREATE TRIGGER "tr""x" AFTER INSERT ON "a""b"
                BEGIN SELECT 1; END;
            "#,
        );
        let mut db = SqliteDatabase::open_existing(&fixture.file, OpenMode::ReadOnly).unwrap();
        let snapshot = db.read_schema().unwrap();
        assert_eq!(snapshot.schema, "main");
        assert_eq!(snapshot.objects.len(), 4);

        let table = &snapshot.objects[0];
        assert_eq!(table.kind, SchemaObjectKind::Table);
        assert_eq!(table.name, "a\"b");
        assert_eq!(table.columns.len(), 3);
        assert_eq!(table.columns[0].primary_key_position, 1);
        assert_eq!(table.columns[1].name, "v\"x");
        assert!(table.columns[1].not_null);
        assert_eq!(table.columns[1].default_sql.as_deref(), Some("'x'"));
        assert_eq!(table.columns[2].hidden, 3);

        let view = &snapshot.objects[1];
        assert_eq!(view.kind, SchemaObjectKind::View);
        assert_eq!(view.name, "v\"q");
        assert_eq!(view.columns[0].name, "we\"ird");
        assert_eq!(snapshot.objects[2].kind, SchemaObjectKind::Index);
        assert_eq!(snapshot.objects[2].table_name, "a\"b");
        assert!(snapshot.objects[2].columns.is_empty());
        assert_eq!(snapshot.objects[3].kind, SchemaObjectKind::Trigger);
        assert_eq!(snapshot.objects[3].table_name, "a\"b");
        db.close().unwrap();
    }

    #[test]
    fn includes_without_rowid_composite_keys_and_internal_autoindexes() {
        let fixture = Fixture::new(
            "CREATE TABLE composite (first TEXT, second INTEGER, PRIMARY KEY(first, second)) WITHOUT ROWID;
             CREATE TABLE unique_items (code TEXT UNIQUE);",
        );
        let mut db = SqliteDatabase::open_existing(&fixture.file, OpenMode::ReadWrite).unwrap();
        let snapshot = db.read_schema().unwrap();
        let composite = snapshot
            .objects
            .iter()
            .find(|o| o.name == "composite")
            .unwrap();
        assert_eq!(composite.columns[0].primary_key_position, 1);
        assert_eq!(composite.columns[1].primary_key_position, 2);
        assert!(snapshot.objects.iter().any(|o| {
            o.kind == SchemaObjectKind::Index && o.name.starts_with("sqlite_autoindex_")
        }));
        db.close().unwrap();
    }

    #[test]
    fn rejects_oversized_metadata_without_truncating_it() {
        let huge = "x".repeat(MAX_METADATA_TEXT_BYTES + 1);
        let sql = format!("CREATE TABLE \"{huge}\" (id INTEGER);");
        let fixture = Fixture::new(&sql);
        let mut db = SqliteDatabase::open_existing(&fixture.file, OpenMode::ReadOnly).unwrap();
        assert!(matches!(
            db.read_schema(),
            Err(SqliteError::SchemaLimitExceeded(_))
        ));
        db.close().unwrap();
    }
}
