mod commands;
mod connections;
pub mod error;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(connections::ConnectionManager::default()))
        .invoke_handler(tauri::generate_handler![
            commands::app_info::get_app_info,
            commands::app_info::check_ipc_protocol,
            commands::connections::open_sqlite_connection,
            commands::connections::list_sqlite_connections,
            commands::connections::close_sqlite_connection,
            commands::connections::get_sqlite_schema,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
