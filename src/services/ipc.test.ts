
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    IpcError,
    invokeIpc,
    normalizeIpcError,
} from "./ipc";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
    invokeMock.mockReset();
});

describe("IPC error contract", () => {
    it("preserves structured backend errors", () => {
        const error = normalizeIpcError({
            code: "PROTOCOL_MISMATCH",
            message: "Unsupported IPC protocol version",
        });

        expect(error).toBeInstanceOf(IpcError);
        expect(error.code).toBe("PROTOCOL_MISMATCH");
        expect(error.message).toBe(
            "Unsupported IPC protocol version",
        );
    });

    it("normalizes unknown errors", () => {
        const error = normalizeIpcError("Unexpected failure");

        expect(error.code).toBe("TRANSPORT_ERROR");
        expect(error.message).toBe(
            "Cannot communicate with Rust backend",
        );
    });

    it("rejects unknown backend error codes", () => {
        const error = normalizeIpcError({
            code: "SOME_UNKNOWN_ERROR",
            message: "Unexpected response",
        });

        expect(error.code).toBe("TRANSPORT_ERROR");
    });

    it("preserves existing IPC errors", () => {
        const original = new IpcError(
            "INVALID_RESPONSE",
            "Bad response",
        );

        expect(normalizeIpcError(original)).toBe(original);
    });

    it("returns successful command results", async () => {
        invokeMock.mockResolvedValue({ ok: true });

        await expect(
            invokeIpc<{ ok: boolean }>("test_command"),
        ).resolves.toEqual({ ok: true });
    });

    it("converts rejected commands into IpcError", async () => {
        invokeMock.mockRejectedValue({
            code: "INVALID_ARGUMENT",
            message: "Invalid request",
        });

        await expect(
            invokeIpc("test_command"),
        ).rejects.toMatchObject({
            code: "INVALID_ARGUMENT",
            message: "Invalid request",
        });
    });

    it("does not pass arguments to parameterless commands", async () => {
        invokeMock.mockResolvedValue({ ok: true });

        await invokeIpc("get_app_info");

        expect(invokeMock).toHaveBeenCalledExactlyOnceWith(
            "get_app_info",
        );
    });
});
