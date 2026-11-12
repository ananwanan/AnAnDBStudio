import type { ResultInfo } from "@/services/browse-protocol";
import { releaseResult } from "@/services/sqlite-results";
import type { DockApi } from "./dock-layout";
import { isSqlPanelId } from "./sql-tabs";
import { hasPendingEdits, protectEdits } from "./edit-lifecycle";

const PREFIX = "data-result-";
const MAX_DATA_TABS = 12;

export type DataTabSource =
  | { kind: "table"; connectionId: string; schema: "main"; table: string }
  | { kind: "query"; connectionId: string; info: ResultInfo };

export function isDataTab(id: string) {
  return id.startsWith(PREFIX);
}

export function closeDataTab(api: DockApi, id: string) {
  const close = () => {
    const panel = api.getPanel(id);
    if (panel) api.removePanel(panel);
  };
  const include = (guard: { id: string }) => guard.id === id;
  if (!hasPendingEdits(include)) close();
  else void protectEdits("关闭数据标签前处理修改", include).then(allow => { if (allow) close(); });
}

export function openDataTab(api: DockApi, source: DataTabSource, title: string) {
  const existing = api.panels.find(panel => {
    const previous = panel.params?.source as DataTabSource | undefined;
    return isDataTab(panel.id) && previous?.connectionId === source.connectionId &&
      (source.kind === "table" && previous.kind === "table"
        ? previous.schema === source.schema && previous.table === source.table
        : source.kind === "query" && previous.kind === "query" && previous.info.id === source.info.id);
  });
  if (existing) {
    existing.api.setActive();
    return;
  }
  if (api.panels.filter(panel => isDataTab(panel.id)).length >= MAX_DATA_TABS) {
    throw new Error("已打开 12 个数据标签。请关闭一个标签后再试。");
  }
  const id = PREFIX + crypto.randomUUID();
  const active = api.activePanel;
  const reference = active && (isSqlPanelId(active.id) || isDataTab(active.id))
    ? active : api.panels.find(panel => isSqlPanelId(panel.id) || isDataTab(panel.id)) ??
      api.getPanel("welcome") ?? api.getPanel("results") ?? api.getPanel("explorer");
  api.addPanel({
    id, title, component: "data-result", tabComponent: "data-tab", params: { source }, renderer: "always",
    ...(reference ? { position: { referencePanel: reference.id, direction: reference.id === "explorer" ? "right" : "within" } } : {}),
  });
  if (source.kind === "query") {
    const removal = api.onDidRemovePanel(panel => {
      if (panel.id !== id) return;
      // Dockview can emit a removal while transferring a panel between groups.
      queueMicrotask(() => {
        if (!api.getPanel(id)) {
          removal.dispose();
          void releaseResult(source.connectionId, source.info.id).catch(error => console.warn(error.code ?? "Result release failed"));
        }
      });
    });
  }
}

export function removeRestoredDataTabs(api: DockApi) {
  for (const panel of [...api.panels]) {
    if (isDataTab(panel.id)) api.removePanel(panel);
  }
}
