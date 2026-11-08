//! Tauri-only adapter: all potentially blocking SQLite I/O runs off the UI executor.

use std::sync::Arc;
use tauri::State;

use crate::connections::{ConnectionInfo, ConnectionManager};
use crate::error::{AppError, AppErrorCode};
use anandb_driver_sqlite::SchemaSnapshot;

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
