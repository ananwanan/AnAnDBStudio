
import { Database, CheckCircle2 } from "lucide-react";

export function StatusBar() {
    return (
        <footer className="flex h-7 shrink-0 items-center justify-between border-t bg-card px-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5" />
                <span>Ready</span>
                <span>·</span>
                <span>未连接数据库</span>
            </div>

            <div className="flex items-center gap-2">
                <Database className="size-3.5" />
                <span>SQLite · M1 Planned</span>
            </div>
        </footer>
    );
}
