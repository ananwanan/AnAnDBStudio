
import type { DockApi } from "./dock-layout";

export const PANEL_IDS = [
    "explorer",
    "welcome",
    "results",
] as const;

export type WorkbenchPanelId =
    (typeof PANEL_IDS)[number];

export interface PanelSnapshot {
    opened: Record<WorkbenchPanelId, boolean>;
    active: WorkbenchPanelId | null;
}

const PANEL_CONFIG = {
    explorer: {
        title: "Explorer",
        direction: "left",
    },
    welcome: {
        title: "Welcome",
        direction: "within",
    },
    results: {
        title: "Results",
        direction: "below",
    },
} as const;

export function openWorkbenchPanel(
    api: DockApi,
    id: WorkbenchPanelId,
): void {
    const existing = api.getPanel(id);

    // Reuse existing panels instead of creating duplicates.
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
        ...(reference
            ? {
                position: {
                    referencePanel: reference.id,
                    direction: config.direction,
                },
            }
            : {}),
    });
}

export function closeWorkbenchPanel(
    api: DockApi,
    id: WorkbenchPanelId,
): void {
    const panel = api.getPanel(id);
    if (panel) {
        api.removePanel(panel);
    }
}

export function closeActiveWorkbenchPanel(
    api: DockApi,
): void {
    const panel = api.activePanel;
    if (panel) {
        api.removePanel(panel);
    }
}

export function readPanelSnapshot(
    api: DockApi,
): PanelSnapshot {
    const activeId = api.activePanel?.id;

    return {
        opened: {
            explorer: api.getPanel("explorer") !== undefined,
            welcome: api.getPanel("welcome") !== undefined,
            results: api.getPanel("results") !== undefined,
        },
        active: PANEL_IDS.find((id) => id === activeId) ?? null,
    };
}
