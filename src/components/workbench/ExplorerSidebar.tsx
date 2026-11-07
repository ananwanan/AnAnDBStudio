
import { Database, FolderTree } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export function ExplorerSidebar() {
    return (
        <aside
            aria-label="数据库资源管理器"
            className="flex w-56 shrink-0 flex-col border-r bg-muted/30"
        >
            <div className="flex h-11 items-center gap-2 px-4">
                <FolderTree className="size-4 text-muted-foreground" />
                <span className="text-xs font-semibold tracking-wide">
                    EXPLORER
                </span>
            </div>

            <Separator />

            <div className="flex-1 overflow-auto p-3">
                <div className="flex items-center gap-2 rounded-md px-2 py-2 text-sm">
                    <Database className="size-4 text-muted-foreground" />
                    <span>数据库连接</span>
                </div>

                <div className="mt-4 rounded-md border border-dashed p-3">
                    <p className="text-xs text-muted-foreground">
                        暂无数据库连接
                    </p>

                    <p className="mt-2 text-xs text-muted-foreground">
                        SQLite 连接管理将在 M1 实现。
                    </p>
                </div>
            </div>
        </aside>
    );
}
