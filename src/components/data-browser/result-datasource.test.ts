import { expect, it, vi } from "vitest";
import type { IGetRowsParams } from "ag-grid-community";
import type { ResultPage } from "@/services/browse-protocol";
import { createResultDatasource } from "./result-datasource";

function block(startRow: number) {
  return {
    startRow, endRow: startRow + 25,
    successCallback: vi.fn(), failCallback: vi.fn(),
  } as unknown as IGetRowsParams;
}

it("deduplicates in-flight blocks, supports out-of-order results and discards stale pages", async () => {
  const responses = new Map<number, (page: ResultPage) => void>();
  const read = vi.fn((offset: number, _limit: number, _signal: AbortSignal) => new Promise<ResultPage>(resolve => responses.set(offset, resolve)));
  const onLoading = vi.fn();
  const onPage = vi.fn();
  const datasource = createResultDatasource(read, onLoading, onPage, vi.fn());
  const first = block(0);
  const duplicate = block(0);
  const far = block(999_900);
  datasource.getRows(first);
  datasource.getRows(duplicate);
  datasource.getRows(far);
  expect(read.mock.calls.map(([offset, limit]) => [offset, limit])).toEqual([[0, 25], [999_900, 25]]);
  expect(onLoading).toHaveBeenLastCalledWith(2);
  const page: ResultPage = { rows: [[{ type: "integer", value: "999901" }]], end: true };
  responses.get(999_900)?.(page);
  await vi.waitFor(() => expect(far.successCallback).toHaveBeenCalledWith(page.rows, 999_901));
  datasource.destroy?.();
  expect(read.mock.calls[0][2].aborted).toBe(true);
  responses.get(0)?.(page);
  await Promise.resolve();
  expect(first.successCallback).not.toHaveBeenCalled();
  expect(duplicate.successCallback).not.toHaveBeenCalled();
  expect(onPage).toHaveBeenCalledExactlyOnceWith(999_900, page);
});

it("reports page errors instead of treating them as empty results", async () => {
  const failure = new Error("Expired");
  const onError = vi.fn();
  const request = block(25);
  createResultDatasource(async () => { throw failure; }, vi.fn(), vi.fn(), onError).getRows(request);
  await vi.waitFor(() => expect(request.failCallback).toHaveBeenCalledOnce());
  expect(onError).toHaveBeenCalledWith(failure);
});
