fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_app_info",
            "check_ipc_protocol",
            "open_sqlite_connection",
            "list_sqlite_connections",
            "close_sqlite_connection",
            "get_sqlite_schema",
            "start_sqlite_query",
            "poll_sqlite_query",
            "cancel_sqlite_query",
        ]),
    ))
    .expect("failed to generate Tauri application permissions");
}
