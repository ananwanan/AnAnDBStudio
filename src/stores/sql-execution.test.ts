/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/services/ipc", () => ({ invokeIpc: invoke }));
const result = { statements: [], error: null, status: "completed", elapsedMs: 2, transactionOpen: false, rolledBack: false };
beforeEach(() => { vi.resetModules(); invoke.mockReset(); });
afterEach(() => vi.useRealTimers());
describe("query job lifecycle", () => {
  it("submits exact SQL, binds results to draft and records session history", async () => {
    invoke.mockResolvedValueOnce("1").mockResolvedValueOnce({ id: "1", result });
    const store = await import("./sql-execution");
    const { result: state } = renderHook(store.useSqlExecution);
    await act(() => store.executeSql("draft-a", "sqlite-1", "SELECT 1", 30000, "-- comment\nSELECT 1", 11));
    expect(invoke).toHaveBeenNthCalledWith(1, "start_sqlite_query", { id: "sqlite-1", sql: "SELECT 1", timeoutMs: 30000 });
    expect(state.current.executions["draft-a"]).toMatchObject({ result, running: false, selectionOffset: 11 });
    expect(state.current.history).toHaveLength(1);
    act(store.clearQueryHistory);
    expect(state.current.history).toHaveLength(0);
  });
  it("cancels even if requested before start returns and prevents duplicate submission", async () => {
    let resolveStart!: (id: string) => void;
    invoke.mockImplementation((command) => command === "start_sqlite_query" ? new Promise<string>(r => { resolveStart = r; }) :
      command === "poll_sqlite_query" ? Promise.resolve({ id: "1", result: { ...result, status: "cancelled" } }) : Promise.resolve());
    const store = await import("./sql-execution");
    const { result: state } = renderHook(store.useSqlExecution);
    let run!: Promise<void>;
    act(() => { run = store.executeSql("a", "sqlite-1", "SELECT 1", 30000); });
    await act(() => store.executeSql("b", "sqlite-1", "SELECT 2", 30000));
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(() => store.cancelExecution("a"));
    await act(async () => { resolveStart("1"); await run; });
    expect(invoke).toHaveBeenCalledWith("cancel_sqlite_query", { id: "sqlite-1", jobId: "1" });
    expect(state.current.executions.a.running).toBe(false);
  });
  it("reports transport failure and requests cleanup without claiming success", async () => {
    invoke.mockResolvedValueOnce("1").mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(undefined);
    const store = await import("./sql-execution");
    const { result: state } = renderHook(store.useSqlExecution);
    await act(() => store.executeSql("a", "sqlite-1", "SELECT 1", 1000));
    expect(state.current.executions.a).toMatchObject({ running: false, result: null, error: "Offline" });
    expect(state.current.history).toHaveLength(0);
    expect(invoke).toHaveBeenLastCalledWith("cancel_sqlite_query", { id: "sqlite-1", jobId: "1" });
  });
  it("bounds completed result retention and history", async () => {
    invoke.mockImplementation(command => Promise.resolve(command === "start_sqlite_query" ? "1" : { id: "1", result }));
    const store = await import("./sql-execution");
    const { result: state } = renderHook(store.useSqlExecution);
    await act(async () => { for (let i = 0; i < 55; i++) await store.executeSql(`q-${i}`, "sqlite-1", "SELECT 1", 1000); });
    expect(Object.keys(state.current.executions)).toHaveLength(8);
    expect(state.current.history).toHaveLength(50);
  });
  it("polls pending jobs until the backend reports completion", async () => {
    invoke.mockResolvedValueOnce("1").mockResolvedValueOnce({ id: "1", result: null }).mockResolvedValueOnce({ id: "1", result });
    const store = await import("./sql-execution");
    const { result: state } = renderHook(store.useSqlExecution);
    act(() => { void store.executeSql("a", "sqlite-1", "SELECT 1", 1000); });
    await waitFor(() => expect(state.current.executions.a.running).toBe(false));
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
