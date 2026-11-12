/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowseRow, ResultInfo, ResultPage } from "@/services/browse-protocol";
import { DataGrid } from "./DataGrid";
import { useTableEdits } from "./use-table-edits";

const { readResultPage, exportSelection } = vi.hoisted(() => ({
  readResultPage: vi.fn(), exportSelection: vi.fn(async (_format: string, _data: string) => true),
}));
vi.mock("@/services/sqlite-results", () => ({ readResultPage, exportSelection }));

beforeEach(() => {
  readResultPage.mockReset();
  for (const property of ["clientHeight", "offsetHeight"] as const) {
    vi.spyOn(HTMLElement.prototype, property, "get").mockReturnValue(260);
  }
  for (const property of ["clientWidth", "offsetWidth"] as const) {
    vi.spyOn(HTMLElement.prototype, property, "get").mockReturnValue(720);
  }
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const info: ResultInfo = { id: "1", columns: ["duplicate", "duplicate"], maxPageSize: 100, rowCount: 2 };

it("renders duplicate columns and typed data and copies a rectangular selection in Community mode", async () => {
  let resolvePage!: (page: ResultPage) => void;
  readResultPage.mockReturnValue(new Promise(resolve => { resolvePage = resolve; }));
  const copy = vi.fn(async () => {});
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  try {
    const view = render(<div style={{ height: 320, width: 720 }}>
      <DataGrid connectionId="sqlite-1" info={info} pageSize={25} onCancel={vi.fn()} />
    </div>);
    await waitFor(() => expect(readResultPage).toHaveBeenCalledWith("sqlite-1", info, 0, 25, expect.any(AbortSignal)));
    expect(screen.getByText(/正在加载/)).toBeTruthy();
    resolvePage({ end: true, rows: [
      [{ type: "integer", value: "9223372036854775807" }, { type: "text", value: "猫" }],
      [{ type: "null" }, { type: "blob", value: "00ff" }],
    ] });
    const first = await screen.findByText("9223372036854775807");
    const last = await screen.findByText("BLOB · 2 B");
    expect(screen.getAllByText("duplicate")).toHaveLength(2);
    const cell = (element: HTMLElement) => element.closest<HTMLElement>(".ag-cell") ?? element;
    fireEvent.click(cell(first));
    fireEvent.mouseDown(cell(last), { shiftKey: true });
    fireEvent.click(cell(last), { shiftKey: true });
    await waitFor(() => expect(view.container.querySelectorAll(".anandb-cell-selected")).toHaveLength(4));
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith("9223372036854775807\t猫\nNULL\tX'00ff'"));
    fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }));
    await waitFor(() => expect(exportSelection).toHaveBeenCalledWith("csv", "9223372036854775807,猫\r\nNULL,X'00ff'"));
    expect(await screen.findByText("已保存 CSV 选区。")).toBeTruthy();
    document.documentElement.classList.add("dark");
    expect(view.container.querySelector(".ag-root-wrapper")).toBeTruthy();
    expect(screen.getByText("猫")).toBeTruthy();
  } finally {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

it("loads by block as the viewport advances and evicts distant blocks", async () => {
  const large: ResultInfo = { ...info, rowCount: 1000, columns: ["id"] };
  readResultPage.mockImplementation(async (_connection: string, _info: ResultInfo, offset: number, limit: number): Promise<ResultPage> => {
    const rows: BrowseRow[] = Array.from({ length: limit }, (_, index) => [{ type: "text", value: `data-${offset + index}` }]);
    return { end: false, rows };
  });
  const view = render(<div style={{ height: 320, width: 720 }}>
    <DataGrid connectionId="sqlite-1" info={large} pageSize={25} onCancel={vi.fn()} />
  </div>);
  await screen.findByText("data-0");
  const viewport = view.container.querySelector<HTMLElement>(".ag-grid-viewport")!;
  for (const offset of [50, 100, 150, 200, 250, 300]) {
    viewport.scrollTop = offset * 26;
    fireEvent.scroll(viewport);
    await waitFor(() => expect(readResultPage.mock.calls.some(call => call[2] === offset)).toBe(true));
  }
  await waitFor(() => {
    const label = screen.getByText(/已缓存 \d+ 行/).textContent ?? "";
    expect(Number(/已缓存 (\d+) 行/.exec(label)?.[1])).toBeLessThanOrEqual(100);
  });
  const firstReads = readResultPage.mock.calls.filter(call => call[2] === 0).length;
  viewport.scrollTop = 0;
  fireEvent.scroll(viewport);
  await waitFor(() => expect(readResultPage.mock.calls.filter(call => call[2] === 0)).toHaveLength(firstReads + 1));
});

it("stages with F2 or double click, validates types and ignores composition Enter and Escape", async () => {
  const editable: ResultInfo = {
    id: "2", columns: ["computed", "name"], maxPageSize: 100, rowCount: 2,
    editing: { schemaVersion: 1, identityColumns: [], rowIdAlias: "rowid", writable: [false, true], readOnlyReason: null },
  };
  readResultPage.mockResolvedValue({ end: true, rowIds: ["1", "2"], rows: [
    [{ type: "text", value: "generated" }, { type: "text", value: "original" }],
    [{ type: "text", value: "other" }, { type: "textPreview", value: "partial", bytes: 20000 }],
  ] });
  function Harness() {
    const edits = useTableEdits("editing-grid", "sqlite-1", "table");
    return <div style={{ height: 320, width: 720 }}>
      <DataGrid connectionId="sqlite-1" info={editable} pageSize={25} onCancel={() => {}} edits={edits} />
      <output>{edits.draft?.entries.size ?? 0} staged</output>
    </div>;
  }
  const cell = (element: HTMLElement) => element.closest<HTMLElement>(".ag-cell")!;
  render(<Harness />);
  const original = cell(await screen.findByText("original"));
  fireEvent.doubleClick(cell(screen.getByText("generated")), { detail: 2 });
  fireEvent.doubleClick(cell(screen.getByText(/partial/)), { detail: 2 });
  expect(screen.queryByLabelText("name 值")).toBeNull();
  fireEvent.mouseDown(original);
  fireEvent.doubleClick(original, { detail: 2 });
  let input = await screen.findByLabelText("name 值");
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "discarded" } });
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(screen.queryByLabelText("name 值")).toBeNull());
  expect(screen.getByText("0 staged")).toBeTruthy();
  expect(document.activeElement).toBe(original);
  fireEvent.keyDown(original, { key: "F2" });
  input = await screen.findByLabelText("name 值");
  fireEvent.change(screen.getByLabelText("name 类型"), { target: { value: "integer" } });
  fireEvent.change(input, { target: { value: "9223372036854775808" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByText(/int64 范围/)).toBeTruthy();
  fireEvent.change(input, { target: { value: "9223372036854775807" } });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });
  expect(screen.getByLabelText("name 值")).toBeTruthy();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByText("✎ 9223372036854775807")).toBeTruthy();
  expect(screen.getByText("1 staged")).toBeTruthy();
  fireEvent.click(original);
  fireEvent.click(screen.getByRole("button", { name: "删除选中行" }));
  expect(await screen.findByText("待删除 1")).toBeTruthy();
  fireEvent.doubleClick(original, { detail: 2 });
  expect(screen.queryByLabelText("name 值")).toBeNull();
});

it("restores the edit overlay after jumping pages and recreating the grid cache", async () => {
  const editable: ResultInfo = {
    id: "3", columns: ["name"], maxPageSize: 100, rowCount: 1000,
    editing: { schemaVersion: 1, identityColumns: [], rowIdAlias: "rowid", writable: [true], readOnlyReason: null },
  };
  readResultPage.mockImplementation(async (_connection: string, _info: ResultInfo, offset: number, limit: number): Promise<ResultPage> => ({
    end: false,
    rowIds: Array.from({ length: limit }, (_, index) => String(offset + index + 1)),
    rows: Array.from({ length: limit }, (_, index) => [{ type: "text", value: `row-${offset + index}` }]),
  }));
  function Harness() {
    const edits = useTableEdits("paged-editing-grid", "sqlite-1", "table");
    const [offset, setOffset] = useState(0);
    return <div style={{ height: 320, width: 720 }}>
      <button onClick={() => setOffset(current => current ? 0 : 300)}>跳页</button>
      <DataGrid key={offset} connectionId="sqlite-1" info={editable} pageSize={25} baseOffset={offset}
        onCancel={() => {}} edits={edits} />
    </div>;
  }
  render(<Harness />);
  const first = (await screen.findByText("row-0")).closest(".ag-cell")!;
  fireEvent.mouseDown(first);
  fireEvent.doubleClick(first, { detail: 2 });
  const input = await screen.findByLabelText("name 值");
  fireEvent.change(input, { target: { value: "draft" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByText("✎ draft")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "跳页" }));
  await screen.findByText("row-300");
  expect(screen.queryByText("✎ draft")).toBeNull();
  const firstReads = readResultPage.mock.calls.filter(call => call[2] === 0).length;
  fireEvent.click(screen.getByRole("button", { name: "跳页" }));
  await waitFor(() => expect(readResultPage.mock.calls.filter(call => call[2] === 0)).toHaveLength(firstReads + 1));
  expect(await screen.findByText("✎ draft")).toBeTruthy();
});
