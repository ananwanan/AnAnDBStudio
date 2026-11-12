/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DataTabSource } from "@/lib/data-tabs";
import type { ResultInfo } from "@/services/browse-protocol";
import { DataResultPanel } from "./DataResultPanel";
import { EditLeavePrompt } from "./EditModal";
import { deleteRows, type ChangeSet } from "./change-set";
import type { TableEdits } from "./use-table-edits";
import { protectEdits } from "@/lib/edit-lifecycle";
import { IpcError } from "@/services/ipc";

const services = vi.hoisted(() => ({
  openTable: vi.fn(),
  releaseResult: vi.fn(async (_id: string, _session: string) => {}),
  commitSqliteEdit: vi.fn(),
  connections: [{ id: "sqlite-1" }, { id: "sqlite-2" }],
}));
vi.mock("@/services/sqlite-results", () => services);
vi.mock("@/services/sqlite-edits", async importOriginal => ({
  ...await importOriginal<typeof import("@/services/sqlite-edits")>(),
  commitSqliteEdit: services.commitSqliteEdit,
}));
vi.mock("@/stores/sqlite-workspace", () => ({ useSqliteWorkspace: () => ({ connections: services.connections }) }));
vi.mock("./DataGrid", () => ({
  DataGrid: ({ connectionId, info, pageSize, controls, edits }: { connectionId: string; info: ResultInfo; pageSize: number; controls: React.ReactNode; edits?: TableEdits }) =>
    <>{controls}<div role="grid">{connectionId} {info.id} {pageSize}</div>
      {info.editing && <button onClick={() => edits?.change(info, (set: ChangeSet) => deleteRows(set, [{
        key: "id-2", original: { rowId: null, cells: [{ type: "integer", value: "2" }, { type: "text", value: "original" }] },
      }]))}>标记测试行</button>}
    </>,
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
  services.commitSqliteEdit.mockReset();
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

const editableInfo = (id: string): ResultInfo => ({
  ...info(id),
  editing: { schemaVersion: 7, identityColumns: [0], rowIdAlias: null, writable: [true, true], readOnlyReason: null },
});

it("preserves staged changes through page sizes, sort, filter and refresh, then reloads after confirmed commit", async () => {
  let sequence = 10;
  services.openTable.mockImplementation(async () => editableInfo(String(sequence++)));
  services.commitSqliteEdit.mockRejectedValueOnce(new IpcError("EDIT_ROW_CHANGED", "Change 2: original row changed"))
    .mockResolvedValueOnce({ inserted: 1, updated: 0, deleted: 1 });
  render(panel(main));
  await screen.findByRole("grid");
  fireEvent.click(screen.getByRole("button", { name: "新增行" }));
  fireEvent.change(screen.getByLabelText("name 类型"), { target: { value: "text" } });
  fireEvent.click(screen.getByRole("button", { name: "暂存新增行" }));
  expect(screen.getByRole("button", { name: /新增行 1/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "标记测试行" }));
  expect(screen.getByText(/待提交 2/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("每页行数"), { target: { value: "25" } });
  fireEvent.change(screen.getByLabelText("排序列"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("筛选列"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("筛选值"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  await screen.findByText("sqlite-1 11 100");
  fireEvent.click(screen.getByRole("button", { name: "刷新" }));
  await screen.findByText("sqlite-1 12 100");
  expect(screen.getByText(/待提交 2/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  expect(screen.getByText(/从 main.orders 删除 1 行/)).toBeTruthy();
  expect(services.commitSqliteEdit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认提交" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/目标行已变更/);
  expect(screen.getByText(/待提交 2/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  fireEvent.click(screen.getByRole("button", { name: "确认提交" }));
  await screen.findByText("sqlite-1 15 100");
  expect(services.openTable.mock.calls[5][3]).toBe(true);
  expect(screen.getByText(/已提交 · 新增 1 · 修改 0 · 删除 1/)).toBeTruthy();
  expect(screen.getByText(/待提交 0/)).toBeTruthy();
  expect(services.commitSqliteEdit.mock.calls[1][3]).toMatchObject({ schemaVersion: 7, changes: [
    { kind: "insert", values: [{ column: 1, value: { type: "text", value: "" } }] },
    { kind: "delete", target: { cells: [{ type: "integer", value: "2" }, { type: "text", value: "original" }] } },
  ] });
});

it("guards close and leaves read-only tabs browsable", async () => {
  const ro = editableInfo("12");
  ro.editing!.readOnlyReason = "connection";
  services.openTable.mockResolvedValueOnce(editableInfo("11")).mockResolvedValueOnce(ro);
  render(<>{panel(main)}{panel(other)}<EditLeavePrompt /></>);
  const [orders, users] = screen.getAllByRole("region", { name: "数据浏览" }).map(region => within(region));
  await orders.findByRole("grid");
  await users.findByText(/只读：当前连接/);
  expect((users.getByRole("button", { name: "新增行" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(orders.getByRole("button", { name: "标记测试行" }));
  let closing!: Promise<boolean>;
  act(() => { closing = protectEdits("关闭前处理修改", guard => guard.connectionId === "sqlite-1"); });
  let dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/main.orders.*删除 1/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(await closing).toBe(false);
  expect(orders.getByText(/待提交 1/)).toBeTruthy();
  act(() => { closing = protectEdits("关闭前处理修改"); });
  dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "放弃草稿" }));
  expect(await closing).toBe(true);
  expect(await orders.findByText(/待提交 0/)).toBeTruthy();
  expect(services.commitSqliteEdit).not.toHaveBeenCalled();
});
