
import { AppHeader } from "@/components/workbench/AppHeader";
import { ExplorerSidebar } from "@/components/workbench/ExplorerSidebar";
import { WelcomePanel } from "@/components/workbench/WelcomePanel";
import { StatusBar } from "@/components/workbench/StatusBar";

export default function App() {
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <AppHeader />

      <div className="flex min-h-0 flex-1">
        <ExplorerSidebar />
        <WelcomePanel />
      </div>

      <StatusBar />
    </div>
  );
}
