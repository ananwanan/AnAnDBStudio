import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { AppHeader } from "@/components/workbench/AppHeader";
import { NewConnectionDialog } from "@/components/workbench/NewConnectionDialog";
import { DockWorkbench } from "@/components/workbench/DockWorkbench";
import { StatusBar } from "@/components/workbench/StatusBar";
import { useWorkbenchShortcuts } from "@/hooks/useWorkbenchShortcuts";
import { resetLayout, type DockApi } from "@/lib/dock-layout";
import { latestClosedSqlDraft, openSqlTab } from "@/lib/sql-tabs";
import {
  closeActiveWorkbenchPanel,
  openWorkbenchPanel,
  panelKind,
  readPanelSnapshot,
  type PanelSnapshot,
  type WorkbenchPanelId,
} from "@/lib/workbench-panels";
import { createSqlDraft, useSqlDrafts } from "@/stores/sql-drafts";
import { initializeSqliteWorkspace, useSqliteWorkspace } from "@/stores/sqlite-workspace";
import { hasPendingEdits, protectEdits } from "@/lib/edit-lifecycle";
import { EditLeavePrompt } from "@/components/data-browser/EditModal";

const EMPTY_SNAPSHOT: PanelSnapshot = {
  opened: { explorer: false, welcome: false, results: false },
  active: null,
};

export default function App() {
  const [dockApi, setDockApi] = useState<DockApi | null>(null);
  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [panelSnapshot, setPanelSnapshot] = useState<PanelSnapshot>(EMPTY_SNAPSHOT);
  const { selectedId } = useSqliteWorkspace();
  const { drafts } = useSqlDrafts();
  const openConnectionDialog = useCallback(() => setShowConnectionDialog(true), []);
  const closeConnectionDialog = useCallback(() => setShowConnectionDialog(false), []);

  useEffect(() => {
    if (isTauri()) void initializeSqliteWorkspace();
  }, []);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!hasPendingEdits()) return;
      event.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener("beforeunload", beforeUnload);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      const appWindow = getCurrentWindow();
      void appWindow.onCloseRequested(async event => {
        if (!hasPendingEdits()) return;
        event.preventDefault();
        if (await protectEdits("退出前处理修改")) {
          try { await appWindow.destroy(); }
          catch { setQueryError("关闭窗口失败，请重试。"); }
        }
      }).then(stop => {
        if (disposed) stop();
        else unlisten = stop;
      }).catch(() => { if (!disposed) setQueryError("无法启用窗口退出保护。"); });
    }
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  const handleNewQuery = useCallback(() => {
    if (!dockApi) return;
    try {
      const draft = createSqlDraft(selectedId);
      openSqlTab(dockApi, draft);
      setQueryError(null);
      setPanelSnapshot(readPanelSnapshot(dockApi));
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : "无法创建查询标签。");
    }
  }, [dockApi, selectedId]);

  useWorkbenchShortcuts(dockApi, handleNewQuery);

  useEffect(() => {
    if (!dockApi) return;

    const refresh = () => setPanelSnapshot(readPanelSnapshot(dockApi));
    const activeSubscription = dockApi.onDidActivePanelChange(({ panel }) => {
      // Dockview may update api.activePanel after emitting this event.
      setPanelSnapshot({
        ...readPanelSnapshot(dockApi),
        active: panelKind(panel?.id),
      });
    });
    const subscriptions = [
      dockApi.onDidAddPanel(refresh),
      dockApi.onDidRemovePanel(refresh),
      dockApi.onDidLayoutFromJSON(refresh),
      activeSubscription,
    ];
    refresh();
    return () => subscriptions.forEach((subscription) => subscription.dispose());
  }, [dockApi]);

  function handleOpenPanel(id: WorkbenchPanelId) {
    if (!dockApi) return;
    openWorkbenchPanel(dockApi, id);
    setPanelSnapshot(readPanelSnapshot(dockApi));
  }

  function handleRestoreQuery() {
    if (!dockApi) return;
    const draft = latestClosedSqlDraft(dockApi);
    if (!draft) return;
    openSqlTab(dockApi, draft);
    setPanelSnapshot(readPanelSnapshot(dockApi));
  }

  function handleCloseActivePanel() {
    if (!dockApi) return;
    // Closing a Dockview SQL panel retains its local draft for recovery.
    closeActiveWorkbenchPanel(dockApi);
    setPanelSnapshot(readPanelSnapshot(dockApi));
  }

  async function handleResetLayout() {
    if (!dockApi) return;
    if (!(await protectEdits("重置布局前处理修改"))) return;
    resetLayout(dockApi);
    setPanelSnapshot(readPanelSnapshot(dockApi));
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <AppHeader
        onNewConnection={openConnectionDialog}
        onNewQuery={handleNewQuery}
        onRestoreQuery={handleRestoreQuery}
        canRestoreQuery={dockApi !== null && drafts.some((draft) => !dockApi.getPanel(draft.id))}
        onResetLayout={handleResetLayout}
        canResetLayout={dockApi !== null}
        onOpenPanel={handleOpenPanel}
        onCloseActivePanel={handleCloseActivePanel}
        activePanel={panelSnapshot.active}
      />
      {queryError && (
        <div role="alert" className="flex items-center gap-2 border-b border-destructive/40 px-3 py-1 text-xs text-destructive">
          {queryError}
          <button type="button" onClick={() => setQueryError(null)} className="underline">关闭</button>
        </div>
      )}
      <DockWorkbench onApiReady={setDockApi} onNewConnection={openConnectionDialog} />
      <EditLeavePrompt />
      <StatusBar />
      {showConnectionDialog && <NewConnectionDialog onClose={closeConnectionDialog} />}
    </div>
  );
}
