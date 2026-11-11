/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowseRow, ResultInfo, ResultPage } from "@/services/browse-protocol";
import { DataGrid } from "./DataGrid";

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
