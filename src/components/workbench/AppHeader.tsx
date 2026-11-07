
import { Database, FileCode2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";

const menus = ["文件", "编辑", "视图", "工具", "帮助"];

export function AppHeader() {
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

            <div className="flex h-11 items-center gap-2 border-t px-3">
                <Button size="sm" variant="outline" disabled>
                    <Plus className="size-4" />
                    新建连接
                </Button>

                <Button size="sm" variant="outline" disabled>
                    <FileCode2 className="size-4" />
                    新建查询
                </Button>

                <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
                    Database Workbench
                </span>
            </div>
        </header>
    );
}
