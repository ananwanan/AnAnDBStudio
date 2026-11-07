
import { Table2 } from "lucide-react";

export function ResultsPanel() {
    return (
        <div className="flex h-full min-h-0 flex-col bg-background">
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                <Table2 className="size-8 opacity-40" />

                <p className="text-sm">
                    暂无查询结果
                </p>

                <p className="text-xs">
                    SQL 执行与数据表格将在后续阶段实现。
                </p>
            </div>
        </div>
    );
}
