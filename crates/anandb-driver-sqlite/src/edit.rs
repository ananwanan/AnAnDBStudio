//! Bounded optimistic edits for ordinary SQLite tables.
use crate::browse::{
    BrowseCell, BrowseError, BrowseErrorKind as Kind, FilterValue, Table, TableRequest,
    check_operation, read_row,
    table::{bind, identifier, schema_version},
};
use rusqlite::{Connection, ErrorCode, limits::Limit, params_from_iter, types::Value};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Arc, atomic::AtomicBool};
use std::time::Instant;

pub const MAX_EDIT_BYTES: usize = 1024 * 1024;
const MAX_CHANGES: usize = 256;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditInfo {
    pub schema_version: i64,
    pub read_only_reason: Option<&'static str>,
    pub writable: Vec<bool>,
    pub identity_columns: Vec<usize>,
    pub row_id_alias: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditRequest {
    pub schema_version: i64,
    pub changes: Vec<Change>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Change {
    Insert {
        values: Vec<ColumnValue>,
    },
    Update {
        target: OriginalRow,
        values: Vec<ColumnValue>,
    },
    Delete {
        target: OriginalRow,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OriginalRow {
    pub row_id: Option<String>,
    pub cells: Vec<BrowseCell>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColumnValue {
    pub column: usize,
    pub value: BrowseCell,
}

#[derive(Debug, Default, Serialize)]
pub struct EditResult {
    pub inserted: usize,
    pub updated: usize,
    pub deleted: usize,
}

struct Key {
    name: String,
    collation: String,
    index: Option<usize>,
}

pub(crate) struct Target {
    pub info: EditInfo,
    table: String,
    keys: Vec<Key>,
}

impl Target {
    pub(crate) fn inspect(
        db: &Connection,
        table: &str,
        columns: &[String],
        version: i64,
        without_rowid: bool,
    ) -> Result<Self, BrowseError> {
        let mut statement = db.prepare(
            "SELECT hidden, pk, type, \"notnull\" FROM pragma_table_xinfo(?1, 'main')
             WHERE hidden != 1 ORDER BY cid",
        )?;
        let columns_info = statement
            .query_map([table], |row| {
                Ok((
                    row.get::<_, i64>(0)? == 0,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut key_statement = db.prepare(
            "SELECT x.name, x.coll FROM pragma_index_list(?1, 'main') i
             JOIN pragma_index_xinfo(i.name, 'main') x
             WHERE i.origin = 'pk' AND x.key = 1 ORDER BY x.seqno",
        )?;
        let mut keys = Vec::new();
        let indexed_keys = key_statement
            .query_map([table], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if !without_rowid
            && indexed_keys.is_empty()
            && let Some(index) = columns_info
                .iter()
                .position(|(_, pk, ty, _)| *pk == 1 && ty.eq_ignore_ascii_case("INTEGER"))
        {
            keys.push(Key {
                name: columns[index].clone(),
                collation: "BINARY".into(),
                index: Some(index),
            });
        } else if !without_rowid
            && let Some(alias) = ["rowid", "_rowid_", "oid"]
                .into_iter()
                .find(|alias| !columns.iter().any(|name| name.eq_ignore_ascii_case(alias)))
        {
            keys.push(Key {
                name: alias.into(),
                collation: "BINARY".into(),
                index: None,
            });
        } else {
            for (name, collation) in indexed_keys {
                let Some(index) = columns.iter().position(|column| column == &name) else {
                    keys.clear();
                    break;
                };
                if !without_rowid && !columns_info[index].3 {
                    keys.clear();
                    break;
                }
                keys.push(Key {
                    name,
                    collation,
                    index: Some(index),
                });
            }
        }
        let identity_exceeds_limit = keys.iter().any(|key| key.index.is_none())
            && columns.len() >= db.limit(Limit::SQLITE_LIMIT_COLUMN)? as usize;
        if identity_exceeds_limit {
            keys.clear();
        }
        let read_only_reason = if db.is_readonly("main")? || pragma_flag(db, "query_only")? {
            Some("connection")
        } else if identity_exceeds_limit {
            Some("width")
        } else if keys.is_empty() {
            Some("identity")
        } else {
            None
        };
        let info = EditInfo {
            schema_version: version,
            read_only_reason,
            writable: columns_info.iter().map(|entry| entry.0).collect(),
            identity_columns: keys.iter().filter_map(|key| key.index).collect(),
            row_id_alias: keys
                .iter()
                .find(|key| key.index.is_none())
                .map(|key| key.name.clone()),
        };
        Ok(Self {
            info,
            table: table.into(),
            keys,
        })
    }

    pub fn implicit_rowid(&self) -> Option<&str> {
        self.info.row_id_alias.as_deref()
    }

    pub(crate) fn apply(
        &self,
        db: &mut Connection,
        request: EditRequest,
        deadline: Instant,
        closed: &Arc<AtomicBool>,
        cancelled: &Arc<AtomicBool>,
    ) -> Result<EditResult, BrowseError> {
        let check = || check_operation(deadline, closed, cancelled);
        check()?;
        if request.changes.is_empty() || request.changes.len() > MAX_CHANGES {
            return Err(BrowseError::invalid(
                "An edit batch must contain 1–256 changes",
            ));
        }
        if !db.is_autocommit() {
            return Err(BrowseError::new(
                Kind::EditTransactionOpen,
                "Finish the SQL editor transaction before saving grid changes",
            ));
        }
        if db.is_readonly("main").map_err(sql_error)?
            || pragma_flag(db, "query_only").map_err(sql_error)?
        {
            return Err(read_only());
        }
        let journal: String = db
            .query_row("PRAGMA main.journal_mode", [], |row| row.get(0))
            .map_err(sql_error)?;
        let synchronous: i64 = db
            .query_row("PRAGMA main.synchronous", [], |row| row.get(0))
            .map_err(sql_error)?;
        if journal == "off" || journal == "memory" || synchronous == 0 {
            return Err(BrowseError::new(
                Kind::EditReadOnly,
                "Grid saves require an on-disk rollback journal or WAL with synchronous enabled",
            ));
        }
        // Enforce relational constraints for grid writes and restore the SQL IDE settings afterward.
        let foreign_keys = pragma_flag(db, "foreign_keys").map_err(sql_error)?;
        let ignore_checks = pragma_flag(db, "ignore_check_constraints").map_err(sql_error)?;
        let result = (|| {
            db.pragma_update(None, "foreign_keys", true)
                .map_err(sql_error)?;
            db.pragma_update(None, "ignore_check_constraints", false)
                .map_err(sql_error)?;
            let close_flag = Arc::clone(closed);
            let cancel_flag = Arc::clone(cancelled);
            db.progress_handler(
                1000,
                Some(move || check_operation(deadline, &close_flag, &cancel_flag).is_err()),
            )
            .map_err(sql_error)?;
            let result = (|| {
                db.execute_batch("BEGIN IMMEDIATE").map_err(sql_error)?;
                check()?;
                if schema_version(db).map_err(sql_error)? != request.schema_version
                    || request.schema_version != self.info.schema_version
                {
                    return Err(BrowseError::new(
                        Kind::EditSchemaChanged,
                        "SQLite schema changed after editing began",
                    ));
                }
                let (table, columns) = Table::open(
                    db,
                    TableRequest {
                        schema: "main".into(),
                        table: self.table.clone(),
                        sort: None,
                        filter: None,
                    },
                )?;
                if table.editing.info.read_only_reason.is_some() {
                    return Err(read_only());
                }
                table
                    .editing
                    .apply_changes(db, &columns, request.changes, &check)
            })();
            // Disable interruption before rollback. Check cancellation once more before COMMIT.
            db.progress_handler(0, None::<fn() -> bool>)
                .map_err(|_| unknown())?;
            let result = check().and(result).and_then(|result| {
                db.execute_batch("COMMIT").map_err(|error| {
                    if db.is_autocommit()
                        && matches!(error.sqlite_error_code(), Some(ErrorCode::SystemIoFailure))
                    {
                        return unknown();
                    }
                    sql_error(error)
                })?;
                Ok(result)
            });
            if result.is_err() && !db.is_autocommit() && db.execute_batch("ROLLBACK").is_err() {
                return Err(unknown());
            }
            result
        })();
        let restore_fk = db.pragma_update(None, "foreign_keys", foreign_keys);
        let restore_checks = db.pragma_update(None, "ignore_check_constraints", ignore_checks);
        if restore_fk.is_err() || restore_checks.is_err() {
            // An acknowledged COMMIT remains committed even if restoring settings fails.
            return result.map_err(|_| unknown());
        }
        result
    }

    fn apply_changes(
        &self,
        db: &Connection,
        columns: &[String],
        changes: Vec<Change>,
        check: &impl Fn() -> Result<(), BrowseError>,
    ) -> Result<EditResult, BrowseError> {
        let table = format!("main.{}", identifier(&self.table));
        let fields = columns
            .iter()
            .map(|name| identifier(name))
            .collect::<Vec<_>>();
        let selection = fields.join(", ");
        let mut seen = HashSet::new();
        let mut counts = EditResult::default();
        for (index, change) in changes.into_iter().enumerate() {
            check()?;
            let result = (|| {
                let (sql, params, count) = match change {
                    Change::Insert { values } => {
                        let (columns, params) = self.assignments(&fields, values)?;
                        let sql = if columns.is_empty() {
                            format!("INSERT OR ABORT INTO {table} DEFAULT VALUES")
                        } else {
                            let slots = vec!["?"; columns.len()].join(", ");
                            format!(
                                "INSERT OR ABORT INTO {table} ({}) VALUES ({slots})",
                                columns.join(", ")
                            )
                        };
                        (sql, params, &mut counts.inserted)
                    }
                    Change::Update { target, values } => {
                        let (predicate, keys, identity) =
                            self.locate(db, &table, &selection, target)?;
                        if !seen.insert(identity) || values.is_empty() {
                            return Err(BrowseError::invalid("Duplicate target or empty UPDATE"));
                        }
                        let (columns, mut params) = self.assignments(&fields, values)?;
                        let assignments = columns
                            .iter()
                            .map(|column| format!("{column} = ?"))
                            .collect::<Vec<_>>()
                            .join(", ");
                        params.extend(keys);
                        (
                            format!("UPDATE OR ABORT {table} SET {assignments} WHERE {predicate}"),
                            params,
                            &mut counts.updated,
                        )
                    }
                    Change::Delete { target } => {
                        let (predicate, params, identity) =
                            self.locate(db, &table, &selection, target)?;
                        if !seen.insert(identity) {
                            return Err(BrowseError::invalid("Duplicate target"));
                        }
                        (
                            format!("DELETE FROM {table} WHERE {predicate}"),
                            params,
                            &mut counts.deleted,
                        )
                    }
                };
                let mut statement = db.prepare(&sql).map_err(sql_error)?;
                let mut rows = statement
                    .query(params_from_iter(params))
                    .map_err(sql_error)?;
                // PRAGMA count_changes may cause a DML statement to yield a row.
                while rows.next().map_err(sql_error)?.is_some() {}
                if db.changes() != 1 {
                    return Err(BrowseError::new(
                        Kind::EditAffectedRows,
                        "SQLite did not affect exactly one target row",
                    ));
                }
                *count += 1;
                Ok(())
            })();
            result.map_err(|error| {
                BrowseError::new(
                    error.kind,
                    format!("Change {}: {}", index + 1, error.message),
                )
            })?;
        }
        Ok(counts)
    }

    fn assignments(
        &self,
        fields: &[String],
        values: Vec<ColumnValue>,
    ) -> Result<(Vec<String>, Vec<Value>), BrowseError> {
        if values.len() > fields.len() {
            return Err(BrowseError::invalid("Too many column assignments"));
        }
        let mut seen = HashSet::new();
        let mut columns = Vec::with_capacity(values.len());
        let mut params = Vec::with_capacity(values.len());
        for entry in values {
            if self.info.writable.get(entry.column) != Some(&true) || !seen.insert(entry.column) {
                return Err(BrowseError::invalid(
                    "Column is unknown, duplicated or read-only",
                ));
            }
            columns.push(fields[entry.column].clone());
            params.push(write_value(entry.value)?);
        }
        Ok((columns, params))
    }

    fn locate(
        &self,
        db: &Connection,
        table: &str,
        selection: &str,
        original: OriginalRow,
    ) -> Result<(String, Vec<Value>, String), BrowseError> {
        if original.cells.len() != self.info.writable.len()
            || original.cells.iter().any(|cell| {
                matches!(
                    cell,
                    BrowseCell::TextPreview { .. }
                        | BrowseCell::BlobPreview { .. }
                        | BrowseCell::TextBytesPreview { .. }
                )
            })
            || original.row_id.is_some() != self.implicit_rowid().is_some()
        {
            return Err(BrowseError::invalid(
                "A complete original row and its identity are required",
            ));
        }
        let mut terms = Vec::new();
        let mut params = Vec::new();
        let mut identity = Vec::new();
        for key in &self.keys {
            let cell = match key.index {
                Some(index) => original.cells[index].clone(),
                None => {
                    let value = original.row_id.as_deref().unwrap_or_default();
                    if !value.parse::<i64>().is_ok_and(|id| id.to_string() == value) {
                        return Err(BrowseError::invalid("Invalid SQLite rowid"));
                    }
                    BrowseCell::Integer {
                        value: value.into(),
                    }
                }
            };
            let (value, slot) = match &cell {
                BrowseCell::TextBytes { value } => {
                    (bind(FilterValue::Blob(value.clone()))?, "CAST(? AS TEXT)")
                }
                BrowseCell::Real { value } if value == "inf" => (Value::Real(f64::INFINITY), "?"),
                BrowseCell::Real { value } if value == "-inf" => {
                    (Value::Real(f64::NEG_INFINITY), "?")
                }
                BrowseCell::Null => {
                    return Err(BrowseError::invalid("A row identity cannot be NULL"));
                }
                _ => (write_value(cell.clone())?, "?"),
            };
            terms.push(format!(
                "{} COLLATE {} = {slot}",
                identifier(&key.name),
                identifier(&key.collation)
            ));
            params.push(value);
            identity.push(cell);
        }
        let predicate = terms.join(" AND ");
        let mut statement = db
            .prepare(&format!(
                "SELECT {selection} FROM {table} WHERE {predicate} LIMIT 2"
            ))
            .map_err(sql_error)?;
        let mut rows = statement
            .query(params_from_iter(&params))
            .map_err(sql_error)?;
        let row = rows.next().map_err(sql_error)?.ok_or_else(|| {
            BrowseError::new(Kind::EditRowMissing, "The original row no longer exists")
        })?;
        if read_row(row, original.cells.len())? != original.cells
            || rows.next().map_err(sql_error)?.is_some()
        {
            return Err(BrowseError::new(
                Kind::EditRowChanged,
                "The original row has changed or is no longer unique",
            ));
        }
        let identity = serde_json::to_string(&identity)
            .map_err(|_| BrowseError::invalid("Invalid row identity"))?;
        Ok((predicate, params, identity))
    }
}

fn write_value(cell: BrowseCell) -> Result<Value, BrowseError> {
    match cell {
        BrowseCell::Null => Ok(Value::Null),
        BrowseCell::Integer { value } => bind(FilterValue::Integer(value)),
        BrowseCell::Real { value } => bind(FilterValue::Real(value)),
        BrowseCell::Text { value } => bind(FilterValue::Text(value)),
        BrowseCell::Blob { value } => bind(FilterValue::Blob(value)),
        _ => Err(BrowseError::invalid(
            "Only complete SQLite write values are accepted",
        )),
    }
}

fn pragma_flag(db: &Connection, name: &str) -> rusqlite::Result<bool> {
    db.pragma_query_value(None, name, |row| row.get(0))
}

fn read_only() -> BrowseError {
    BrowseError::new(
        Kind::EditReadOnly,
        "This SQLite table or connection is read-only",
    )
}

pub(crate) fn unknown() -> BrowseError {
    BrowseError::new(
        Kind::EditUnknown,
        "Commit outcome is uncertain. Verify the database before retrying",
    )
}

fn sql_error(error: rusqlite::Error) -> BrowseError {
    let kind = match error.sqlite_error_code() {
        Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => Kind::EditBusy,
        Some(ErrorCode::ConstraintViolation) => Kind::EditConstraint,
        Some(ErrorCode::ReadOnly) => Kind::EditReadOnly,
        Some(ErrorCode::SchemaChanged) => Kind::EditSchemaChanged,
        _ => Kind::Failed,
    };
    BrowseError::new(kind, error.to_string())
}
