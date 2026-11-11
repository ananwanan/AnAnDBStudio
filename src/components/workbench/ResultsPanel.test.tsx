/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { IDockviewPanelProps } from "dockview-react";
import { ResultsPanel } from "./ResultsPanel";
const mocks = vi.hoisted(() => ({ open: vi.fn(), clear: vi.fn() }));
vi.mock("@/lib/sql-tabs", () => ({ openSqlTab: mocks.open }));
vi.mock("@/stores/sql-execution", () => ({ clearQueryHistory: mocks.clear, selectExecution: vi.fn(), useSqlExecution: () => ({ selectedId: "a", executions: { a: { draftId: "a", connectionId: "sqlite-1", result: {
  status: "completed", elapsedMs: 1, statements: [{ index: 0, columns: ["x", "x"], rows: [[{ type: "text", value: "<img src=x onerror=alert(1)>" }, { type: "integer", value: "9223372036854775807" }]], affectedRows: "0", truncated: true }], error: null, transactionOpen: true, rolledBack: false,
} } }, history: [{ sql: "SELECT 1", connectionId: "sqlite-1", status: "completed", time: "2026-11-11T00:00:00Z" }] }) }));
afterEach(cleanup);
it("renders data as text, preserves duplicate columns, and restores history without executing", () => {
  const { container } = render(<ResultsPanel {...({ containerApi: {} } as IDockviewPanelProps)} />);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("9223372036854775807")).toBeDefined();
  expect(screen.getAllByRole("columnheader", { name: "x" })).toHaveLength(2);
  expect(screen.getByText(/此连接有未提交事务/)).toBeDefined();
  expect(screen.getByText(/结果已达到预览上限/)).toBeDefined();
  fireEvent.click(screen.getByText("恢复草稿"));
  expect(mocks.open).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/尚未执行/)).toBeDefined();
  fireEvent.click(screen.getByText("清空历史"));
  expect(mocks.clear).toHaveBeenCalledTimes(1);
});
