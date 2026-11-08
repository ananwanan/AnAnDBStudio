mod commands;
pub mod error;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::app_info::get_app_info,
            commands::app_info::check_ipc_protocol,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
