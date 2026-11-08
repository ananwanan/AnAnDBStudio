
import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";

import { AppHeader } from "@/components/workbench/AppHeader";
import { NewConnectionDialog } from "@/components/workbench/NewConnectionDialog";
import { initializeSqliteWorkspace } from "@/stores/sqlite-workspace";
import { DockWorkbench } from "@/components/workbench/DockWorkbench";
import { StatusBar } from "@/components/workbench/StatusBar";
import { useWorkbenchShortcuts } from "@/hooks/useWorkbenchShortcuts";

import {
  resetLayout,
  type DockApi,
} from "@/lib/dock-layout";

import {
  openWorkbenchPanel,
  closeActiveWorkbenchPanel,
  readPanelSnapshot,
  type PanelSnapshot,
  type WorkbenchPanelId,
} from "@/lib/workbench-panels";

const EMPTY_SNAPSHOT: PanelSnapshot = {
  opened: {
    explorer: false,
    welcome: false,
    results: false,
  },
  active: null,
};

export default function App() {
  const [dockApi, setDockApi] = useState<DockApi | null>(null);
  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const openConnectionDialog = useCallback(() => setShowConnectionDialog(true), []);
  const closeConnectionDialog = useCallback(() => setShowConnectionDialog(false), []);

  useEffect(() => {
    if (isTauri()) void initializeSqliteWorkspace();
  }, []);

  useWorkbenchShortcuts(dockApi);

  const [panelSnapshot, setPanelSnapshot] =
  useState<PanelSnapshot>(EMPTY_SNAPSHOT);

  useEffect(() => {
    if (!dockApi) return;

    // Synchronize panel presence after structural changes.
    const refresh = () => {
      setPanelSnapshot(readPanelSnapshot(dockApi));
    };

    // Use the active panel supplied by the Dockview event.
    const activeSubscription = dockApi.onDidActivePanelChange(
      ({ panel, origin }) => {
        const id = panel?.id;

        const active: WorkbenchPanelId | null =
          id === "explorer" ||
            id === "welcome" ||
            id === "results"
            ? id
            : null;

        setPanelSnapshot({
          ...readPanelSnapshot(dockApi),
          active,
        });

        console.debug("[Dockview] Active panel changed", {
          active,
          origin,
          apiActive: dockApi.activePanel?.id,
        });
      },
    );

    const subscriptions = [
      dockApi.onDidAddPanel(refresh),
      dockApi.onDidRemovePanel(refresh),
      dockApi.onDidLayoutFromJSON(refresh),
      activeSubscription,
    ];

    refresh();

    return () => {
      subscriptions.forEach((subscription) => {
        subscription.dispose();
      });
    };
  }, [dockApi]);

  function handleOpenPanel(id: WorkbenchPanelId) {
    if (!dockApi) return;

    openWorkbenchPanel(dockApi, id);
    setPanelSnapshot(readPanelSnapshot(dockApi));
  }

  function handleCloseActivePanel() {
    if (!dockApi) return;

    closeActiveWorkbenchPanel(dockApi);
    setPanelSnapshot(readPanelSnapshot(dockApi));
  }

  function handleResetLayout() {
    if (!dockApi) return;

    resetLayout(dockApi);
    setPanelSnapshot(readPanelSnapshot(dockApi));
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <AppHeader
        onNewConnection={openConnectionDialog}
        onResetLayout={handleResetLayout}
        canResetLayout={dockApi !== null}
        onOpenPanel={handleOpenPanel}
        onCloseActivePanel={handleCloseActivePanel}
        activePanel={panelSnapshot.active}
      />

      <DockWorkbench onApiReady={setDockApi} onNewConnection={openConnectionDialog} />

      <StatusBar />
      {showConnectionDialog && <NewConnectionDialog onClose={closeConnectionDialog} />}
    </div>
  );
}
