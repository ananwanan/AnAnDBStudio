use std::{io::Write, path::Path};

use serde::Deserialize;
use tauri::WebviewWindow;
use tauri_plugin_dialog::DialogExt;

use crate::error::{AppError, AppErrorCode};

const MAX_EXPORT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Csv,
    Tsv,
}

impl ExportFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Tsv => "tsv",
        }
    }
}

#[tauri::command]
pub async fn export_sqlite_selection(
    window: WebviewWindow,
    format: ExportFormat,
    data: String,
) -> Result<bool, AppError> {
    if data.len() > MAX_EXPORT_BYTES {
        return Err(AppError::new(
            AppErrorCode::InvalidArgument,
            "Selection exceeds 4 MiB",
        ));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let extension = format.extension();
        let selected = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("保存数据选区")
            .set_file_name(format!("selection.{extension}"))
            .add_filter(extension.to_uppercase(), &[extension])
            .blocking_save_file();
        let Some(path) = selected else {
            return Ok(false);
        };
        let path = path
            .into_path()
            .map_err(|_| export_error("Choose a local file"))?;
        save_selection(&path, extension, data.as_bytes())?;
        Ok(true)
    })
    .await
    .map_err(|_| export_error("Selection export task failed"))?
}

fn save_selection(path: &Path, extension: &str, data: &[u8]) -> Result<(), AppError> {
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
    {
        return Err(export_error(
            "Save the selection with the selected CSV or TSV extension",
        ));
    }
    let directory = path
        .parent()
        .ok_or_else(|| export_error("Choose a local file"))?;
    let mut file = tempfile::NamedTempFile::new_in(directory)
        .map_err(|_| export_error("Could not create the selection file"))?;
    file.write_all(data)
        .and_then(|()| file.as_file().sync_all())
        .map_err(|_| export_error("Could not write the selection file"))?;
    file.persist_noclobber(path).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            export_error("The file already exists. Choose a new filename.")
        } else {
            export_error("Could not save the selection file")
        }
    })?;
    Ok(())
}

fn export_error(message: &'static str) -> AppError {
    AppError::new(AppErrorCode::ExportFailed, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_exact_utf8_and_preserves_existing_files() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("selection.csv");
        let data = "9223372036854775807,\"猫,\"\"😀\"\r\nNULL,\"\"";
        save_selection(&path, "csv", data.as_bytes()).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), data.as_bytes());
        assert_eq!(
            save_selection(&path, "csv", b"replace").unwrap_err().code,
            AppErrorCode::ExportFailed
        );
        assert_eq!(std::fs::read(&path).unwrap(), data.as_bytes());
        let bad = temp.path().join("existing.sqlite");
        assert!(save_selection(&bad, "csv", b"replace").is_err());
        assert!(!bad.exists());
    }
}
