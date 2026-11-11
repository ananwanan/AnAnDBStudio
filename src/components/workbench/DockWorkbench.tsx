import { useEffect, useMemo, useState } from "react";
import {
  DockviewReact,
  themeDark,
  themeLight,
  type DockviewReadyEvent,
} from "dockview-react";
import {
  restoreLayout,
  subscribeLayoutPersistence,
  type DockApi,
} from "@/lib/dock-layout";
import { reconcileSqlTabs } from "@/lib/sql-tabs";
import { useTheme } from "@/components/theme-provider";
import { ExplorerSidebar } from "./ExplorerSidebar";
import { WelcomePanel } from "./WelcomePanel";
import { ResultsPanel } from "./ResultsPanel";
import { SqlEditorPanel } from "./SqlEditorPanel";

interface DockWorkbenchProps {
  onNewConnection: () => void;
  onApiReady: (api: DockApi) => void;
}

function useDockTheme() {
  const { theme } = useTheme();
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return theme === "dark" || (theme === "system" && systemDark) ? themeDark : themeLight;
}

export function DockWorkbench({ onApiReady, onNewConnection }: DockWorkbenchProps) {
  const theme = useDockTheme();
  const components = useMemo(() => ({
    explorer: () => <ExplorerSidebar onNewConnection={onNewConnection} />,
    welcome: () => <WelcomePanel />,
    results: ResultsPanel,
    "sql-editor": SqlEditorPanel,
  }), [onNewConnection]);
  const [api, setApi] = useState<DockApi | null>(null);

  function handleReady(event: DockviewReadyEvent) {
    const instance = event.api;
    restoreLayout(instance);
    reconcileSqlTabs(instance);
    setApi(instance);
    onApiReady(instance);
  }

  useEffect(() => {
    if (!api) return;
    return subscribeLayoutPersistence(api);
  }, [api]);

  return (
    <section aria-label="数据库工作区" className="min-h-0 min-w-0 flex-1">
      <div className="h-full w-full min-h-0 min-w-0">
        <DockviewReact
          className="anandb-dockview"
          theme={theme}
          components={components}
          onReady={handleReady}
        />
      </div>
    </section>
  );
}
