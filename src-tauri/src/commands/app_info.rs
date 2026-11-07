use crate::error::{AppError, AppErrorCode};
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

#[tauri::command]
pub fn check_ipc_protocol(protocol_version: u16) -> Result<(), AppError> {
    if protocol_version != IPC_PROTOCOL_VERSION {
        return Err(AppError::new(
            AppErrorCode::ProtocolMismatch,
            "Unsupported IPC protocol version",
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{IPC_PROTOCOL_VERSION, check_ipc_protocol, get_app_info};

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

    #[test]
    fn compatible_ipc_protocol_succeeds() {
        assert_eq!(check_ipc_protocol(IPC_PROTOCOL_VERSION), Ok(()));
    }

    #[test]
    fn incompatible_ipc_protocol_returns_structured_error() {
        let error = check_ipc_protocol(999).unwrap_err();

        assert_eq!(error.code, crate::error::AppErrorCode::ProtocolMismatch);

        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({
                "code": "PROTOCOL_MISMATCH",
                "message": "Unsupported IPC protocol version"
            })
        );
    }
}
