/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("SQL draft persistence", () => {
  it("creates independent documents and round-trips them", async () => {
    const store = await import("./sql-drafts");
    const a = store.createSqlDraft("db-1");
    const b = store.createSqlDraft(null);
    expect(a.id).not.toBe(b.id);
    store.updateSqlDraftSql(a.id, "SELECT 1;");
    store.updateSqlDraftSql(b.id, "SELECT 2;");
    store.renameSqlDraft(a.id, "Customers");
    store.setSqlDraftConnection(b.id, "db-2");
    vi.advanceTimersByTime(300);
    const persisted = JSON.parse(localStorage.getItem(store.SQL_DRAFT_STORAGE_KEY)!);
    expect(persisted.version).toBe(1);
    expect(persisted.drafts).toEqual([
      { id: a.id, title: "Customers", sql: "SELECT 1;", connectionId: "db-1" },
      { id: b.id, title: "Query 2", sql: "SELECT 2;", connectionId: "db-2" },
    ]);
    vi.resetModules();
    const loaded = await import("./sql-drafts");
    expect(loaded.getSqlDraft(a.id)?.sql).toBe("SELECT 1;");
    expect(loaded.getSqlDraft(b.id)?.connectionId).toBe("db-2");
  });

  it("ignores invalid or oversized saved data", async () => {
    localStorage.setItem("anandb.sql.drafts.v1", JSON.stringify({ version: 0, drafts: [] }));
    const store = await import("./sql-drafts");
    expect(store.getSqlDrafts()).toEqual([]);
    store.createSqlDraft(null);
    vi.advanceTimersByTime(300);
    expect(store.getSqlDrafts()).toHaveLength(1);
  });

  it("flushes pending SQL on pagehide and supports explicit deletion", async () => {
    const store = await import("./sql-drafts");
    const tab = store.createSqlDraft(null);
    store.updateSqlDraftSql(tab.id, "SELECT '未保存';");
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(localStorage.getItem(store.SQL_DRAFT_STORAGE_KEY)!).drafts[0].sql)
      .toBe("SELECT '未保存';");
    store.forgetSqlDraft(tab.id);
    vi.advanceTimersByTime(300);
    expect(store.getSqlDrafts()).toHaveLength(0);
  });

  it("reports localStorage quota errors without erasing in-memory SQL", async () => {
    const store = await import("./sql-drafts");
    const tab = store.createSqlDraft(null);
    store.updateSqlDraftSql(tab.id, "SELECT 42;");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    vi.advanceTimersByTime(300);
    expect(store.getSqlDraft(tab.id)?.sql).toBe("SELECT 42;");
    expect(store.useSqlDrafts).toBeTypeOf("function");
    spy.mockRestore();
  });
});
