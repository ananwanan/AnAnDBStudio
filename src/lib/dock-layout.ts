import type { DockviewReadyEvent } from "dockview-react";

export type DockApi = DockviewReadyEvent["api"];
export type DockLayout = ReturnType<DockApi["toJSON"]>;

export const LAYOUT_STORAGE_KEY = "anandb.dockview.layout.v1";

interface StoredLayout {
    version: 1;
    layout: DockLayout;
}

export function loadSavedLayout(): DockLayout | null {
    try {
        const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
        if (!raw) return null;

        const value: unknown = JSON.parse(raw);

        if (
            typeof value !== "object" ||
            value === null ||
            !("version" in value) ||
            value.version !== 1 ||
            !("layout" in value) ||
            typeof value.layout !== "object" ||
            value.layout === null
        ) {
            removeSavedLayout();
            return null;
        }

        return value.layout as DockLayout;
    } catch {
        removeSavedLayout();
        return null;
    }
}

export function saveLayout(api: DockApi): void {
    try {
        const layout = api.toJSON();
        for (const panel of Object.values(layout.panels ?? {})) {
            if (panel.contentComponent === "data-result") {
                // Preserve the layout shape without saving session or database metadata.
                delete panel.params;
                delete panel.title;
            }
        }
        const data: StoredLayout = {
            version: 1,
            layout,
        };

        localStorage.setItem(
            LAYOUT_STORAGE_KEY,
            JSON.stringify(data),
        );
    } catch {
        // Layout persistence is best-effort.
    }
}

export function removeSavedLayout(): void {
    try {
        localStorage.removeItem(LAYOUT_STORAGE_KEY);
    } catch {
        // Storage may be unavailable.
    }
}

export function createDefaultLayout(api: DockApi): void {
    api.addPanel({
        id: "explorer",
        component: "explorer",
        title: "Explorer",
    });

    api.addPanel({
        id: "welcome",
        component: "welcome",
        title: "Welcome",
        position: {
            referencePanel: "explorer",
            direction: "right",
        },
    });

    api.addPanel({
        id: "results",
        component: "results",
        title: "Results",
        initialHeight: 142,
        position: {
            referencePanel: "welcome",
            direction: "below",
        },
    });
}

export function restoreLayout(api: DockApi): void {
    const saved = loadSavedLayout();

    if (saved !== null) {
        try {
            api.fromJSON(saved);

            if (api.panels.length > 0) {
                return;
            }
        } catch {
            // Fall back to the default layout.
        }

        removeSavedLayout();
        api.clear();
    }

    createDefaultLayout(api);
}

export function resetLayout(api: DockApi): void {
    removeSavedLayout();
    api.clear();
    createDefaultLayout(api);
    saveLayout(api);
}

export function subscribeLayoutPersistence(
    api: DockApi,
): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const flush = () => {
        if (timer === undefined) return;

        clearTimeout(timer);
        timer = undefined;
        saveLayout(api);
    };

    const subscription = api.onDidLayoutChange(() => {
        if (timer !== undefined) {
            clearTimeout(timer);
        }

        timer = setTimeout(flush, 350);
    });

    // Flush pending layout changes before the WebView unloads.
    window.addEventListener("pagehide", flush);

    return () => {
        subscription.dispose();
        window.removeEventListener("pagehide", flush);
        flush();
    };
}
