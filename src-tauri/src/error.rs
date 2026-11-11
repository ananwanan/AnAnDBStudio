use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppErrorCode {
    InvalidArgument,
    QueryFailed,
    ProtocolMismatch,
    Internal,
    DatabaseOpenFailed,
    DatabaseCloseFailed,
    ConnectionNotFound,
    ConnectionLimitReached,
    SchemaReadFailed,
    SchemaTooLarge,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub code: AppErrorCode,
    pub message: String,
}

impl AppError {
    pub fn new(code: AppErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_serializes_to_wire_contract() {
        let error = AppError::new(
            AppErrorCode::ProtocolMismatch,
            "Unsupported IPC protocol version",
        );

        let value = serde_json::to_value(error).unwrap();

        assert_eq!(
            value,
            serde_json::json!({
                "code": "PROTOCOL_MISMATCH",
                "message": "Unsupported IPC protocol version"
            })
        );
    }
}
