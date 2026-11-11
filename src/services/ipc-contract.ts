import type { QueryJob } from "./query-protocol";

export const IPC_PROTOCOL_VERSION = 1;

export interface AppInfo {
    readonly appName: string;
    readonly version: string;
    readonly protocolVersion: number;
}

export interface SqliteConnectionInfo {
    readonly id: string;
    readonly path: string;
    readonly readOnly: boolean;
}

export type SqliteSchemaObjectKind = "table" | "view" | "index" | "trigger";

export interface SqliteSchemaColumn {
    readonly cid: number;
    readonly name: string;
    readonly declaredType: string;
    readonly notNull: boolean;
    readonly defaultSql: string | null;
    readonly primaryKeyPosition: number;
    readonly hidden: number;
}

export interface SqliteSchemaObject {
    readonly kind: SqliteSchemaObjectKind;
    readonly name: string;
    readonly tableName: string;
    readonly columns: readonly SqliteSchemaColumn[];
}

export interface SqliteSchemaSnapshot {
    readonly schema: "main";
    readonly objects: readonly SqliteSchemaObject[];
}

export interface IpcCommands {
    start_sqlite_query: { args: { id: string; sql: string; timeoutMs: number }; result: string };
    poll_sqlite_query: { args: { id: string; jobId: string }; result: QueryJob };
    cancel_sqlite_query: { args: { id: string; jobId: string }; result: void };

    get_app_info: {
        args: undefined;
        result: AppInfo;
    };

    check_ipc_protocol: {
        args: {
            readonly protocolVersion: number;
        };
        result: void;
    };

    open_sqlite_connection: {
        args: {
            readonly path: string;
            readonly readOnly: boolean;
        };
        result: SqliteConnectionInfo;
    };

    list_sqlite_connections: {
        args: undefined;
        result: readonly SqliteConnectionInfo[];
    };

    close_sqlite_connection: {
        args: { readonly id: string };
        result: void;
    };

    get_sqlite_schema: {
        args: { readonly id: string };
        result: SqliteSchemaSnapshot;
    };
}

export type IpcCommandName = keyof IpcCommands;

export type IpcCommandArgs<C extends IpcCommandName> =
    IpcCommands[C]["args"];

export type IpcCommandResult<C extends IpcCommandName> =
    IpcCommands[C]["result"];
