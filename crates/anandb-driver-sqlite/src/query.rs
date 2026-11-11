//! Bounded SQL execution on a connection-owned worker. No Tauri dependencies.
use crate::browse::{BrowseError, ResultInfo, SnapshotWriter, Source};
use fallible_iterator::FallibleIterator;
use rusqlite::{
    Batch, Connection,
    hooks::{AuthAction, AuthContext, Authorization},
    types::ValueRef,
};
use serde::Serialize;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};

pub const MAX_SQL_BYTES: usize = 256 * 1024;
const MAX_STATEMENTS: usize = 100;
const MAX_ROWS: usize = 200;
const MAX_BYTES: usize = 1024 * 1024;
const MAX_CELL_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum Cell {
    Null,
    Integer(String),
    Real(String),
    Text(String),
    Blob(String),
    TextBytes(String),
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementResult {
    pub index: usize,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Cell>>,
    pub affected_rows: String,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_result: Option<ResultInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_result_error: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryFailure {
    pub message: String,
    pub statement_index: usize,
    pub offset: usize,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub statements: Vec<StatementResult>,
    pub error: Option<QueryFailure>,
    pub status: String,
    pub elapsed_ms: u64,
    pub transaction_open: bool,
    pub rolled_back: bool,
}

pub(crate) fn configure(connection: &mut Connection) -> rusqlite::Result<()> {
    connection.busy_timeout(Duration::from_millis(100))?;
    // SQL may only access databases opened through the connection API. This also
    // blocks VACUUM INTO, whose internal ATTACH would otherwise create a file.
    connection.authorizer(Some(|ctx: AuthContext<'_>| match ctx.action {
        AuthAction::Attach { .. } | AuthAction::Detach { .. } => Authorization::Deny,
        AuthAction::Pragma { pragma_name, .. }
            if [
                "busy_timeout",
                "writable_schema",
                "temp_store_directory",
                "data_store_directory",
            ]
            .iter()
            .any(|name| pragma_name.eq_ignore_ascii_case(name)) =>
        {
            Authorization::Deny
        }
        _ => Authorization::Allow,
    }))
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(output, "{byte:02x}");
    }
    output
}

fn cell(value: ValueRef<'_>) -> Result<(Cell, usize), String> {
    Ok(match value {
        ValueRef::Null => (Cell::Null, 16),
        ValueRef::Integer(value) => (Cell::Integer(value.to_string()), 48),
        ValueRef::Real(value) => (Cell::Real(value.to_string()), 64),
        ValueRef::Text(bytes) | ValueRef::Blob(bytes) if bytes.len() > MAX_CELL_BYTES => {
            return Err(
                "Cell exceeds the 16 KiB preview limit; select a smaller value with substr()."
                    .into(),
            );
        }
        ValueRef::Text(bytes) => match std::str::from_utf8(bytes) {
            Ok(value) => (Cell::Text(value.into()), bytes.len() * 6 + 32),
            Err(_) => (Cell::TextBytes(hex(bytes)), bytes.len() * 2 + 32),
        },
        ValueRef::Blob(bytes) => (Cell::Blob(hex(bytes)), bytes.len() * 2 + 32),
    })
}

pub(crate) fn execute(
    connection: &mut Connection,
    sql: &str,
    cancel: Arc<AtomicBool>,
    timeout_ms: u64,
) -> QueryResult {
    execute_inner(connection, sql, cancel, timeout_ms, None)
}

pub(crate) fn execute_capturing(
    connection: &mut Connection,
    sql: &str,
    cancel: Arc<AtomicBool>,
    timeout_ms: u64,
    mut publish: impl FnMut(Vec<String>, Source) -> Result<ResultInfo, BrowseError>,
) -> QueryResult {
    execute_inner(connection, sql, cancel, timeout_ms, Some(&mut publish))
}

type PublishResult<'a> = &'a mut dyn FnMut(Vec<String>, Source) -> Result<ResultInfo, BrowseError>;

fn execute_inner(
    connection: &mut Connection,
    sql: &str,
    cancel: Arc<AtomicBool>,
    timeout_ms: u64,
    mut publish: Option<PublishResult<'_>>,
) -> QueryResult {
    let started = Instant::now();
    let deadline = started + Duration::from_millis(timeout_ms);
    let flag = Arc::clone(&cancel);
    let mut result = QueryResult {
        statements: vec![],
        error: None,
        status: "completed".into(),
        elapsed_ms: 0,
        transaction_open: false,
        rolled_back: false,
    };
    let progress = connection.progress_handler(
        1000,
        Some(move || flag.load(Ordering::Relaxed) || Instant::now() >= deadline),
    );
    let mut offset = 0;
    let mut used = 0;
    let run = (|| -> Result<(), String> {
        progress.map_err(|e| e.to_string())?;
        let mut batch = Batch::new(connection, sql);
        loop {
            if cancel.load(Ordering::Relaxed) || Instant::now() >= deadline {
                return Err("Execution interrupted".into());
            }
            let mut statement = match batch.next() {
                Ok(Some(statement)) => statement,
                Ok(None) => break,
                Err(error) => {
                    if let rusqlite::Error::SqlInputError {
                        sql: fragment,
                        offset: at,
                        ..
                    } = &error
                        && sql.ends_with(fragment)
                        && *at >= 0
                    {
                        offset = sql.len() - fragment.len() + *at as usize;
                    }
                    return Err(error.to_string());
                }
            };
            if result.statements.len() >= MAX_STATEMENTS {
                return Err("Script exceeds 100 statements".into());
            }
            if statement.parameter_count() != 0 {
                return Err(
                    "Unbound SQL parameters are not supported; provide literal SQL values.".into(),
                );
            }
            let original = statement.expanded_sql().unwrap_or_default();
            if let Some(at) = sql[offset..].find(&original) {
                offset += at;
            }
            let next_offset = offset + original.len();
            let columns: Vec<String> = statement.column_names().map(str::to_owned).collect();
            if columns.len() > if publish.is_some() { 2048 } else { 128 } {
                return Err("Result exceeds the column limit".into());
            }
            used += columns.iter().map(|c| c.len() * 6 + 32).sum::<usize>();
            if used > MAX_BYTES {
                return Err("Result exceeds the 1 MiB preview budget".into());
            }
            let before = connection.total_changes();
            let read_only = statement.readonly();
            let mut output = StatementResult {
                index: result.statements.len(),
                columns,
                rows: vec![],
                affected_rows: "0".into(),
                truncated: false,
                full_result: None,
                full_result_error: None,
            };
            let mut capture = None;
            if read_only && !output.columns.is_empty() && publish.is_some() {
                match SnapshotWriter::new() {
                    Ok(writer) => capture = Some(writer),
                    Err(error) => output.full_result_error = Some(error.message),
                }
            }
            let requested_capture = capture.is_some() || output.full_result_error.is_some();
            {
                let mut rows = statement.query([]).map_err(|e| e.to_string())?;
                while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                    if cancel.load(Ordering::Relaxed) || Instant::now() >= deadline {
                        return Err("Execution interrupted".into());
                    }
                    if let Some(writer) = &mut capture
                        && let Err(error) = writer.push(row, output.columns.len())
                    {
                        output.full_result_error = Some(error.message);
                        capture = None;
                    }
                    if (requested_capture && output.truncated)
                        || output.rows.len() >= MAX_ROWS
                        || used >= MAX_BYTES
                    {
                        output.truncated = true;
                        // Writes with RETURNING must be stepped to completion, even
                        // after the preview fills. Never imply that cancellation undoes commits.
                        if read_only && capture.is_none() {
                            break;
                        }
                        continue;
                    }
                    let mut values = Vec::with_capacity(output.columns.len());
                    for i in 0..output.columns.len() {
                        let (value, bytes) = match cell(row.get_ref(i).map_err(|e| e.to_string())?)
                        {
                            Ok(value) => value,
                            Err(_) if requested_capture => {
                                output.truncated = true;
                                break;
                            }
                            Err(error) => return Err(error),
                        };
                        used += bytes;
                        values.push(value);
                    }
                    if (!requested_capture || !output.truncated) && used <= MAX_BYTES {
                        output.rows.push(values);
                    } else {
                        output.truncated = true;
                    }
                }
            }
            if let (Some(writer), Some(publish)) = (capture, publish.as_mut()) {
                match writer
                    .finish()
                    .and_then(|source| publish(output.columns.clone(), source))
                {
                    Ok(info) => output.full_result = Some(info),
                    Err(error) => output.full_result_error = Some(error.message),
                }
            }
            if !read_only && connection.total_changes() > before {
                output.affected_rows = connection.changes().to_string();
            }
            result.statements.push(output);
            offset = next_offset.min(sql.len());
        }
        Ok(())
    })();
    let _ = connection.progress_handler(0, None::<fn() -> bool>);
    if let Err(message) = run {
        result.status = if cancel.load(Ordering::Relaxed) {
            "cancelled"
        } else if Instant::now() >= deadline {
            "timedOut"
        } else {
            "failed"
        }
        .into();
        while !sql.is_char_boundary(offset.min(sql.len())) {
            offset -= 1;
        }
        result.error = Some(QueryFailure {
            message,
            statement_index: result.statements.len(),
            offset: sql[..offset.min(sql.len())].encode_utf16().count(),
        });
        // An error ends the script. Roll back any explicit, still-open transaction.
        // Statements committed before BEGIN or COMMIT remain committed.
        if !connection.is_autocommit() {
            result.rolled_back = connection.execute_batch("ROLLBACK").is_ok();
        }
    }
    result.transaction_open = !connection.is_autocommit();
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(c: &mut Connection, sql: &str) -> QueryResult {
        configure(c).unwrap();
        execute(c, sql, Arc::new(AtomicBool::new(false)), 5000)
    }
    #[test]
    fn preserves_storage_classes_duplicate_names_and_trigger_bodies() {
        let mut c = Connection::open_in_memory().unwrap();
        let result = run(
            &mut c,
            "CREATE TABLE t(x); CREATE TABLE log(x); CREATE TRIGGER tr AFTER INSERT ON t BEGIN INSERT INTO log VALUES('a;b'); INSERT INTO log VALUES(new.x); END; INSERT INTO t VALUES(42); SELECT NULL AS x, 9223372036854775807 AS x, 1.5, '中文;--', x'00ff', CAST(x'ff' AS TEXT); SELECT * FROM log;",
        );
        assert_eq!(result.status, "completed", "{:?}", result.error);
        assert_eq!(result.statements.len(), 6);
        assert_eq!(result.statements[3].affected_rows, "1");
        assert_eq!(result.statements[4].columns[..2], ["x", "x"]);
        assert!(
            matches!(&result.statements[4].rows[0][1], Cell::Integer(s) if s == "9223372036854775807")
        );
        assert!(matches!(&result.statements[4].rows[0][4], Cell::Blob(s) if s == "00ff"));
        assert!(matches!(&result.statements[4].rows[0][5], Cell::TextBytes(s) if s == "ff"));
        assert_eq!(result.statements[5].rows.len(), 2);
    }
    #[test]
    fn errors_stop_script_and_rollback_only_open_transaction() {
        let mut c = Connection::open_in_memory().unwrap();
        let r = run(
            &mut c,
            "CREATE TABLE t(x); INSERT INTO t VALUES(1); BEGIN; INSERT INTO t VALUES(2); INSERT INTO missing VALUES(3); INSERT INTO t VALUES(4);",
        );
        assert_eq!(r.status, "failed");
        assert!(r.rolled_back);
        assert!(!r.transaction_open);
        assert_eq!(r.error.unwrap().statement_index, 4);
        assert_eq!(
            c.query_row("SELECT sum(x) FROM t", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(run(&mut c, "BEGIN; INSERT INTO t VALUES(5)").transaction_open);
        assert!(!run(&mut c, "ROLLBACK").transaction_open);
    }
    #[test]
    fn bounded_previews_and_returning_complete_writes() {
        let mut c = Connection::open_in_memory().unwrap();
        let r = run(
            &mut c,
            "CREATE TABLE t(x); WITH RECURSIVE a(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM a WHERE x<300) INSERT INTO t SELECT x FROM a RETURNING x; SELECT * FROM t;",
        );
        assert_eq!(r.status, "completed", "{:?}", r.error);
        assert_eq!(r.statements[1].affected_rows, "300");
        assert!(r.statements[1].truncated);
        assert_eq!(r.statements[2].rows.len(), 200);
        assert!(r.statements[2].truncated);
        assert_eq!(run(&mut c, "SELECT zeroblob(20000)").status, "failed");
        assert_eq!(run(&mut c, "SELECT ?").status, "failed");
    }
    #[test]
    fn cancellation_timeout_and_utf16_error_offsets() {
        let mut c = Connection::open_in_memory().unwrap();
        configure(&mut c).unwrap();
        let sql =
            "WITH RECURSIVE a(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM a) SELECT sum(x) FROM a";
        assert_eq!(
            execute(&mut c, sql, Arc::new(AtomicBool::new(true)), 5000).status,
            "cancelled"
        );
        assert_eq!(
            execute(&mut c, sql, Arc::new(AtomicBool::new(false)), 2).status,
            "timedOut"
        );
        let sql = "SELECT '猫😀'; SELEC 2;";
        let r = run(&mut c, sql);
        assert_eq!(
            r.error.unwrap().offset,
            sql.find("SELEC 2")
                .map(|i| sql[..i].encode_utf16().count())
                .unwrap()
        );
        assert_eq!(run(&mut c, "SELECT 1").status, "completed");
    }
    #[test]
    fn prevents_sql_from_opening_other_files() {
        let mut c = Connection::open_in_memory().unwrap();
        assert_eq!(run(&mut c, "ATTACH ':memory:' AS other").status, "failed");
        assert_eq!(
            run(&mut c, "VACUUM INTO 'must-not-exist.db'").status,
            "failed"
        );
        assert_eq!(run(&mut c, "PRAGMA busy_timeout=999999").status, "failed");
    }
}
