
import { Database, FileCode2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { RotateCcw } from "lucide-react";
import {
    PanelLeft,
    House,
    Table2,
    X,
} from "lucide-react";

import type { WorkbenchPanelId } from "@/lib/workbench-panels";

const menus = ["文件", "编辑", "视图", "工具", "帮助"];

interface AppHeaderProps {
    onResetLayout: () => void;
    canResetLayout: boolean;
    onOpenPanel: (id: WorkbenchPanelId) => void;
    onCloseActivePanel: () => void;
    activePanel: WorkbenchPanelId | null;
}

export function AppHeader({
    onResetLayout,
    canResetLayout,
    onOpenPanel,
    onCloseActivePanel,
    activePanel,
}: AppHeaderProps) {
    return (
        <header className="shrink-0 border-b bg-card">
            <div className="flex h-12 items-center justify-between gap-3 px-4">
                <div className="flex min-w-0 items-center gap-2">
                    <Database className="size-5 shrink-0 text-primary" />
                    <span className="truncate text-sm font-semibold">
                        AnAnDB Studio
                    </span>
                </div>

                <ThemeSwitcher />
            </div>

            <div className="flex h-9 items-center gap-5 border-t px-4">
                {menus.map((menu) => (
                    <span
                        key={menu}
                        className="text-xs text-muted-foreground"
                    >
                        {menu}
                    </span>
                ))}
            </div>

            <div className="flex h-11 min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap border-t px-3">
                <Button className="shrink-0" size="sm" variant="outline" disabled>
                    <Plus className="size-4" />
                    新建连接
                </Button>

                <Button className="shrink-0" size="sm" variant="outline" disabled>
                    <FileCode2 className="size-4" />
                    新建查询
                </Button>
                <Button
                    className="shrink-0"
                    size="sm"
                    variant="ghost"
                    disabled={!canResetLayout}
                    onClick={onResetLayout}
                    title="恢复默认工作台布局"
                >
                    <RotateCcw className="size-4" />
                    重置布局
                </Button>

                <div className="flex items-center gap-1 border-l pl-2">
                    <Button
                        size="sm"
                        variant={activePanel === "explorer" ? "secondary" : "ghost"}
                        disabled={!canResetLayout}
                        onClick={() => onOpenPanel("explorer")}
                        title="打开或激活 Explorer"
                    >
                        <PanelLeft className="size-4" />
                        Explorer
                    </Button>

                    <Button
                        size="sm"
                        variant={activePanel === "welcome" ? "secondary" : "ghost"}
                        disabled={!canResetLayout}
                        onClick={() => onOpenPanel("welcome")}
                        title="打开或激活 Welcome"
                    >
                        <House className="size-4" />
                        Welcome
                    </Button>

                    <Button
                        size="sm"
                        variant={activePanel === "results" ? "secondary" : "ghost"}
                        disabled={!canResetLayout}
                        onClick={() => onOpenPanel("results")}
                        title="打开或激活 Results"
                    >
                        <Table2 className="size-4" />
                        Results
                    </Button>

                    <Button
                        size="sm"
                        variant="outline"
                        disabled={activePanel === null}
                        onClick={onCloseActivePanel}
                        title="关闭当前活动面板"
                    >
                        <X className="size-4" />
                        关闭面板
                    </Button>
                </div>

                <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
                    Database Workbench
                </span>
            </div>
        </header>
    );
}
