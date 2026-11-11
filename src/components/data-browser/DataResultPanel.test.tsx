/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DataTabSource } from "@/lib/data-tabs";
import type { ResultInfo } from "@/services/browse-protocol";
import { DataResultPanel } from "./DataResultPanel";

const services = vi.hoisted(() => ({
  openTable: vi.fn(),
  releaseResult: vi.fn(async (_id: string, _session: string) => {}),
  connections: [{ id: "sqlite-1" }, { id: "sqlite-2" }],
}));
vi.mock("@/services/sqlite-results", () => services);
vi.mock("@/stores/sqlite-workspace", () => ({ useSqliteWorkspace: () => ({ connections: services.connections }) }));
vi.mock("./DataGrid", () => ({
  DataGrid: ({ connectionId, info, pageSize, controls }: { connectionId: string; info: ResultInfo; pageSize: number; controls: React.ReactNode }) =>
    <>{controls}<div role="grid">{connectionId} {info.id} {pageSize}</div></>,
}));

const main: DataTabSource = { kind: "table", connectionId: "sqlite-1", schema: "main", table: "orders" };
const other: DataTabSource = { kind: "table", connectionId: "sqlite-2", schema: "main", table: "users" };
const info = (id: string): ResultInfo => ({ id, columns: ["id", "name"], maxPageSize: 100, rowCount: null });

function panel(source: DataTabSource) {
  return <DataResultPanel {...({ params: { source } } as IDockviewPanelProps<{ source: DataTabSource }>)} />;
}

beforeEach(() => {
  services.openTable.mockReset();
  services.releaseResult.mockClear();
  services.connections.splice(0, services.connections.length, { id: "sqlite-1" }, { id: "sqlite-2" });
});
afterEach(cleanup);

it("opens, sorts, filters, refreshes and releases only the affected tab", async () => {
  services.openTable.mockResolvedValueOnce(info("1")).mockResolvedValueOnce(info("2"))
    .mockResolvedValueOnce(info("3")).mockResolvedValueOnce(info("4"));
  render(<>{panel(main)}{panel(other)}</>);
  const [orders, users] = screen.getAllByRole("region", { name: "数据浏览" }).map(region => within(region));
  expect(orders.getByText("正在打开表数据…")).toBeTruthy();
  expect((await orders.findByRole("grid")).textContent).toBe("sqlite-1 1 100");
  expect((await users.findByRole("grid")).textContent).toBe("sqlite-2 2 100");
  fireEvent.change(orders.getByLabelText("排序列"), { target: { value: "0" } });
  fireEvent.change(orders.getByLabelText("排序方向"), { target: { value: "desc" } });
  fireEvent.change(orders.getByLabelText("筛选列"), { target: { value: "1" } });
  fireEvent.change(orders.getByLabelText("筛选运算符"), { target: { value: "contains" } });
  fireEvent.change(orders.getByLabelText("筛选值"), { target: { value: "猫%" } });
  fireEvent.click(orders.getByRole("button", { name: "应用" }));
  expect((await orders.findByRole("grid")).textContent).toBe("sqlite-1 3 100");
  expect(services.openTable.mock.calls[2][1]).toEqual({
    schema: "main", table: "orders", sort: { column: "id", descending: true },
    filter: { column: "name", operator: "contains", value: { type: "text", value: "猫%" } },
  });
  fireEvent.change(users.getByLabelText("每页行数"), { target: { value: "25" } });
  fireEvent.click(orders.getByRole("button", { name: "刷新" }));
  expect((await orders.findByRole("grid")).textContent).toBe("sqlite-1 4 100");
  expect((users.getByRole("grid")).textContent).toBe("sqlite-2 2 25");
  expect(services.releaseResult.mock.calls).toEqual([["sqlite-1", "1"], ["sqlite-1", "3"]]);
});

it("discards a stale open response and invalidates the grid on disconnect", async () => {
  let resolveOld!: (value: ResultInfo) => void;
  services.openTable.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(info("2"));
  const view = render(panel(main));
  fireEvent.click(screen.getByRole("button", { name: "刷新" }));
  expect((await screen.findByRole("grid")).textContent).toBe("sqlite-1 2 100");
  resolveOld(info("1"));
  await waitFor(() => expect(services.releaseResult).toHaveBeenCalledWith("sqlite-1", "1"));
  expect((screen.getByRole("grid")).textContent).toBe("sqlite-1 2 100");
  services.connections.shift();
  view.rerender(panel(main));
  expect(screen.getByText("结果已失效。数据库连接已关闭。")).toBeTruthy();
  expect(screen.queryByRole("grid")).toBeNull();
  expect(services.releaseResult).toHaveBeenCalledWith("sqlite-1", "2");
});
