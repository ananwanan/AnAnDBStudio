
import { useEffect, useState } from "react";

import { AppHeader } from "@/components/workbench/AppHeader";
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
  
  useWorkbenchShortcuts(dockApi);

  const [panelSnapshot, setPanelSnapshot] =
    useState<PanelSnapshot>(EMPTY_SNAPSHOT);

  useEffect(() => {
    if (!dockApi) return;

    const update = () => {
      setPanelSnapshot(readPanelSnapshot(dockApi));
    };

    update();

    const listeners = [
      dockApi.onDidAddPanel(update),
      dockApi.onDidRemovePanel(update),
      dockApi.onDidActivePanelChange(update),
      dockApi.onDidLayoutChange(update),
    ];

    return () => {
      listeners.forEach((listener) => listener.dispose());
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
        onResetLayout={handleResetLayout}
        canResetLayout={dockApi !== null}
        onOpenPanel={handleOpenPanel}
        onCloseActivePanel={handleCloseActivePanel}
        activePanel={panelSnapshot.active}
      />

      <DockWorkbench onApiReady={setDockApi} />

      <StatusBar />
    </div>
  );
}
