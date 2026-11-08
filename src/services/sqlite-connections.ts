import { invokeIpc } from "./ipc";
import type { SqliteConnectionInfo } from "./ipc-contract";

export type { SqliteConnectionInfo };

// Only connects to an existing on-disk database.
export function openSqliteConnection(path: string, readOnly: boolean) {
    return invokeIpc("open_sqlite_connection", { path, readOnly });
}

export function listSqliteConnections() {
    return invokeIpc("list_sqlite_connections");
}

export function closeSqliteConnection(id: string) {
    return invokeIpc("close_sqlite_connection", { id });
}
