
import { invoke } from "@tauri-apps/api/core";
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import {
    IpcError,
    invokeIpc,
    normalizeIpcError,
} from "./ipc";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

const validAppInfo = {
    appName: "AnAnDB Studio",
    version: "0.1.0",
    protocolVersion: 1,
};

beforeEach(() => {
    invokeMock.mockReset();
});

describe("typed IPC", () => {
    it("decodes app info", async () => {
        invokeMock.mockResolvedValue(validAppInfo);

        await expect(
            invokeIpc("get_app_info"),
        ).resolves.toEqual(validAppInfo);

        expect(invokeMock).toHaveBeenCalledExactlyOnceWith(
            "get_app_info",
        );
    });

    it("passes typed command arguments", async () => {
        invokeMock.mockResolvedValue(null);

        await expect(
            invokeIpc("check_ipc_protocol", {
                protocolVersion: 1,
            }),
        ).resolves.toBeUndefined();

        expect(invokeMock).toHaveBeenCalledWith(
            "check_ipc_protocol",
            { protocolVersion: 1 },
        );
    });

    it("rejects invalid response shapes", async () => {
        invokeMock.mockResolvedValue({
            appName: "AnAnDB Studio",
            version: 123,
            protocolVersion: 1,
        });

        await expect(
            invokeIpc("get_app_info"),
        ).rejects.toMatchObject({
            code: "INVALID_RESPONSE",
        });
    });

    it("rejects unsupported versions", async () => {
        invokeMock.mockResolvedValue({
            ...validAppInfo,
            protocolVersion: 2,
        });

        await expect(
            invokeIpc("get_app_info"),
        ).rejects.toMatchObject({
            code: "PROTOCOL_MISMATCH",
        });
    });

    it("rejects unexpected unit responses", async () => {
        invokeMock.mockResolvedValue({ unexpected: true });

        await expect(
            invokeIpc("check_ipc_protocol", {
                protocolVersion: 1,
            }),
        ).rejects.toMatchObject({
            code: "INVALID_RESPONSE",
        });
    });

    it("preserves backend errors", async () => {
        invokeMock.mockRejectedValue({
            code: "INVALID_ARGUMENT",
            message: "Invalid request",
        });

        await expect(
            invokeIpc("get_app_info"),
        ).rejects.toMatchObject({
            code: "INVALID_ARGUMENT",
            message: "Invalid request",
        });
    });

    it("normalizes unknown failures", async () => {
        invokeMock.mockRejectedValue("Unexpected failure");

        await expect(
            invokeIpc("get_app_info"),
        ).rejects.toMatchObject({
            code: "TRANSPORT_ERROR",
        });
    });

    it("does not accept unknown backend codes", () => {
        const error = normalizeIpcError({
            code: "UNKNOWN_CODE",
            message: "Error",
        });

        expect(error.code).toBe("TRANSPORT_ERROR");
    });

    it("preserves existing IpcError instances", () => {
        const original = new IpcError(
            "INVALID_RESPONSE",
            "Bad response",
        );

        expect(normalizeIpcError(original)).toBe(original);
    });
});

// Compile-time contract assertions; this function is not executed.
function assertCommandTypes(): void {
    // @ts-expect-error Unknown command must be rejected.
    void invokeIpc("unknown_command");

    // @ts-expect-error This command requires arguments.
    void invokeIpc("check_ipc_protocol");

    // @ts-expect-error Parameterless command rejects arguments.
    void invokeIpc("get_app_info", { value: 1 });

    void invokeIpc("check_ipc_protocol", {
        // @ts-expect-error Protocol version must be a number.
        protocolVersion: "1",
    });
}

void assertCommandTypes;
