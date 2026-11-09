import type { DockApi } from "./dock-layout";
import {
  SQL_PANEL_PREFIX,
  getSqlDraft,
  getSqlDrafts,
  type SqlDraft,
} from "@/stores/sql-drafts";

export function isSqlPanelId(id: string): boolean {
  return id.startsWith(SQL_PANEL_PREFIX);
}

/** All query documents live in the store; Dockview owns only their placement. */
export function openSqlTab(api: DockApi, draft: SqlDraft): void {
  const existing = api.getPanel(draft.id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  const reference = api.panels.find((panel) => isSqlPanelId(panel.id)) ??
    api.getPanel("welcome") ??
    api.getPanel("results") ??
    api.getPanel("explorer") ??
    api.panels[0];
  api.addPanel({
    id: draft.id,
    component: "sql-editor",
    title: draft.title,
    renderer: "always",
    ...(reference ? {
      position: {
        referencePanel: reference.id,
        direction: reference.id === "explorer" ? "right" : "within",
      },
    } : {}),
  });
}

export function latestClosedSqlDraft(api: DockApi): SqlDraft | undefined {
  return [...getSqlDrafts()].reverse().find((draft) => !api.getPanel(draft.id));
}

/** Saved layouts can outlive localStorage entries. Discard orphaned panels. */
export function reconcileSqlTabs(api: DockApi): void {
  for (const panel of [...api.panels]) {
    if (isSqlPanelId(panel.id) && !getSqlDraft(panel.id)) {
      api.removePanel(panel);
    }
  }
}
