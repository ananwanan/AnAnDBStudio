//! Per-process registry for already opened SQLite database handles.
//! Registry locks are never held while waiting for a database worker.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use anandb_driver_sqlite::browse::{BrowseError, BrowseErrorKind, Page, ResultInfo, TableRequest};
use anandb_driver_sqlite::edit::{EditRequest, EditResult};
use anandb_driver_sqlite::{OpenMode, SchemaSnapshot, SqliteDatabase, SqliteError};
use serde::Serialize;

use crate::error::{AppError, AppErrorCode};

const MAX_CONNECTIONS: usize = 32;
const MAX_PATH_CHARS: usize = 8192;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub id: String,
    pub path: String,
    pub read_only: bool,
}

struct ManagedConnection {
    worker: Arc<anandb_driver_sqlite::worker::ConnectionWorker>,
    info: ConnectionInfo,
}

#[derive(Default)]
pub struct ConnectionManager {
    next_id: AtomicU64,
    connections: Mutex<BTreeMap<u64, ManagedConnection>>,
}

impl ConnectionManager {
    /// Opens an existing file only. Does not create a DB or run user SQL.
    /// Call this function from a blocking worker, not an async executor thread.
    pub fn open_existing(&self, path: String, read_only: bool) -> Result<ConnectionInfo, AppError> {
        if path.trim().is_empty() || path.contains('\0') || path.chars().count() > MAX_PATH_CHARS {
            return Err(AppError::new(
                AppErrorCode::InvalidArgument,
                "A non-empty SQLite file path is required",
            ));
        }

        let mode = if read_only {
            OpenMode::ReadOnly
        } else {
            OpenMode::ReadWrite
        };
        let database = SqliteDatabase::open_existing(path, mode).map_err(|_| {
            AppError::new(
                AppErrorCode::DatabaseOpenFailed,
                "Cannot open the existing SQLite database in the requested mode",
            )
        })?;

        let mut entries = self.connections.lock().map_err(|_| internal_error())?;
        if entries.len() >= MAX_CONNECTIONS {
            return Err(AppError::new(
                AppErrorCode::ConnectionLimitReached,
                "Maximum number of SQLite connections reached",
            ));
        }

        let id = self
            .next_id
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                value.checked_add(1)
            })
            .map_err(|_| internal_error())?
            + 1;
        let info = ConnectionInfo {
            id: format!("sqlite-{id}"),
            path: database.path().to_string_lossy().into_owned(),
            read_only,
        };
        entries.insert(
            id,
            ManagedConnection {
                worker: Arc::new(
                    anandb_driver_sqlite::worker::ConnectionWorker::new(database)
                        .map_err(|_| internal_error())?,
                ),
                info: info.clone(),
            },
        );
        Ok(info)
    }

    pub fn list(&self) -> Result<Vec<ConnectionInfo>, AppError> {
        let entries = self.connections.lock().map_err(|_| internal_error())?;
        Ok(entries.values().map(|entry| entry.info.clone()).collect())
    }

    fn worker(
        &self,
        id: &str,
    ) -> Result<Arc<anandb_driver_sqlite::worker::ConnectionWorker>, AppError> {
        let number = parse_connection_id(id)?;
        self.connections
            .lock()
            .map_err(|_| internal_error())?
            .get(&number)
            .map(|entry| Arc::clone(&entry.worker))
            .ok_or_else(|| {
                AppError::new(
                    AppErrorCode::ConnectionNotFound,
                    "SQLite connection not found",
                )
            })
    }

    pub fn schema(&self, id: String) -> Result<SchemaSnapshot, AppError> {
        self.worker(&id)?.schema().map_err(|error| match error {
            SqliteError::SchemaLimitExceeded(_) => AppError::new(
                AppErrorCode::SchemaTooLarge,
                "SQLite schema is too large for a single metadata response",
            ),
            _ => AppError::new(
                AppErrorCode::SchemaReadFailed,
                "Failed to read SQLite schema metadata; the connection may be busy",
            ),
        })
    }

    pub fn start_query(
        &self,
        id: String,
        sql: String,
        timeout_ms: u64,
        capture: bool,
    ) -> Result<String, AppError> {
        self.worker(&id)?
            .start(sql, timeout_ms, capture)
            .map_err(query_error)
    }
    pub fn poll_query(
        &self,
        id: String,
        job_id: String,
    ) -> Result<anandb_driver_sqlite::worker::JobSnapshot, AppError> {
        self.worker(&id)?.poll(&job_id).map_err(query_error)
    }
    pub fn cancel_query(&self, id: String, job_id: String) -> Result<(), AppError> {
        self.worker(&id)?.cancel(&job_id).map_err(query_error)
    }

    pub fn open_table(
        &self,
        id: String,
        request: TableRequest,
        timeout_ms: u64,
        count_rows: bool,
    ) -> Result<ResultInfo, AppError> {
        self.worker(&id)?
            .open_table_counting(request, timeout_ms, count_rows)
            .map_err(browse_error)
    }

    pub fn result_page(
        &self,
        id: String,
        session_id: String,
        offset: usize,
        limit: usize,
        timeout_ms: u64,
    ) -> Result<Page, AppError> {
        self.worker(&id)?
            .result_page(&session_id, offset, limit, timeout_ms)
            .map_err(browse_error)
    }

    pub fn close_result(&self, id: String, session_id: String) -> Result<(), AppError> {
        self.worker(&id)?
            .close_result(&session_id)
            .map_err(browse_error)
    }

    pub fn commit_edit(
        &self,
        id: String,
        session_id: String,
        operation_id: String,
        request: EditRequest,
        timeout_ms: u64,
    ) -> Result<EditResult, AppError> {
        self.worker(&id)?
            .commit_edit(&session_id, operation_id, request, timeout_ms)
            .map_err(browse_error)
    }

    pub fn cancel_edit(&self, id: String, operation_id: String) -> Result<(), AppError> {
        self.worker(&id)?
            .cancel_edit(&operation_id)
            .map_err(browse_error)
    }

    /// Removes the connection from the registry before closing its handle.
    /// An unknown or already-closed identifier is a distinct error.
    pub fn close(&self, id: String) -> Result<(), AppError> {
        let number = parse_connection_id(&id)?;

        let entry = {
            let mut entries = self.connections.lock().map_err(|_| internal_error())?;
            entries.remove(&number).ok_or_else(|| {
                AppError::new(
                    AppErrorCode::ConnectionNotFound,
                    "SQLite connection not found",
                )
            })?
        };
        entry.worker.close().map_err(|_| {
            AppError::new(
                AppErrorCode::DatabaseCloseFailed,
                "Failed to close SQLite database",
            )
        })
    }
}

fn parse_connection_id(id: &str) -> Result<u64, AppError> {
    id.strip_prefix("sqlite-")
        .filter(|part| !part.is_empty() && !part.starts_with('0'))
        .and_then(|part| part.parse::<u64>().ok())
        .ok_or_else(|| AppError::new(AppErrorCode::InvalidArgument, "Invalid connection id"))
}

fn browse_error(error: BrowseError) -> AppError {
    let code = match error.kind {
        BrowseErrorKind::Invalid => AppErrorCode::InvalidArgument,
        BrowseErrorKind::Expired => AppErrorCode::ResultExpired,
        BrowseErrorKind::Busy => AppErrorCode::ConnectionBusy,
        BrowseErrorKind::Cancelled => AppErrorCode::ResultCancelled,
        BrowseErrorKind::TimedOut => AppErrorCode::ResultTimedOut,
        BrowseErrorKind::Failed => AppErrorCode::QueryFailed,
        BrowseErrorKind::EditReadOnly => AppErrorCode::EditReadOnly,
        BrowseErrorKind::EditTransactionOpen => AppErrorCode::EditTransactionOpen,
        BrowseErrorKind::EditSchemaChanged => AppErrorCode::EditSchemaChanged,
        BrowseErrorKind::EditRowMissing => AppErrorCode::EditRowMissing,
        BrowseErrorKind::EditRowChanged => AppErrorCode::EditRowChanged,
        BrowseErrorKind::EditAffectedRows => AppErrorCode::EditAffectedRows,
        BrowseErrorKind::EditConstraint => AppErrorCode::EditConstraint,
        BrowseErrorKind::EditBusy => AppErrorCode::EditBusy,
        BrowseErrorKind::EditUnknown => AppErrorCode::EditUnknown,
    };
    AppError::new(code, error.message)
}

fn query_error(message: String) -> AppError {
    AppError::new(AppErrorCode::QueryFailed, message)
}

fn internal_error() -> AppError {
    AppError::new(AppErrorCode::Internal, "Connection manager is unavailable")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        directory: PathBuf,
        path: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock is valid")
                .as_nanos();
            let directory =
                std::env::temp_dir().join(format!("anandb-m12-{}-{stamp}", std::process::id()));
            fs::create_dir(&directory).unwrap();
            let path = directory.join("sample.sqlite");
            let database = rusqlite::Connection::open(&path).unwrap();
            database
                .execute_batch("CREATE TABLE sample (id INTEGER PRIMARY KEY);")
                .unwrap();
            drop(database);
            Self { directory, path }
        }
        fn path(&self) -> String {
            self.path.to_str().unwrap().to_owned()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    #[test]
    fn open_list_and_close_multiple_handles() {
        let fixture = Fixture::new();
        let registry = ConnectionManager::default();
        let first = registry.open_existing(fixture.path(), true).unwrap();
        let second = registry.open_existing(fixture.path(), false).unwrap();
        assert_ne!(first.id, second.id);
        assert!(first.read_only);
        assert!(!second.read_only);
        assert!(first.path.ends_with("sample.sqlite"));
        assert_eq!(
            registry.list().unwrap(),
            vec![first.clone(), second.clone()]
        );
        registry.close(first.id).unwrap();
        assert_eq!(registry.list().unwrap(), vec![second.clone()]);
        registry.close(second.id).unwrap();
        assert!(registry.list().unwrap().is_empty());
    }

    #[test]
    fn rejects_invalid_and_already_closed_ids() {
        let fixture = Fixture::new();
        let registry = ConnectionManager::default();
        let info = registry.open_existing(fixture.path(), true).unwrap();
        assert_eq!(
            registry.close("bad-id".to_owned()).unwrap_err().code,
            AppErrorCode::InvalidArgument
        );
        assert_eq!(
            registry.close("sqlite-999".to_owned()).unwrap_err().code,
            AppErrorCode::ConnectionNotFound
        );
        registry.close(info.id.clone()).unwrap();
        assert_eq!(
            registry.close(info.id).unwrap_err().code,
            AppErrorCode::ConnectionNotFound
        );
    }

    #[test]
    fn rejects_missing_files_and_invalid_paths() {
        let fixture = Fixture::new();
        let registry = ConnectionManager::default();
        for path in [String::new(), "   ".to_owned(), "bad\0path".to_owned()] {
            assert_eq!(
                registry.open_existing(path, true).unwrap_err().code,
                AppErrorCode::InvalidArgument
            );
        }
        let missing = fixture.directory.join("missing.sqlite");
        assert_eq!(
            registry
                .open_existing(missing.to_str().unwrap().to_owned(), false)
                .unwrap_err()
                .code,
            AppErrorCode::DatabaseOpenFailed
        );
        assert!(!missing.exists());
        assert!(registry.list().unwrap().is_empty());
    }

    #[test]
    fn schema_uses_open_handle_and_rejects_closed_or_malformed_ids() {
        let fixture = Fixture::new();
        let registry = ConnectionManager::default();
        let info = registry.open_existing(fixture.path(), true).unwrap();
        let schema = registry.schema(info.id.clone()).unwrap();
        assert_eq!(schema.schema, "main");
        assert_eq!(schema.objects[0].name, "sample");
        assert_eq!(schema.objects[0].columns[0].name, "id");
        assert_eq!(
            registry.schema("bad".to_owned()).unwrap_err().code,
            AppErrorCode::InvalidArgument
        );
        registry.close(info.id.clone()).unwrap();
        assert_eq!(
            registry.schema(info.id).unwrap_err().code,
            AppErrorCode::ConnectionNotFound
        );
    }

    #[test]
    fn limits_open_connections_without_leaking_handles() {
        let fixture = Fixture::new();
        let registry = ConnectionManager::default();
        let handles: Vec<_> = (0..MAX_CONNECTIONS)
            .map(|_| registry.open_existing(fixture.path(), true).unwrap())
            .collect();
        assert_eq!(
            registry
                .open_existing(fixture.path(), true)
                .unwrap_err()
                .code,
            AppErrorCode::ConnectionLimitReached
        );
        assert_eq!(registry.list().unwrap().len(), MAX_CONNECTIONS);
        for handle in handles {
            registry.close(handle.id).unwrap();
        }
        assert!(registry.list().unwrap().is_empty());
    }
    #[test]
    fn query_jobs_do_not_hold_registry_and_close_cleans_up() {
        let fixture = Fixture::new();
        let registry = ConnectionManager::default();
        let first = registry.open_existing(fixture.path(), false).unwrap();
        let second = registry.open_existing(fixture.path(), true).unwrap();
        let job = registry.start_query(first.id.clone(), "WITH RECURSIVE a(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM a) SELECT sum(x) FROM a".into(), 300000, false).unwrap();
        assert_eq!(registry.list().unwrap().len(), 2);
        assert!(registry.schema(second.id.clone()).is_ok());
        assert!(
            registry
                .poll_query(first.id.clone(), job.clone())
                .unwrap()
                .result
                .is_none()
        );
        registry.cancel_query(first.id.clone(), job).unwrap();
        registry.close(first.id.clone()).unwrap();
        assert_eq!(
            registry
                .start_query(first.id, "SELECT 1".into(), 1000, false)
                .unwrap_err()
                .code,
            AppErrorCode::ConnectionNotFound
        );
        registry.close(second.id).unwrap();
    }

    #[test]
    fn edits_validate_connection_ownership_and_session_lifetime() {
        use anandb_driver_sqlite::edit::Change;

        let fixture = Fixture::new();
        let registry = ConnectionManager::default();
        let first = registry.open_existing(fixture.path(), false).unwrap();
        let second = registry.open_existing(fixture.path(), false).unwrap();
        let info = registry
            .open_table(
                first.id.clone(),
                TableRequest {
                    schema: "main".into(),
                    table: "sample".into(),
                    sort: None,
                    filter: None,
                },
                5000,
                false,
            )
            .unwrap();
        let request = || EditRequest {
            schema_version: info.editing.as_ref().unwrap().schema_version,
            changes: vec![Change::Insert { values: vec![] }],
        };
        let save =
            |id: String| registry.commit_edit(id, info.id.clone(), "op".into(), request(), 5000);
        assert_eq!(
            save(second.id).unwrap_err().code,
            AppErrorCode::ResultExpired
        );
        assert_eq!(save(first.id.clone()).unwrap().inserted, 1);
        registry
            .close_result(first.id.clone(), info.id.clone())
            .unwrap();
        assert_eq!(
            save(first.id.clone()).unwrap_err().code,
            AppErrorCode::ResultExpired
        );
        registry.close(first.id.clone()).unwrap();
        assert_eq!(
            save(first.id).unwrap_err().code,
            AppErrorCode::ConnectionNotFound
        );
    }
}
