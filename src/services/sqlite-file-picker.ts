import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/** Returns an OS file path or null when the user cancels. Desktop-only. */
export async function chooseSqliteFile(): Promise<string | null> {
  if (!isTauri()) {
    throw new Error("请在 AnAnDB Studio 桌面应用中选择文件。");
  }

  const path = await open({
    title: "选择现有 SQLite 数据库",
    directory: false,
    multiple: false,
    // Do not constrain the extension: valid SQLite files may have any suffix.
  });
  return path;
}
