mod commands;
mod connections;
pub mod error;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(connections::ConnectionManager::default()))
        .invoke_handler(tauri::generate_handler![
            commands::app_info::get_app_info,
            commands::app_info::check_ipc_protocol,
            commands::connections::open_sqlite_connection,
            commands::connections::list_sqlite_connections,
            commands::connections::close_sqlite_connection,
            commands::connections::get_sqlite_schema,
            commands::connections::start_sqlite_query,
            commands::connections::poll_sqlite_query,
            commands::connections::cancel_sqlite_query,
            commands::connections::open_sqlite_table_result,
            commands::connections::get_sqlite_result_page,
            commands::connections::close_sqlite_result,
            commands::export::export_sqlite_selection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
