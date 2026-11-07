
import { invoke } from "@tauri-apps/api/core";

import {
    IPC_PROTOCOL_VERSION,
    type AppInfo,
    type IpcCommandArgs,
    type IpcCommandName,
    type IpcCommandResult,
} from "./ipc-contract";

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
    get_app_info: decodeAppInfo,
    check_ipc_protocol: decodeVoid,
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
