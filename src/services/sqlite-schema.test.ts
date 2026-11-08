import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IpcError } from "./ipc";
import { getSqliteSchema } from "./sqlite-schema";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

const column = {
    cid: 0,
    name: "id",
    declaredType: "INTEGER",
    notNull: false,
    defaultSql: null,
    primaryKeyPosition: 1,
    hidden: 0,
};
const snapshot = {
    schema: "main",
    objects: [
        { kind: "table", name: 'a"b', tableName: 'a"b', columns: [column] },
        { kind: "index", name: "ix", tableName: 'a"b', columns: [] },
    ],
};

beforeEach(() => mockedInvoke.mockReset());

describe("SQLite schema IPC", () => {
    it("passes the typed handle and decodes schema metadata", async () => {
        mockedInvoke.mockResolvedValueOnce(snapshot);
        await expect(getSqliteSchema("sqlite-1")).resolves.toEqual(snapshot);
        expect(mockedInvoke).toHaveBeenCalledExactlyOnceWith(
            "get_sqlite_schema", { id: "sqlite-1" },
        );
    });

    it("retains generated columns and defaults", async () => {
        const generated = { ...column, name: "computed", hidden: 3, defaultSql: "'abc'" };
        mockedInvoke.mockResolvedValueOnce({
            schema: "main",
            objects: [{ kind: "view", name: "v", tableName: "v", columns: [generated] }],
        });
        const response = await getSqliteSchema("sqlite-2");
        expect(response.objects[0].columns[0]).toEqual(generated);
    });

    it("rejects malformed shapes and invalid column flags", async () => {
        mockedInvoke.mockResolvedValueOnce({ ...snapshot, schema: "temp" });
        await expect(getSqliteSchema("sqlite-1")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

        mockedInvoke.mockResolvedValueOnce({
            schema: "main",
            objects: [{ ...snapshot.objects[0], columns: [{ ...column, hidden: 9 }] }],
        });
        await expect(getSqliteSchema("sqlite-1")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    });

    it("rejects oversized responses", async () => {
        mockedInvoke.mockResolvedValueOnce({
            schema: "main",
            objects: Array.from({ length: 2049 }, () => snapshot.objects[1]),
        });
        await expect(getSqliteSchema("sqlite-1")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    });

    it("preserves typed backend errors", async () => {
        mockedInvoke.mockRejectedValueOnce({
            code: "SCHEMA_TOO_LARGE",
            message: "SQLite schema is too large for a single metadata response",
        });
        const caught: unknown = await getSqliteSchema("sqlite-1").then(
            () => undefined,
            (error: unknown) => error,
        );
        expect(caught).toBeInstanceOf(IpcError);
        expect(caught).toMatchObject({ code: "SCHEMA_TOO_LARGE" });
    });
});

// Compile-time contract check only.
function assertSchemaTypes() {
    // @ts-expect-error Schema lookup requires a connection ID string.
    void getSqliteSchema(123);
}
void assertSchemaTypes;
