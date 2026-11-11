/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { IDockviewPanelProps } from "dockview-react";
import { createSqlDraft, updateSqlDraftSql } from "@/stores/sql-drafts";
import { SqlEditorPanel } from "./SqlEditorPanel";
const execute = vi.hoisted(() => vi.fn());
vi.mock("@/stores/sql-execution", () => ({ executeSql: execute, cancelExecution: vi.fn(), selectExecution: vi.fn(), useSqlExecution: () => ({ executions: {}, history: [] }) }));
vi.mock("@/stores/sqlite-workspace", () => ({ useSqliteWorkspace: () => ({ connections: [{ id: "sqlite-1", path: "one.db", readOnly: true }, { id: "sqlite-2", path: "two.db", readOnly: false }] }) }));
vi.mock("./MonacoSqlEditor", () => ({ MonacoSqlEditor: ({ onSelection, onRun }: { onSelection: (s: string, o: number) => void; onRun: (s: string, o: number) => void }) => <>
  <button onClick={() => onSelection("SELECT 2", 10)}>select SQL</button>
  <button onClick={() => onRun("SELECT 2", 10)}>shortcut</button>
</> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); execute.mockReset(); });
function mount(connection: string | null) {
  const draft = createSqlDraft(connection); updateSqlDraftSql(draft.id, "SELECT 1; SELECT 2");
  const api = { id: draft.id, setTitle: vi.fn(), close: vi.fn() };
  render(<SqlEditorPanel {...({ api } as unknown as IDockviewPanelProps)} />);
  return draft;
}
it("executes selected SQL with its source offset using button and keyboard callback", async () => {
  const draft = mount("sqlite-1");
  await waitFor(() => expect(screen.getByText("select SQL")).toBeDefined());
  fireEvent.click(screen.getByText("select SQL"));
  fireEvent.click(screen.getByRole("button", { name: "执行选中" }));
  expect(execute).toHaveBeenCalledWith(draft.id, "sqlite-1", "SELECT 2", 30000, "SELECT 1; SELECT 2", 10, false);
  fireEvent.click(screen.getByRole("checkbox", { name: "保留完整结果" }));
  fireEvent.click(screen.getByText("shortcut"));
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenLastCalledWith(draft.id, "sqlite-1", "SELECT 2", 30000, "SELECT 1; SELECT 2", 10, true);
});
it("requires explicit confirmation on read-write connections", () => {
  mount("sqlite-2");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "执行全部" }));
  expect(execute).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "执行全部" }));
  expect(execute).toHaveBeenCalledTimes(1);
});
it("cannot execute against an unbound or stale connection", () => {
  mount("sqlite-999");
  expect(screen.getByRole("button", { name: "执行全部" }).hasAttribute("disabled")).toBe(true);
});
