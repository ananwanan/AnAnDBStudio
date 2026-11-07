use crate::error::{AppError, AppErrorCode};
use serde::Serialize;
use serde_json::Value;

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
pub fn check_ipc_protocol(protocol_version: Value) -> Result<(), AppError> {
    // Validate the untrusted JSON value at the Rust boundary.
    let version = protocol_version
        .as_u64()
        .and_then(|value| u16::try_from(value).ok())
        .ok_or_else(|| {
            AppError::new(
                AppErrorCode::InvalidArgument,
                "protocolVersion must be an unsigned 16-bit integer",
            )
        })?;

    if version != IPC_PROTOCOL_VERSION {
        return Err(AppError::new(
            AppErrorCode::ProtocolMismatch,
            "Unsupported IPC protocol version",
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_serializes_correctly() {
        let value = serde_json::to_value(get_app_info()).unwrap();

        assert_eq!(
            value,
            serde_json::json!({
                "appName": "AnAnDB Studio",
                "version": env!("CARGO_PKG_VERSION"),
                "protocolVersion": 1
            })
        );
    }

    #[test]
    fn valid_protocol_succeeds() {
        assert_eq!(check_ipc_protocol(serde_json::json!(1)), Ok(()));
    }

    #[test]
    fn unsupported_protocol_returns_mismatch() {
        let error = check_ipc_protocol(serde_json::json!(2)).unwrap_err();

        assert_eq!(error.code, AppErrorCode::ProtocolMismatch);
    }

    #[test]
    fn invalid_arguments_are_rejected() {
        let invalid = [
            serde_json::Value::Null,
            serde_json::json!(true),
            serde_json::json!("1"),
            serde_json::json!(-1),
            serde_json::json!(1.5),
            serde_json::json!(65536),
            serde_json::json!({}),
        ];

        for value in invalid {
            let error = check_ipc_protocol(value).unwrap_err();

            assert_eq!(error.code, AppErrorCode::InvalidArgument);

            let json = serde_json::to_value(error).unwrap();

            assert_eq!(json["code"], "INVALID_ARGUMENT");
        }
    }
}
