import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeSqliteConnection,
  listSqliteConnections,
  openSqliteConnection,
} from "@/services/sqlite-connections";
import { getSqliteSchema } from "@/services/sqlite-schema";

vi.mock("@/services/sqlite-connections", () => ({
  openSqliteConnection: vi.fn(),
  listSqliteConnections: vi.fn(),
  closeSqliteConnection: vi.fn(),
}));
vi.mock("@/services/sqlite-schema", () => ({ getSqliteSchema: vi.fn() }));

const list = vi.mocked(listSqliteConnections);
const open = vi.mocked(openSqliteConnection);
const close = vi.mocked(closeSqliteConnection);
const schema = vi.mocked(getSqliteSchema);
const db1 = { id: "sqlite-1", path: "/tmp/db.sqlite", readOnly: true };
const db2 = { id: "sqlite-2", path: "/tmp/other.db", readOnly: false };
const metadata = { schema: "main" as const, objects: [] };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  list.mockResolvedValue([]);
  schema.mockResolvedValue(metadata);
});

describe("SQLite workspace state", () => {
  it("starts with no phantom handles and opens a read-only database", async () => {
    const store = await import("./sqlite-workspace");
    await store.initializeSqliteWorkspace();
    expect(store.useSqliteWorkspace).toBeDefined();
    expect(store.useSqliteWorkspace).toBeTypeOf("function");
    open.mockResolvedValueOnce(db1);
    await store.addSqliteConnection(db1.path, true);
    expect(open).toHaveBeenCalledWith(db1.path, true);
    store.selectSqliteConnection(db1.id);
    // Deferred schema request has an independent lifecycle.
    await Promise.resolve();
    expect(schema).toHaveBeenCalledWith(db1.id);
  });

  it("preserves multiple handles and refreshes their schemas independently", async () => {
    list.mockResolvedValueOnce([db1, db2]);
    const store = await import("./sqlite-workspace");
    await store.initializeSqliteWorkspace();
    store.selectSqliteConnection(db2.id);
    await store.refreshSqliteSchema(db2.id);
    expect(schema).toHaveBeenCalledWith(db1.id);
    expect(schema).toHaveBeenCalledWith(db2.id);
    close.mockResolvedValueOnce(undefined);
    await store.removeSqliteConnection(db2.id);
    expect(close).toHaveBeenCalledWith(db2.id);
    await store.refreshSqliteSchema(db2.id);
    expect(schema).toHaveBeenCalledTimes(3);
  });

  it("reconciles the list when closing fails after backend removal", async () => {
    list.mockResolvedValueOnce([db1]);
    close.mockRejectedValueOnce(new Error("busy handle"));
    const store = await import("./sqlite-workspace");
    await store.initializeSqliteWorkspace();
    await expect(store.removeSqliteConnection(db1.id)).rejects.toThrow("busy handle");
    expect(close).toHaveBeenCalledWith(db1.id);
    // Registry is authoritative: a failed native close may still remove the handle.
    store.selectSqliteConnection(db1.id);
    await store.refreshSqliteSchema(db1.id);
    expect(schema).toHaveBeenCalledTimes(1);
  });

  it("does not open a database if registry initialization fails", async () => {
    list.mockRejectedValueOnce(new Error("IPC unavailable"));
    const store = await import("./sqlite-workspace");
    await expect(store.addSqliteConnection(db1.path, true)).rejects.toThrow("IPC unavailable");
    expect(open).not.toHaveBeenCalled();
  });
});
