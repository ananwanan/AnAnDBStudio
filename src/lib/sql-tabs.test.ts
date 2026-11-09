/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { DockApi } from "./dock-layout";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("SQL Dockview tabs", () => {
  it("opens separate tabs next to Welcome and reactivates existing documents", async () => {
    const { createSqlDraft } = await import("@/stores/sql-drafts");
    const { openSqlTab, latestClosedSqlDraft, reconcileSqlTabs } = await import("./sql-tabs");
    const panels: Array<{ id: string; api: { setActive: ReturnType<typeof vi.fn> } }> = [
      { id: "welcome", api: { setActive: vi.fn() } },
    ];
    const addPanel = vi.fn((config: { id: string; position?: { referencePanel: string; direction: string } }) => {
      panels.push({ id: config.id, api: { setActive: vi.fn() } });
    });
    const removePanel = vi.fn((panel: { id: string }) => {
      panels.splice(panels.findIndex((item) => item.id === panel.id), 1);
    });
    const api = {
      panels,
      addPanel,
      removePanel,
      getPanel: (id: string) => panels.find((panel) => panel.id === id),
    } as unknown as DockApi;

    const a = createSqlDraft("c1");
    const b = createSqlDraft(null);
    openSqlTab(api, a);
    openSqlTab(api, b);
    expect(addPanel).toHaveBeenCalledTimes(2);
    expect(addPanel.mock.calls[0][0]).toMatchObject({
      component: "sql-editor",
      renderer: "always",
      position: { referencePanel: "welcome", direction: "within" },
    });
    expect(addPanel.mock.calls[1][0].position?.referencePanel).toBe(a.id);
    openSqlTab(api, a);
    expect(addPanel).toHaveBeenCalledTimes(2);
    expect(panels.find((panel) => panel.id === a.id)!.api.setActive).toHaveBeenCalled();
    expect(latestClosedSqlDraft(api)).toBeUndefined();

    removePanel(panels.find((panel) => panel.id === a.id)!);
    expect(latestClosedSqlDraft(api)?.id).toBe(a.id);
    reconcileSqlTabs(api);
    expect(removePanel).toHaveBeenCalledTimes(1);
  });

  it("removes orphaned restored SQL panels, not other panels", async () => {
    const { reconcileSqlTabs } = await import("./sql-tabs");
    const panels = [{ id: "sql-editor:missing" }, { id: "explorer" }];
    const removePanel = vi.fn((panel: { id: string }) => {
      panels.splice(panels.indexOf(panel), 1);
    });
    reconcileSqlTabs({ panels, removePanel } as unknown as DockApi);
    expect(removePanel).toHaveBeenCalledTimes(1);
    expect(panels).toEqual([{ id: "explorer" }]);
  });
});
