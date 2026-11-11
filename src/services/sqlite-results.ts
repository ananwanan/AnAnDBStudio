import { invokeIpc, IpcError } from "./ipc";
import type { ResultInfo, TableRequest } from "./browse-protocol";

const TIMEOUT_MS = 30_000;

async function whenConnectionAvailable<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
  // Busy requests were rejected before reaching SQLite. Only these are safe to retry.
  const started = performance.now();
  while (true) {
    signal.throwIfAborted();
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof IpcError) || error.code !== "CONNECTION_BUSY" ||
        performance.now() - started >= TIMEOUT_MS) throw error;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
}

export function openTable(connectionId: string, request: TableRequest, signal: AbortSignal) {
  return whenConnectionAvailable(
    () => invokeIpc("open_sqlite_table_result", { id: connectionId, request, timeoutMs: TIMEOUT_MS }),
    signal,
  );
}

export async function readResultPage(connectionId: string, info: ResultInfo, offset: number, limit: number, signal: AbortSignal) {
  const page = await whenConnectionAvailable(() => invokeIpc("get_sqlite_result_page", {
    id: connectionId, sessionId: info.id, offset, limit, timeoutMs: TIMEOUT_MS,
  }), signal);
  signal.throwIfAborted();
  if (page.rows.some(row => row.length !== info.columns.length) ||
    page.rows.length > limit || (!page.end && page.rows.length !== limit)) {
    throw new IpcError("INVALID_RESPONSE", "Result page does not match the requested dimensions");
  }
  return page;
}

export async function releaseResult(connectionId: string, sessionId: string) {
  try {
    await invokeIpc("close_sqlite_result", { id: connectionId, sessionId });
  } catch (error) {
    // Closing the connection already releases every session on it.
    if (!(error instanceof IpcError) || error.code !== "CONNECTION_NOT_FOUND") throw error;
  }
}

export function exportSelection(format: "csv" | "tsv", data: string) {
  return invokeIpc("export_sqlite_selection", { format, data });
}
