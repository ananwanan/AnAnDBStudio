
import { invoke } from "@tauri-apps/api/core";

export type BackendErrorCode =
    | "INVALID_ARGUMENT"
    | "PROTOCOL_MISMATCH"
    | "INTERNAL";

export type IpcErrorCode =
    | BackendErrorCode
    | "TRANSPORT_ERROR"
    | "INVALID_RESPONSE";

const BACKEND_ERROR_CODES: ReadonlySet<string> = new Set([
    "INVALID_ARGUMENT",
    "PROTOCOL_MISMATCH",
    "INTERNAL",
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

interface BackendError {
    code: BackendErrorCode;
    message: string;
}

function isBackendError(value: unknown): value is BackendError {
    if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value)
    ) {
        return false;
    }

    const record = value as Record<string, unknown>;

    return (
        typeof record.code === "string" &&
        BACKEND_ERROR_CODES.has(record.code) &&
        typeof record.message === "string"
    );
}

export function normalizeIpcError(error: unknown): IpcError {
    if (error instanceof IpcError) {
        return error;
    }

    if (isBackendError(error)) {
        return new IpcError(
            error.code,
            error.message,
            { cause: error },
        );
    }

    return new IpcError(
        "TRANSPORT_ERROR",
        "Cannot communicate with Rust backend",
        { cause: error },
    );
}


export async function invokeIpc<T>(
    command: string,
    args?: Record<string, unknown>,
): Promise<T> {
    try {
        if (args === undefined) {
            return await invoke<T>(command);
        }

        return await invoke<T>(command, args);
    } catch (error: unknown) {
        throw normalizeIpcError(error);
    }
}

