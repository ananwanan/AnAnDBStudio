import { openWorkbenchPanel } from "@/lib/workbench-panels";
import { cancelExecution, executeSql, selectExecution, useSqlExecution } from "@/stores/sql-execution";
import { Suspense, lazy, useState } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { FileCode2, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSqliteWorkspace } from "@/stores/sqlite-workspace";
import {
  forgetSqlDraft,
  renameSqlDraft,
  setSqlDraftConnection,
  updateSqlDraftSql,
  useSqlDrafts,
} from "@/stores/sql-drafts";

const MonacoSqlEditor = lazy(async () => {
  const module = await import("./MonacoSqlEditor");
  return { default: module.MonacoSqlEditor };
});

export function SqlEditorPanel({ api, containerApi }: IDockviewPanelProps) {
  const { drafts, persistenceError } = useSqlDrafts();
  const { connections } = useSqliteWorkspace();
  const draft = drafts.find((entry) => entry.id === api.id);
  const executionState = useSqlExecution();
  const execution = executionState.executions[api.id];
  const [selection, setSelection] = useState({ sql: "", offset: 0 });
  const [capture, setCapture] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);

  if (!draft) {
    return <div role="alert" className="p-4 text-sm">查询草稿不存在，可关闭此标签。</div>;
  }
  const connection = connections.find((item) => item.id === draft.connectionId);
  const staleConnection = draft.connectionId !== null && !connection;

  const busy = Object.values(executionState.executions).some(item => item.running && item.connectionId === draft.connectionId);
  const run = (sql = selection.sql || draft.sql, offset = selection.sql ? selection.offset : 0) => {
    if (!connection || busy || !sql.trim()) return;
    if (!connection.readOnly && !window.confirm("将在读写连接执行 SQL，可能修改或删除数据。未显式 BEGIN 的写入会自动提交，取消不能撤销已提交的修改。继续执行？")) return;
    void executeSql(draft.id, connection.id, sql, timeoutMs, draft.sql, offset, capture);
    if (containerApi) openWorkbenchPanel(containerApi, "results");
  };
  const marker = execution?.result?.error && execution.sourceSql === draft.sql
    ? { ...execution.result.error, offset: execution.selectionOffset + execution.result.error.offset } : null;

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
          disabled={execution?.running}
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
        <Button variant="outline" size="sm" disabled={!connection || busy || !draft.sql.trim()} onClick={() => run()} title="Ctrl/Cmd+Enter：执行选中 SQL，无选区则执行全部">
          <Play className="size-3.5" />执行{selection.sql ? "选中" : "全部"}
        </Button>
        <Button variant="outline" size="sm" disabled={!execution?.running || execution.cancelRequested} onClick={() => void cancelExecution(draft.id)}>取消</Button>
        <select aria-label="查询超时" className="rounded border bg-background px-1 py-1 text-xs" value={timeoutMs} onChange={e => setTimeoutMs(Number(e.target.value))}>
          <option value={5000}>5 秒</option><option value={30000}>30 秒</option><option value={300000}>5 分钟</option>
        </select>
        <label className="flex items-center gap-1 text-xs" title="执行时保留可分页的只读结果，受临时存储和查询超时限制">
          <input type="checkbox" checked={capture} onChange={event => setCapture(event.target.checked)} />
          保留完整结果
        </label>
        {execution && <Button variant="ghost" size="sm" onClick={() => { selectExecution(draft.id); if (containerApi) openWorkbenchPanel(containerApi, "results"); }}>查看结果</Button>}
        <Button
          variant="ghost"
          size="sm"
          disabled={execution?.running}
          aria-label="删除当前查询草稿"
          title="永久删除此查询草稿"
          onClick={() => {
            if (window.confirm("永久删除此 SQL 查询草稿？该操作无法撤销。")) {
              forgetSqlDraft(draft.id);
              api.close();
            }
          }}
        >
          <Trash2 className="size-3.5" />
          删除草稿
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
            onRun={run}
            onSelection={(sql, offset) => setSelection({ sql, offset })}
            error={marker}
          />
        </Suspense>
      </div>
      <footer className="flex shrink-0 items-center justify-between border-t bg-card px-3 py-1 text-[11px] text-muted-foreground">
        <span>SQL · SQLite{connection ? ` · ${connection.readOnly ? "只读" : "读写"}` : " · 未连接"}</span>
        <span>{execution?.running ? (execution.cancelRequested ? "正在请求取消…" : "正在执行…") : "本地草稿自动保存 · Ctrl/Cmd+Enter 执行"}</span>
      </footer>
    </section>
  );
}
