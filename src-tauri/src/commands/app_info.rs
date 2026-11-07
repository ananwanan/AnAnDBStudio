use serde::Serialize;

pub const IPC_PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    app_name: &'static str,
    version: &'static str,
    protocol_version: u16,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        app_name: "AnAnDB Studio",
        version: env!("CARGO_PKG_VERSION"),
        protocol_version: IPC_PROTOCOL_VERSION,
    }
}

#[cfg(test)]
mod tests {
    use super::{IPC_PROTOCOL_VERSION, get_app_info};

    #[test]
    fn app_info_uses_the_expected_protocol_and_version() {
        let info = get_app_info();
        assert_eq!(info.protocol_version, IPC_PROTOCOL_VERSION);
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn app_info_serializes_to_camel_case() {
        let info = get_app_info();
        let encoded = serde_json::to_value(info).expect("app info should serialize");
        assert_eq!(
            encoded,
            serde_json::json!({
                "appName": "AnAnDB Studio",
                "version": env!("CARGO_PKG_VERSION"),
                "protocolVersion": 1
            })
        );
    }
}
