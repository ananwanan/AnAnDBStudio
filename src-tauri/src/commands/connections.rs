//! Tauri-only adapter: all potentially blocking SQLite I/O runs off the UI executor.

use std::sync::Arc;
use tauri::State;

use crate::connections::{ConnectionInfo, ConnectionManager};
use crate::error::{AppError, AppErrorCode};
use anandb_driver_sqlite::{
    SchemaSnapshot,
    browse::{Page, ResultInfo, TableRequest},
};

#[tauri::command]
pub async fn open_sqlite_connection(
    manager: State<'_, Arc<ConnectionManager>>,
    path: String,
    read_only: bool,
) -> Result<ConnectionInfo, AppError> {
    let manager = Arc::clone(manager.inner());
    tauri::async_runtime::spawn_blocking(move || manager.open_existing(path, read_only))
        .await
        .map_err(|_| worker_error())?
}

#[tauri::command]
pub async fn list_sqlite_connections(
    manager: State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<ConnectionInfo>, AppError> {
    let manager = Arc::clone(manager.inner());
    tauri::async_runtime::spawn_blocking(move || manager.list())
        .await
        .map_err(|_| worker_error())?
}

#[tauri::command]
pub async fn close_sqlite_connection(
    manager: State<'_, Arc<ConnectionManager>>,
    id: String,
) -> Result<(), AppError> {
    let manager = Arc::clone(manager.inner());
    tauri::async_runtime::spawn_blocking(move || manager.close(id))
        .await
        .map_err(|_| worker_error())?
}

#[tauri::command]
pub async fn get_sqlite_schema(
    manager: State<'_, Arc<ConnectionManager>>,
    id: String,
) -> Result<SchemaSnapshot, AppError> {
    let manager = Arc::clone(manager.inner());
    tauri::async_runtime::spawn_blocking(move || manager.schema(id))
        .await
        .map_err(|_| worker_error())?
}

fn worker_error() -> AppError {
    AppError::new(AppErrorCode::Internal, "SQLite connection worker failed")
}

#[tauri::command]
pub async fn start_sqlite_query(
    manager: State<'_, Arc<ConnectionManager>>,
    id: String,
    sql: String,
    timeout_ms: u64,
    capture: Option<bool>,
) -> Result<String, AppError> {
    manager.start_query(id, sql, timeout_ms, capture.unwrap_or(false))
}
#[tauri::command]
pub async fn poll_sqlite_query(
    manager: State<'_, Arc<ConnectionManager>>,
    id: String,
    job_id: String,
) -> Result<anandb_driver_sqlite::worker::JobSnapshot, AppError> {
    manager.poll_query(id, job_id)
}
#[tauri::command]
pub async fn cancel_sqlite_query(
    manager: State<'_, Arc<ConnectionManager>>,
    id: String,
    job_id: String,
) -> Result<(), AppError> {
    manager.cancel_query(id, job_id)
}

#[tauri::command]
pub async fn open_sqlite_table_result(
    manager: State<'_, Arc<ConnectionManager>>,
    id: String,
    request: TableRequest,
    timeout_ms: u64,
) -> Result<ResultInfo, AppError> {
    let manager = Arc::clone(manager.inner());
    tauri::async_runtime::spawn_blocking(move || manager.open_table(id, request, timeout_ms))
        .await
        .map_err(|_| worker_error())?
}

#[tauri::command]
pub async fn get_sqlite_result_page(
    manager: State<'_, Arc<ConnectionManager>>,
    id: String,
    session_id: String,
    offset: usize,
    limit: usize,
    timeout_ms: u64,
) -> Result<Page, AppError> {
    let manager = Arc::clone(manager.inner());
    tauri::async_runtime::spawn_blocking(move || {
        manager.result_page(id, session_id, offset, limit, timeout_ms)
    })
    .await
    .map_err(|_| worker_error())?
}

#[tauri::command]
pub async fn close_sqlite_result(
    manager: State<'_, Arc<ConnectionManager>>,
    id: String,
    session_id: String,
) -> Result<(), AppError> {
    manager.close_result(id, session_id)
}
