mod commands;
pub mod error;

// Legacy scaffold command retained during M0.
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::app_info::get_app_info,
            commands::app_info::check_ipc_protocol,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::greet;

    #[test]
    fn greet_returns_expected_message() {
        assert_eq!(
            greet("AnAnDB"),
            "Hello, AnAnDB! You've been greeted from Rust!"
        );
    }
}
