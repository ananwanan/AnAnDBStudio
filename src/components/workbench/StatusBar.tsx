import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { CheckCircle2, Database } from "lucide-react";

import { useSqliteWorkspace } from "@/stores/sqlite-workspace";
import { getAppInfo } from "@/services/app-info";

type IpcStatus =
  | { state: "browser" }
  | { state: "connecting" }
  | { state: "connected"; protocolVersion: number }
  | { state: "error" };

export function StatusBar() {
  const { connections, selectedId } = useSqliteWorkspace();
  const selected = connections.find(connection => connection.id === selectedId);
  const [ipc, setIpc] = useState<IpcStatus>(() => ({
    state: isTauri() ? "connecting" : "browser",
  }));

  useEffect(() => {
    if (!isTauri()) return;

    let mounted = true;
    getAppInfo()
      .then((info) => {
        if (mounted) {
          setIpc({ state: "connected", protocolVersion: info.protocolVersion });
        }
      })
      .catch(() => {
        if (mounted) setIpc({ state: "error" });
      });

    return () => {
      mounted = false;
    };
  }, []);

  const ipcLabel =
    ipc.state === "connected"
      ? `Rust IPC connected · protocol ${ipc.protocolVersion}`
      : ipc.state === "connecting"
        ? "Connecting to Rust IPC…"
        : ipc.state === "error"
          ? "Rust IPC check failed"
          : "Browser preview · IPC unavailable";

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t bg-card px-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-3.5" />
        <span>Ready</span>
        <span>·</span>
        <span className="max-w-36 truncate" title={selected?.path}>{selected?.path.split(/[/\\]/).pop() ?? "未连接数据库"}</span>
        <span>·</span>
        <span role="status">{ipcLabel}</span>
      </div>

      <div className="flex items-center gap-2">
        <Database className="size-3.5" />
        <span>SQLite</span>
      </div>
    </footer>
  );
}
