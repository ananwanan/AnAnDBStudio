import type { DockApi } from "./dock-layout";
import { isSqlPanelId } from "./sql-tabs";

export const PANEL_IDS = ["explorer", "welcome", "results"] as const;
export type WorkbenchPanelId = (typeof PANEL_IDS)[number];
export type ActivePanelKind = WorkbenchPanelId | "query" | null;

export interface PanelSnapshot {
  opened: Record<WorkbenchPanelId, boolean>;
  active: ActivePanelKind;
}

const PANEL_CONFIG = {
  explorer: { title: "Explorer", direction: "left" },
  welcome: { title: "Welcome", direction: "within" },
  results: { title: "Results", direction: "below" },
} as const;

export function panelKind(id: string | undefined): ActivePanelKind {
  if (!id) return null;
  if (isSqlPanelId(id)) return "query";
  return PANEL_IDS.find((item) => item === id) ?? null;
}

export function openWorkbenchPanel(api: DockApi, id: WorkbenchPanelId): void {
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  const config = PANEL_CONFIG[id];
  const reference = api.activePanel ?? api.panels[0];
  api.addPanel({
    id,
    component: id,
    title: config.title,
    ...(reference ? {
      position: { referencePanel: reference.id, direction: config.direction },
    } : {}),
  });
}

export function closeWorkbenchPanel(api: DockApi, id: WorkbenchPanelId): void {
  const panel = api.getPanel(id);
  if (panel) api.removePanel(panel);
}

export function closeActiveWorkbenchPanel(api: DockApi): void {
  if (api.activePanel) api.removePanel(api.activePanel);
}

export function readPanelSnapshot(api: DockApi): PanelSnapshot {
  return {
    opened: {
      explorer: api.getPanel("explorer") !== undefined,
      welcome: api.getPanel("welcome") !== undefined,
      results: api.getPanel("results") !== undefined,
    },
    active: panelKind(api.activePanel?.id),
  };
}
