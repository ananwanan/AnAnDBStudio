mod sessions;
mod snapshot;
pub(crate) mod table;

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};

use rusqlite::{Connection, Row, types::ValueRef};
use serde::{Deserialize, Serialize};

pub(crate) use sessions::Sessions;
pub(crate) use snapshot::SnapshotWriter;
pub(crate) use table::Table;

pub const MAX_PAGE_ROWS: usize = 100;
const PAGE_BYTES: usize = 4 * 1024 * 1024;
const ROW_CONTENT_BYTES: usize = 24 * 1024;
const MAX_CELL_BYTES: usize = 16 * 1024;
const MAX_COLUMNS: usize = 2048;
const MAX_COLUMN_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowseErrorKind {
    Invalid,
    Expired,
    Busy,
    Cancelled,
    TimedOut,
    Failed,
    EditReadOnly,
    EditTransactionOpen,
    EditSchemaChanged,
    EditRowMissing,
    EditRowChanged,
    EditAffectedRows,
    EditConstraint,
    EditBusy,
    EditUnknown,
}

#[derive(Debug)]
pub struct BrowseError {
    pub kind: BrowseErrorKind,
    pub message: String,
}

impl BrowseError {
    pub(crate) fn new(kind: BrowseErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub(crate) fn invalid(message: &'static str) -> Self {
        Self::new(BrowseErrorKind::Invalid, message)
    }

    pub(crate) fn expired() -> Self {
        Self::new(
            BrowseErrorKind::Expired,
            "Result session has closed or expired",
        )
    }

    pub(crate) fn failed(message: &'static str) -> Self {
        Self::new(BrowseErrorKind::Failed, message)
    }
}

impl From<rusqlite::Error> for BrowseError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new(BrowseErrorKind::Failed, error.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum BrowseCell {
    Null,
    Integer { value: String },
    Real { value: String },
    Text { value: String },
    Blob { value: String },
    TextBytes { value: String },
    TextPreview { value: String, bytes: usize },
    BlobPreview { value: String, bytes: usize },
    TextBytesPreview { value: String, bytes: usize },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultInfo {
    pub id: String,
    pub columns: Vec<String>,
    pub max_page_size: usize,
    pub row_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub editing: Option<crate::edit::EditInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed_row_count: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub rows: Vec<Vec<BrowseCell>>,
    pub end: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableRequest {
    pub schema: String,
    pub table: String,
    pub sort: Option<Sort>,
    pub filter: Option<Filter>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sort {
    pub column: String,
    pub descending: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Filter {
    pub column: String,
    pub operator: FilterOperator,
    pub value: Option<FilterValue>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterOperator {
    Eq,
    Ne,
    Gt,
    Lt,
    Ge,
    Le,
    Contains,
    Like,
    IsNull,
    IsNotNull,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum FilterValue {
    Text(String),
    Integer(String),
    Real(String),
    Blob(String),
}

pub(crate) enum Source {
    Table(Box<Table>),
    Snapshot(snapshot::Snapshot),
}

pub(crate) struct Session {
    pub info: ResultInfo,
    pub source: Source,
    pub cancelled: Arc<AtomicBool>,
}

impl Session {
    pub fn new(id: String, columns: Vec<String>, source: Source) -> Result<Self, BrowseError> {
        validate_columns(&columns)?;
        let row_count = match &source {
            Source::Snapshot(snapshot) => Some(snapshot.len()),
            Source::Table(_) => None,
        };
        // Each cell has at most 128 bytes of fixed JSON overhead (including numbers).
        let max_page_size =
            MAX_PAGE_ROWS.min(PAGE_BYTES / (columns.len() * 128 + ROW_CONTENT_BYTES + 32));
        let editing = match &source {
            Source::Table(table) => Some(table.editing.info.clone()),
            Source::Snapshot(_) => None,
        };
        let observed_row_count = match &source {
            Source::Table(table) => table.observed_row_count,
            Source::Snapshot(_) => None,
        };
        Ok(Self {
            info: ResultInfo {
                id,
                columns,
                max_page_size,
                row_count,
                editing,
                observed_row_count,
            },
            source,
            cancelled: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn page(
        &self,
        connection: &mut Connection,
        offset: usize,
        limit: usize,
        deadline: Instant,
        closed: &Arc<AtomicBool>,
    ) -> Result<Page, BrowseError> {
        if limit == 0 || limit > self.info.max_page_size || offset > i32::MAX as usize {
            return Err(BrowseError::invalid(
                "Page size or offset is outside the result limits",
            ));
        }
        let check = || check_operation(deadline, closed, &self.cancelled);
        check()?;
        match &self.source {
            Source::Table(table) => read_table(
                connection,
                deadline,
                closed,
                &self.cancelled,
                |connection| table.page(connection, offset, limit, &self.info.columns, &check),
            ),
            Source::Snapshot(snapshot) => snapshot.page(offset, limit, &check),
        }
    }
}

pub(crate) fn read_table<T>(
    connection: &mut Connection,
    deadline: Instant,
    closed: &Arc<AtomicBool>,
    cancelled: &Arc<AtomicBool>,
    read: impl FnOnce(&Connection) -> Result<T, BrowseError>,
) -> Result<T, BrowseError> {
    check_operation(deadline, closed, cancelled)?;
    // Pin catalog checks and data reads to the same snapshot for this operation.
    // An explicit SQL-editor transaction already supplies its own snapshot.
    let owns_transaction = connection.is_autocommit();
    if owns_transaction {
        connection.execute_batch("BEGIN DEFERRED")?;
    }
    let close_flag = Arc::clone(closed);
    let cancel_flag = Arc::clone(cancelled);
    let result = connection
        .progress_handler(
            1000,
            Some(move || check_operation(deadline, &close_flag, &cancel_flag).is_err()),
        )
        .map_err(BrowseError::from)
        .and_then(|()| read(connection));
    let unhook = connection.progress_handler(0, None::<fn() -> bool>);
    if owns_transaction && !connection.is_autocommit() {
        connection.execute_batch("ROLLBACK")?;
    }
    unhook?;
    check_operation(deadline, closed, cancelled)?;
    result
}

pub(crate) fn deadline(timeout_ms: u64) -> Result<Instant, BrowseError> {
    if !(1..=300_000).contains(&timeout_ms) {
        return Err(BrowseError::invalid("Timeout must be 1–300000 ms"));
    }
    Ok(Instant::now() + Duration::from_millis(timeout_ms))
}

pub(crate) fn check_operation(
    deadline: Instant,
    closed: &AtomicBool,
    cancelled: &AtomicBool,
) -> Result<(), BrowseError> {
    if closed.load(Ordering::Relaxed) || cancelled.load(Ordering::Relaxed) {
        Err(BrowseError::new(
            BrowseErrorKind::Cancelled,
            "Result request cancelled",
        ))
    } else if Instant::now() >= deadline {
        Err(BrowseError::new(
            BrowseErrorKind::TimedOut,
            "Result request timed out",
        ))
    } else {
        Ok(())
    }
}

fn validate_columns(columns: &[String]) -> Result<(), BrowseError> {
    if columns.is_empty()
        || columns.len() > MAX_COLUMNS
        || columns.iter().map(String::len).sum::<usize>() > MAX_COLUMN_BYTES
    {
        return Err(BrowseError::invalid(
            "Result column metadata exceeds the browser limits",
        ));
    }
    Ok(())
}

pub(crate) fn read_row(row: &Row<'_>, width: usize) -> Result<Vec<BrowseCell>, BrowseError> {
    // Share the encoded content budget across the row. Wide rows get a smaller
    // per-cell prefix so one page stays bounded even for wide TEXT/BLOB tables.
    let mut remaining = ROW_CONTENT_BYTES;
    let mut cells = Vec::with_capacity(width);
    for index in 0..width {
        let cell = match row.get_ref(index)? {
            ValueRef::Null => BrowseCell::Null,
            ValueRef::Integer(v) => BrowseCell::Integer {
                value: v.to_string(),
            },
            ValueRef::Real(v) => BrowseCell::Real {
                value: format!("{v:?}"),
            },
            ValueRef::Blob(v) => {
                let count = v.len().min(MAX_CELL_BYTES).min(remaining / 2);
                remaining -= count * 2;
                let value = crate::query::hex(&v[..count]);
                if count == v.len() {
                    BrowseCell::Blob { value }
                } else {
                    BrowseCell::BlobPreview {
                        value,
                        bytes: v.len(),
                    }
                }
            }
            ValueRef::Text(v) => {
                let count = v.len().min(MAX_CELL_BYTES).min(remaining / 6);
                let prefix = &v[..count];
                remaining -= count * 6;
                match std::str::from_utf8(prefix) {
                    Ok(text) if count == v.len() => BrowseCell::Text { value: text.into() },
                    Ok(text) => BrowseCell::TextPreview {
                        value: text.into(),
                        bytes: v.len(),
                    },
                    Err(error) if error.error_len().is_none() && count < v.len() => {
                        let text = std::str::from_utf8(&prefix[..error.valid_up_to()])
                            .map_err(|_| BrowseError::failed("Invalid text preview"))?;
                        BrowseCell::TextPreview {
                            value: text.into(),
                            bytes: v.len(),
                        }
                    }
                    Err(_) if count == v.len() => BrowseCell::TextBytes {
                        value: crate::query::hex(prefix),
                    },
                    Err(_) => BrowseCell::TextBytesPreview {
                        value: crate::query::hex(prefix),
                        bytes: v.len(),
                    },
                }
            }
        };
        cells.push(cell);
    }
    Ok(cells)
}
