/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IDockviewPanelProps } from "dockview-react";
import { createSqlDraft, getSqlDraft } from "@/stores/sql-drafts";
import { SqlEditorPanel } from "./SqlEditorPanel";

vi.mock("./MonacoSqlEditor", () => ({
  MonacoSqlEditor: ({ value }: { value: string }) => <textarea readOnly value={value} />,
}));
vi.mock("@/stores/sqlite-workspace", () => ({
  useSqliteWorkspace: () => ({
    connections: [
      { id: "db1", path: "data/one.db", readOnly: true },
      { id: "db2", path: "data/two.db", readOnly: false },
    ],
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SQL editor workbench", () => {
  it("renames, rebinds and deletes an individual query safely", () => {
    const draft = createSqlDraft("db1");
    const api = { id: draft.id, setTitle: vi.fn(), close: vi.fn() };
    render(<SqlEditorPanel {...({ api } as unknown as IDockviewPanelProps)} />);

    const title = screen.getByRole("textbox", { name: "查询标签名称" });
    fireEvent.change(title, { target: { value: "Orders" } });
    fireEvent.blur(title);
    expect(getSqlDraft(draft.id)?.title).toBe("Orders");
    expect(api.setTitle).toHaveBeenCalledWith("Orders");

    fireEvent.change(screen.getByRole("combobox", { name: "查询目标连接" }), {
      target: { value: "db2" },
    });
    expect(getSqlDraft(draft.id)?.connectionId).toBe("db2");

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "删除当前查询草稿" }));
    expect(getSqlDraft(draft.id)).toBeDefined();
    expect(api.close).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "删除当前查询草稿" }));
    expect(getSqlDraft(draft.id)).toBeUndefined();
    expect(api.close).toHaveBeenCalledTimes(1);
  });
});
