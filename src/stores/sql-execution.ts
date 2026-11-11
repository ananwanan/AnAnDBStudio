import { useSyncExternalStore } from "react";
import { invokeIpc } from "@/services/ipc";
import type { QueryResult } from "@/services/query-protocol";
export interface Execution {
  draftId: string;
  connectionId: string;
  sql: string;
  sourceSql: string;
  selectionOffset: number;
  jobId: string | null;
  running: boolean;
  cancelRequested: boolean;
  result: QueryResult | null;
  error: string | null;
}
export interface HistoryEntry { sql: string; connectionId: string; status: string; time: string }
interface Snapshot { executions: Readonly<Record<string, Execution>>; selectedId: string | null; history: readonly HistoryEntry[] }
let snapshot: Snapshot = { executions: {}, selectedId: null, history: [] };
const listeners = new Set<() => void>();
function notify(next: Snapshot) { snapshot = next; listeners.forEach(fn => fn()); }
function update(id: string, changes: Partial<Execution>) {
  const execution = snapshot.executions[id];
  if (execution) notify({ ...snapshot, executions: { ...snapshot.executions, [id]: { ...execution, ...changes } } });
}
export function useSqlExecution() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot, () => snapshot);
}
export function selectExecution(id: string) { if (snapshot.executions[id]) notify({ ...snapshot, selectedId: id }); }
export function clearQueryHistory() { notify({ ...snapshot, history: [] }); }
export async function cancelExecution(id: string) {
  const item = snapshot.executions[id];
  if (!item?.running) return;
  update(id, { cancelRequested: true });
  if (item.jobId) {
    try { await invokeIpc("cancel_sqlite_query", { id: item.connectionId, jobId: item.jobId }); }
    catch (error) { update(id, { error: error instanceof Error ? error.message : "取消请求失败" }); }
  }
}
export async function executeSql(draftId: string, connectionId: string, sql: string, timeoutMs: number, sourceSql = sql, selectionOffset = 0, capture = false) {
  if (snapshot.executions[draftId]?.running) return;
  if (Object.values(snapshot.executions).some(e => e.running && e.connectionId === connectionId)) return;
  // Keep at most eight completed previews, plus live jobs (at most 32 connections).
  const executions = Object.fromEntries(Object.entries(snapshot.executions).filter(([, e]) => e.running));
  const completed = Object.entries(snapshot.executions).filter(([id, e]) => id !== draftId && !e.running).slice(-7);
  for (const [id, e] of completed) executions[id] = e;
  executions[draftId] = { draftId, connectionId, sql, sourceSql, selectionOffset, jobId: null, running: true, cancelRequested: false, result: null, error: null };
  notify({ ...snapshot, executions, selectedId: draftId });
  try {
    const jobId = await invokeIpc("start_sqlite_query", { id: connectionId, sql, timeoutMs, ...(capture ? { capture } : {}) });
    update(draftId, { jobId });
    if (snapshot.executions[draftId]?.cancelRequested) await cancelExecution(draftId);
    while (true) {
      const job = await invokeIpc("poll_sqlite_query", { id: connectionId, jobId });
      if (job.id !== jobId) throw new Error("Query job identifier mismatch");
      if (job.result) {
        update(draftId, { result: job.result, running: false });
        notify({ ...snapshot, history: [{ sql, connectionId, status: job.result.status, time: new Date().toISOString() }, ...snapshot.history].slice(0, 50) });
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  } catch (error) {
    const item = snapshot.executions[draftId];
    // On transport failure request cancellation; never report successful rollback.
    if (item?.jobId) await invokeIpc("cancel_sqlite_query", { id: connectionId, jobId: item.jobId }).catch(() => {});
    update(draftId, { running: false, error: error instanceof Error ? error.message : "SQL 执行失败" });
  }
}
