//! SQLite driver foundation for AnAnDB Studio.
//!
//! This crate is deliberately independent of Tauri and the UI. M1.1 only
//! opens existing on-disk databases and manages their connection lifetime.

use std::error::Error;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

pub mod schema;
pub use schema::{SchemaColumn, SchemaObject, SchemaObjectKind, SchemaSnapshot};

/// The caller must explicitly select whether writes are permitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenMode {
    ReadOnly,
    ReadWrite,
}

/// Opening an existing SQLite file never creates a new database.
#[derive(Debug)]
pub enum SqliteError {
    Io(io::Error),
    NotAFile(PathBuf),
    Database(rusqlite::Error),
    ReadWriteUnavailable(PathBuf),
    SchemaLimitExceeded(&'static str),
}

impl fmt::Display for SqliteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "database path error: {error}"),
            Self::NotAFile(path) => {
                write!(f, "database path is not a regular file: {}", path.display())
            }
            Self::Database(error) => write!(f, "SQLite error: {error}"),
            Self::ReadWriteUnavailable(path) => {
                write!(
                    f,
                    "database cannot be opened for writing: {}",
                    path.display()
                )
            }
            Self::SchemaLimitExceeded(reason) => write!(f, "{reason}"),
        }
    }
}

impl Error for SqliteError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::NotAFile(_) => None,
            Self::Database(error) => Some(error),
            Self::ReadWriteUnavailable(_) => None,
            Self::SchemaLimitExceeded(_) => None,
        }
    }
}

/// Owns exactly one SQLite connection. Do not share it across UI callbacks.
///
/// A future M1.2 connection worker will own this value and serialize its use.
pub struct SqliteDatabase {
    connection: Connection,
    path: PathBuf,
    mode: OpenMode,
}

impl SqliteDatabase {
    /// Open an already existing on-disk SQLite database.
    ///
    /// The path is canonicalized to avoid passing a URI-like filename to
    /// SQLite. Neither mode includes SQLITE_OPEN_CREATE or SQLITE_OPEN_URI.
    pub fn open_existing(path: impl AsRef<Path>, mode: OpenMode) -> Result<Self, SqliteError> {
        let path = std::fs::canonicalize(path).map_err(SqliteError::Io)?;

        if !path.is_file() {
            return Err(SqliteError::NotAFile(path));
        }

        let flags = match mode {
            OpenMode::ReadOnly => OpenFlags::SQLITE_OPEN_READ_ONLY,
            OpenMode::ReadWrite => OpenFlags::SQLITE_OPEN_READ_WRITE,
        } | OpenFlags::SQLITE_OPEN_NO_MUTEX;

        let connection =
            Connection::open_with_flags(&path, flags).map_err(SqliteError::Database)?;

        // Probe the database header. SQLite accepts an empty file as a new
        // empty database; invalid, non-empty database files are rejected.
        let _: i64 = connection
            .query_row("PRAGMA schema_version", [], |row| row.get(0))
            .map_err(SqliteError::Database)?;

        // SQLite can silently fall back to read-only even with READ_WRITE.
        if mode == OpenMode::ReadWrite
            && connection
                .is_readonly("main")
                .map_err(SqliteError::Database)?
        {
            return Err(SqliteError::ReadWriteUnavailable(path));
        }

        Ok(Self {
            connection,
            path,
            mode,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn mode(&self) -> OpenMode {
        self.mode
    }

    /// A small metadata probe used by M1.1 tests and later schema discovery.
    pub fn user_version(&self) -> Result<i64, SqliteError> {
        self.connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(SqliteError::Database)
    }

    /// Read a bounded metadata snapshot from the main schema only.
    /// Call from a blocking worker, not the UI executor.
    pub fn read_schema(&mut self) -> Result<SchemaSnapshot, SqliteError> {
        schema::read_main_schema(&mut self.connection)
    }

    /// Close the SQLite handle explicitly; dropping this object also closes it.
    pub fn close(self) -> Result<(), SqliteError> {
        self.connection
            .close()
            .map_err(|(_, error)| SqliteError::Database(error))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static NEXT_TEST_ID: AtomicU64 = AtomicU64::new(0);

    struct Fixture {
        directory: PathBuf,
        database: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock must be valid")
                .as_nanos();
            let directory = std::env::temp_dir().join(format!(
                "anandb-m1-{}-{nanos}-{}",
                std::process::id(),
                NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&directory).expect("create fixture directory");

            let database = directory.join("sample.sqlite");
            let connection = Connection::open(&database).expect("create fixture database");
            connection
                .execute_batch(
                    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
                     INSERT INTO items (name) VALUES ('sample');
                     PRAGMA user_version = 7;",
                )
                .expect("seed fixture database");
            drop(connection);

            Self {
                directory,
                database,
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    #[test]
    fn opens_existing_database_read_only() {
        let fixture = Fixture::new();
        let database =
            SqliteDatabase::open_existing(&fixture.database, OpenMode::ReadOnly).unwrap();

        assert_eq!(database.mode(), OpenMode::ReadOnly);
        assert_eq!(
            database.path(),
            fs::canonicalize(&fixture.database).unwrap().as_path()
        );
        assert_eq!(database.user_version().unwrap(), 7);
        assert!(
            database
                .connection
                .execute("INSERT INTO items (name) VALUES ('blocked')", [])
                .is_err()
        );
        database.close().unwrap();
    }

    #[test]
    fn opens_existing_database_read_write_without_creating_it() {
        let fixture = Fixture::new();
        let database =
            SqliteDatabase::open_existing(&fixture.database, OpenMode::ReadWrite).unwrap();
        assert_eq!(database.mode(), OpenMode::ReadWrite);
        database
            .connection
            .execute("INSERT INTO items (name) VALUES ('persisted')", [])
            .unwrap();
        database.close().unwrap();

        let verify =
            Connection::open_with_flags(&fixture.database, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .unwrap();
        let count: i64 = verify
            .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn neither_mode_creates_missing_files() {
        let fixture = Fixture::new();
        let missing = fixture.directory.join("missing.sqlite");

        for mode in [OpenMode::ReadOnly, OpenMode::ReadWrite] {
            let result = SqliteDatabase::open_existing(&missing, mode);
            assert!(matches!(
                result,
                Err(SqliteError::Io(error)) if error.kind() == io::ErrorKind::NotFound
            ));
            assert!(!missing.exists());
        }
    }

    #[test]
    fn rejects_directories() {
        let fixture = Fixture::new();
        let result = SqliteDatabase::open_existing(&fixture.directory, OpenMode::ReadOnly);
        assert!(matches!(result, Err(SqliteError::NotAFile(_))));
    }

    #[test]
    fn rejects_non_sqlite_files() {
        let fixture = Fixture::new();
        fs::write(&fixture.database, b"not a SQLite database").unwrap();

        let result = SqliteDatabase::open_existing(&fixture.database, OpenMode::ReadOnly);
        assert!(matches!(result, Err(SqliteError::Database(_))));
    }
}
