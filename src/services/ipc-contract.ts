import type { ResultInfo, ResultPage, TableRequest } from "./browse-protocol";
import type { QueryJob } from "./query-protocol";
import type { EditResult } from "./edit-protocol";

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
    start_sqlite_query: { args: { id: string; sql: string; timeoutMs: number; capture?: boolean }; result: string };
    poll_sqlite_query: { args: { id: string; jobId: string }; result: QueryJob };
    open_sqlite_table_result: { args: { id: string; request: TableRequest; timeoutMs: number; countRows?: boolean }; result: ResultInfo };
    get_sqlite_result_page: { args: { id: string; sessionId: string; offset: number; limit: number; timeoutMs: number }; result: ResultPage };
    close_sqlite_result: { args: { id: string; sessionId: string }; result: void };
    commit_sqlite_edit: { args: { id: string; sessionId: string; operationId: string; payload: string; timeoutMs: number }; result: EditResult };
    cancel_sqlite_edit: { args: { id: string; operationId: string }; result: void };
    export_sqlite_selection: { args: { format: "csv" | "tsv"; data: string }; result: boolean };
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
