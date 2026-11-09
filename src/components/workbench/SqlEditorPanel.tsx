import { Suspense, lazy, useState } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { FileCode2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSqliteWorkspace } from "@/stores/sqlite-workspace";
import {
  renameSqlDraft,
  setSqlDraftConnection,
  updateSqlDraftSql,
  useSqlDrafts,
} from "@/stores/sql-drafts";

const MonacoSqlEditor = lazy(async () => {
  const module = await import("./MonacoSqlEditor");
  return { default: module.MonacoSqlEditor };
});

export function SqlEditorPanel({ api }: IDockviewPanelProps) {
  const { drafts, persistenceError } = useSqlDrafts();
  const { connections } = useSqliteWorkspace();
  const draft = drafts.find((entry) => entry.id === api.id);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);

  if (!draft) {
    return <div role="alert" className="p-4 text-sm">查询草稿不存在，可关闭此标签。</div>;
  }
  const connection = connections.find((item) => item.id === draft.connectionId);
  const staleConnection = draft.connectionId !== null && !connection;

  const saveTitle = () => {
    if (editingTitle !== null) {
      const next = editingTitle.trim().slice(0, 100);
      if (next) {
        renameSqlDraft(draft.id, next);
        api.setTitle(next);
      }
      setEditingTitle(null);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label="SQL 查询工作台">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
        <input
          aria-label="查询标签名称"
          className="min-w-20 max-w-44 flex-1 rounded border border-transparent bg-transparent px-1 text-xs font-semibold focus:border-input focus:outline-none"
          value={editingTitle ?? draft.title}
          onChange={(event) => setEditingTitle(event.target.value)}
          onBlur={saveTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setEditingTitle(null);
          }}
          maxLength={100}
        />
        <label htmlFor={`sql-connection-${draft.id}`} className="text-xs text-muted-foreground">
          连接
        </label>
        <select
          id={`sql-connection-${draft.id}`}
          aria-label="查询目标连接"
          className="max-w-56 rounded border bg-background px-2 py-1 text-xs"
          value={draft.connectionId ?? ""}
          onChange={(event) => setSqlDraftConnection(draft.id, event.target.value || null)}
        >
          <option value="">未绑定</option>
          {staleConnection && <option value={draft.connectionId!}>连接已关闭（需重新选择）</option>}
          {connections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.path.split(/[/\\]/).pop() || item.path}{item.readOnly ? " (RO)" : ""}
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" disabled title="M2.2 将接入异步 SQL 执行">
          <Play className="size-3.5" />
          执行（M2.2）
        </Button>
      </div>
      {staleConnection && (
        <p role="status" className="border-b px-3 py-1 text-xs text-amber-600">
          此查询原先绑定的连接已关闭；SQL 草稿仍然保留。
        </p>
      )}
      {persistenceError && (
        <p role="alert" className="border-b px-3 py-1 text-xs text-destructive">
          SQL 自动保存失败：{persistenceError}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <Suspense fallback={<p role="status" className="p-4 text-xs text-muted-foreground">正在加载 Monaco SQL 编辑器…</p>}>
          <MonacoSqlEditor
            id={draft.id}
            value={draft.sql}
            onChange={(sql) => updateSqlDraftSql(draft.id, sql)}
          />
        </Suspense>
      </div>
      <footer className="flex shrink-0 items-center justify-between border-t bg-card px-3 py-1 text-[11px] text-muted-foreground">
        <span>SQL · SQLite{connection ? ` · ${connection.readOnly ? "只读" : "读写"}` : " · 未连接"}</span>
        <span>本地草稿自动保存 · 尚未接入 SQL 执行</span>
      </footer>
    </section>
  );
}
