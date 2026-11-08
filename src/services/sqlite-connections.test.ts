import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { closeSqliteConnection, listSqliteConnections, openSqliteConnection } from "./sqlite-connections";
import { IpcError } from "./ipc";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

const sample = { id: "sqlite-1", path: "/tmp/sample.sqlite", readOnly: true };

beforeEach(() => mockedInvoke.mockReset());

describe("SQLite connection IPC", () => {
    it("opens an existing file with explicit mode", async () => {
        mockedInvoke.mockResolvedValue(sample);
        await expect(openSqliteConnection("/tmp/sample.sqlite", true)).resolves.toEqual(sample);
        expect(mockedInvoke).toHaveBeenCalledWith("open_sqlite_connection", {
            path: "/tmp/sample.sqlite", readOnly: true,
        });
    });

    it("lists decoded connection entries", async () => {
        mockedInvoke.mockResolvedValue([sample]);
        await expect(listSqliteConnections()).resolves.toEqual([sample]);
        expect(mockedInvoke).toHaveBeenCalledWith("list_sqlite_connections");
    });

    it("closes the selected connection", async () => {
        mockedInvoke.mockResolvedValue(null);
        await expect(closeSqliteConnection("sqlite-1")).resolves.toBeUndefined();
        expect(mockedInvoke).toHaveBeenCalledWith("close_sqlite_connection", { id: "sqlite-1" });
    });

    it("rejects malformed lists and duplicate IDs", async () => {
        mockedInvoke.mockResolvedValueOnce([{ ...sample, readOnly: "yes" }]);
        await expect(listSqliteConnections()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
        mockedInvoke.mockResolvedValueOnce([sample, sample]);
        await expect(listSqliteConnections()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    });

    it("retains typed backend errors", async () => {
        const backendError = {
            code: "CONNECTION_NOT_FOUND",
            message: "SQLite connection not found",
        };
        mockedInvoke.mockRejectedValueOnce(backendError);

        // Capture the normalized rejection as a value for precise assertions.
        const caught: unknown = await closeSqliteConnection("sqlite-42").then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(caught).toBeInstanceOf(IpcError);
        expect(caught).toMatchObject({
            name: "IpcError",
            code: "CONNECTION_NOT_FOUND",
            message: "SQLite connection not found",
        });
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith(
            "close_sqlite_connection",
            { id: "sqlite-42" },
        );
    });
});

// Compile-time contract checks only.
function assertSqliteTypes() {
    // @ts-expect-error The open command requires a boolean readOnly argument.
    void openSqliteConnection("file.sqlite", "true");
    // @ts-expect-error The close command requires a connection identifier.
    void closeSqliteConnection(123);
}
void assertSqliteTypes;
