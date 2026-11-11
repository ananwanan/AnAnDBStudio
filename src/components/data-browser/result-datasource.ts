import type { IDatasource } from "ag-grid-community";
import type { ResultPage } from "@/services/browse-protocol";

export function createResultDatasource(
  read: (offset: number, limit: number, signal: AbortSignal) => Promise<ResultPage>,
  onLoading: (pending: number) => void,
  onPage: (offset: number, page: ResultPage) => void,
  onError: (error: unknown) => void,
  rowCount?: number,
): IDatasource {
  const controller = new AbortController();
  const pending = new Map<string, Promise<ResultPage>>();
  let lastRow = rowCount;

  return {
    getRows(params) {
      if (controller.signal.aborted) return;
      const { startRow, endRow } = params;
      if (lastRow !== undefined && startRow >= lastRow) {
        params.successCallback([], lastRow);
        return;
      }
      const key = `${startRow}:${endRow}`;
      let request = pending.get(key);
      if (!request) {
        request = read(startRow, endRow - startRow, controller.signal).finally(() => {
          pending.delete(key);
          if (!controller.signal.aborted) onLoading(pending.size);
        });
        pending.set(key, request);
        onLoading(pending.size);
      }
      void request.then(page => {
        if (controller.signal.aborted) return;
        if (page.end) lastRow = Math.min(lastRow ?? Infinity, startRow + page.rows.length);
        params.successCallback(page.rows, lastRow);
        onPage(startRow, page);
      }, error => {
        if (controller.signal.aborted) return;
        params.failCallback();
        onError(error);
      });
    },
    destroy() {
      controller.abort();
      pending.clear();
    },
  };
}
