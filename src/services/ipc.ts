import { decodeQueryId, decodeQueryJob } from "./query-protocol";

import { invoke } from "@tauri-apps/api/core";

import {
    IPC_PROTOCOL_VERSION,
    type AppInfo,
    type SqliteConnectionInfo,
    type SqliteSchemaSnapshot,
    type SqliteSchemaObject,
    type SqliteSchemaColumn,
    type SqliteSchemaObjectKind,
    type IpcCommandArgs,
    type IpcCommandName,
    type IpcCommandResult,
} from "./ipc-contract";

export type BackendErrorCode =
    | "INVALID_ARGUMENT"
    | "PROTOCOL_MISMATCH"
    | "INTERNAL"
    | "DATABASE_OPEN_FAILED"
    | "DATABASE_CLOSE_FAILED"
    | "CONNECTION_NOT_FOUND"
    | "CONNECTION_LIMIT_REACHED"
    | "SCHEMA_READ_FAILED"
    | "SCHEMA_TOO_LARGE"
    | "QUERY_FAILED";

export type IpcErrorCode =
    | BackendErrorCode
    | "TRANSPORT_ERROR"
    | "INVALID_RESPONSE";

const BACKEND_ERROR_CODES: ReadonlySet<string> = new Set([
    "INVALID_ARGUMENT",
    "PROTOCOL_MISMATCH",
    "INTERNAL",
    "DATABASE_OPEN_FAILED",
    "DATABASE_CLOSE_FAILED",
    "CONNECTION_NOT_FOUND",
    "CONNECTION_LIMIT_REACHED",
    "SCHEMA_READ_FAILED",
    "SCHEMA_TOO_LARGE",
    "QUERY_FAILED",
]);

export class IpcError extends Error {
    readonly code: IpcErrorCode;

    constructor(
        code: IpcErrorCode,
        message: string,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = "IpcError";
        this.code = code;
    }
}

function isRecord(
    value: unknown,
): value is Record<string, unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

function isBackendError(
    value: unknown,
): value is {
    code: BackendErrorCode;
    message: string;
} {
    return (
        isRecord(value) &&
        typeof value.code === "string" &&
        BACKEND_ERROR_CODES.has(value.code) &&
        typeof value.message === "string"
    );
}

export function normalizeIpcError(error: unknown): IpcError {
    if (error instanceof IpcError) {
        return error;
    }

    if (isBackendError(error)) {
        return new IpcError(error.code, error.message, {
            cause: error,
        });
    }

    return new IpcError(
        "TRANSPORT_ERROR",
        "Cannot communicate with Rust backend",
        { cause: error },
    );
}

// Decode an untrusted Rust response.
function decodeAppInfo(response: unknown): AppInfo {
    if (
        !isRecord(response) ||
        typeof response.appName !== "string" ||
        typeof response.version !== "string" ||
        typeof response.protocolVersion !== "number" ||
        !Number.isInteger(response.protocolVersion)
    ) {
        throw new IpcError(
            "INVALID_RESPONSE",
            "Invalid get_app_info IPC response",
        );
    }

    if (response.protocolVersion !== IPC_PROTOCOL_VERSION) {
        throw new IpcError(
            "PROTOCOL_MISMATCH",
            "Unsupported IPC protocol version",
        );
    }

    return {
        appName: response.appName,
        version: response.version,
        protocolVersion: response.protocolVersion,
    };
}

function decodeSqliteConnectionInfo(response: unknown): SqliteConnectionInfo {
    if (
        !isRecord(response) ||
        typeof response.id !== "string" ||
        !/^sqlite-[1-9]\d*$/.test(response.id) ||
        typeof response.path !== "string" ||
        response.path.length === 0 ||
        typeof response.readOnly !== "boolean"
    ) {
        throw new IpcError(
            "INVALID_RESPONSE",
            "Invalid SQLite connection IPC response",
        );
    }

    return {
        id: response.id,
        path: response.path,
        readOnly: response.readOnly,
    };
}

function decodeSqliteConnectionList(response: unknown): readonly SqliteConnectionInfo[] {
    if (!Array.isArray(response) || response.length > 32) {
        throw new IpcError(
            "INVALID_RESPONSE",
            "Invalid SQLite connection list IPC response",
        );
    }

    const entries: SqliteConnectionInfo[] = response.map(decodeSqliteConnectionInfo);
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
        throw new IpcError(
            "INVALID_RESPONSE",
            "Duplicate SQLite connection identifiers",
        );
    }
    return entries;
}

const SCHEMA_OBJECT_KINDS = new Set<SqliteSchemaObjectKind>([
    "table", "view", "index", "trigger",
]);
const MAX_SCHEMA_OBJECTS = 2048;
const MAX_SCHEMA_COLUMNS = 16384;
const MAX_COLUMNS_PER_OBJECT = 2048;
const MAX_METADATA_TEXT_BYTES = 65536;
const MAX_SCHEMA_TEXT_BYTES = 4 * 1024 * 1024;

function isMetadataText(value: unknown): value is string {
    return typeof value === "string" &&
        utf8ByteLength(value) <= MAX_METADATA_TEXT_BYTES;
}

function utf8ByteLength(value: string): number {
    let bytes = 0;
    for (const symbol of value) {
        const codePoint = symbol.codePointAt(0)!;
        bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    }
    return bytes;
}

function isNonNegativeSafeInt(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function decodeSchemaColumn(raw: unknown): SqliteSchemaColumn {
    if (!isRecord(raw) ||
        !isNonNegativeSafeInt(raw.cid) ||
        !isMetadataText(raw.name) ||
        !isMetadataText(raw.declaredType) ||
        typeof raw.notNull !== "boolean" ||
        !(raw.defaultSql === null || isMetadataText(raw.defaultSql)) ||
        !isNonNegativeSafeInt(raw.primaryKeyPosition) ||
        !isNonNegativeSafeInt(raw.hidden) || raw.hidden > 3) {
        throw new IpcError("INVALID_RESPONSE", "Invalid SQLite schema column");
    }
    return {
        cid: raw.cid,
        name: raw.name,
        declaredType: raw.declaredType,
        notNull: raw.notNull,
        defaultSql: raw.defaultSql,
        primaryKeyPosition: raw.primaryKeyPosition,
        hidden: raw.hidden,
    };
}

function decodeSchemaObject(raw: unknown): SqliteSchemaObject {
    if (!isRecord(raw) ||
        !SCHEMA_OBJECT_KINDS.has(raw.kind as SqliteSchemaObjectKind) ||
        !isMetadataText(raw.name) ||
        !isMetadataText(raw.tableName) ||
        !Array.isArray(raw.columns) ||
        raw.columns.length > MAX_COLUMNS_PER_OBJECT) {
        throw new IpcError("INVALID_RESPONSE", "Invalid SQLite schema object");
    }
    const columns = raw.columns.map(decodeSchemaColumn);
    if ((raw.kind === "index" || raw.kind === "trigger") && columns.length !== 0) {
        throw new IpcError("INVALID_RESPONSE", "Unexpected columns on SQLite schema object");
    }
    return {
        kind: raw.kind as SqliteSchemaObjectKind,
        name: raw.name,
        tableName: raw.tableName,
        columns,
    };
}

function decodeSchemaSnapshot(raw: unknown): SqliteSchemaSnapshot {
    if (!isRecord(raw) || raw.schema !== "main" ||
        !Array.isArray(raw.objects) || raw.objects.length > MAX_SCHEMA_OBJECTS) {
        throw new IpcError("INVALID_RESPONSE", "Invalid SQLite schema snapshot");
    }
    let columnCount = 0;
    let textBytes = 0;
    const objects: SqliteSchemaObject[] = [];
    for (const entry of raw.objects) {
        const object = decodeSchemaObject(entry);
        columnCount += object.columns.length;
        textBytes += utf8ByteLength(object.name) + utf8ByteLength(object.tableName);
        for (const column of object.columns) {
            textBytes += utf8ByteLength(column.name) + utf8ByteLength(column.declaredType);
            if (column.defaultSql !== null) textBytes += utf8ByteLength(column.defaultSql);
        }
        if (columnCount > MAX_SCHEMA_COLUMNS || textBytes > MAX_SCHEMA_TEXT_BYTES) {
            throw new IpcError("INVALID_RESPONSE", "SQLite schema response exceeds limits");
        }
        objects.push(object);
    }
    return { schema: "main", objects };
}

// Rust's unit type is serialized as null by Tauri.
// Undefined is also accepted for mocked transports.
function decodeVoid(response: unknown): void {
    if (response !== null && response !== undefined) {
        throw new IpcError(
            "INVALID_RESPONSE",
            "Invalid check_ipc_protocol IPC response",
        );
    }
}

// Every registered frontend command must have a decoder.
const RESPONSE_DECODERS: {
    [C in IpcCommandName]: (
        value: unknown,
    ) => IpcCommandResult<C>;
} = {
    start_sqlite_query: (value) => decodeQueryResponse(() => decodeQueryId(value)),
    poll_sqlite_query: (value) => decodeQueryResponse(() => decodeQueryJob(value)),
    cancel_sqlite_query: decodeVoid,
    get_app_info: decodeAppInfo,
    check_ipc_protocol: decodeVoid,
    open_sqlite_connection: decodeSqliteConnectionInfo,
    list_sqlite_connections: decodeSqliteConnectionList,
    close_sqlite_connection: decodeVoid,
    get_sqlite_schema: decodeSchemaSnapshot,
};

export async function invokeIpc<C extends IpcCommandName>(
    command: C,
    ...args: IpcCommandArgs<C> extends undefined
        ? []
        : [args: IpcCommandArgs<C>]
): Promise<IpcCommandResult<C>> {
    try {
        const response: unknown =
            args.length === 0
                ? await invoke<unknown>(command)
                : await invoke<unknown>(
                    command,
                    args[0] as Record<string, unknown>,
                );

        return RESPONSE_DECODERS[command](response);
    } catch (error: unknown) {
        throw normalizeIpcError(error);
    }
}

function decodeQueryResponse<T>(decode: () => T): T {
    try { return decode(); } catch {
        throw new IpcError("INVALID_RESPONSE", "Invalid SQL execution response");
    }
}
