import { openDataTab } from "@/lib/data-tabs";
import type { IDockviewPanelProps } from "dockview-react";
import { openSqlTab } from "@/lib/sql-tabs";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { clearQueryHistory, selectExecution, useSqlExecution } from "@/stores/sql-execution";
import { createSqlDraft, updateSqlDraftSql, useSqlDrafts } from "@/stores/sql-drafts";
import type { QueryCell } from "@/services/query-protocol";
const labels: Record<string, string> = { completed: "完成", failed: "失败", cancelled: "已取消", timedOut: "已超时" };
function display(cell: QueryCell): string {
  if (cell.type === "null") return "NULL";
  if (cell.type === "blob") return `BLOB (${cell.value.length / 2} bytes) 0x${cell.value}`;
  if (cell.type === "textBytes") return `TEXT (非 UTF-8) 0x${cell.value}`;
  if (cell.type === "text" && !cell.value.length) return '""';
  return cell.value;
}
export function ResultsPanel({ containerApi }: IDockviewPanelProps) {
  const { executions, selectedId, history } = useSqlExecution();
  const { drafts } = useSqlDrafts();
  const [statementIndex, setStatementIndex] = useState(0);
  const [openError, setOpenError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const item = selectedId ? executions[selectedId] : undefined;
  const result = item?.result;
  const statement = result?.statements[statementIndex] ?? result?.statements[0];
  return (
    <section className="flex h-full min-h-0 flex-col overflow-auto bg-background p-3 text-xs" aria-label="SQL 执行结果">
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <label>查询结果 <select aria-label="结果所属查询" className="rounded border bg-background p-1" value={selectedId ?? ""} onChange={e => { selectExecution(e.target.value); setStatementIndex(0); }}>
          {!selectedId && <option value="">暂无执行</option>}
          {Object.values(executions).map(e => <option key={e.draftId} value={e.draftId}>{drafts.find(d => d.id === e.draftId)?.title ?? "已关闭的查询"} · {e.connectionId}</option>)}
        </select></label>
        {item?.running && <span role="status">{item.cancelRequested ? "正在取消…" : "正在执行…"}</span>}
        {result && <span role="status">{labels[result.status]} · {result.elapsedMs} ms · {result.statements.length} 条语句完成</span>}
      </div>
      {item?.error && <p role="alert" className="text-destructive">{item.error}；执行结果可能未知，请检查数据库状态。</p>}
      {result?.error && <p role="alert" className="whitespace-pre-wrap break-all text-destructive">第 {result.error.statementIndex + 1} 条语句：{result.error.message}</p>}
      {result?.transactionOpen && <p className="text-amber-600">此连接有未提交事务，请执行 COMMIT 或 ROLLBACK；关闭连接将回滚。</p>}
      {result?.rolledBack && <p>发生错误时仍打开的事务已回滚。</p>}
      {result && <p className="my-1 text-muted-foreground">已提交的写入不会因后续错误或取消而撤销。预览只读，每条最多 200 行。执行前可启用“保留完整结果”。</p>}
      {openError && <p role="alert" className="text-destructive">{openError}</p>}
      {statement && <>
        <label>语句 <select aria-label="语句结果" className="rounded border bg-background p-1" value={statement.index} onChange={e => setStatementIndex(Number(e.target.value))}>
          {result?.statements.map(s => <option key={s.index} value={s.index}>#{s.index + 1} · {s.rows.length} 行预览 · 影响 {s.affectedRows} 行</option>)}
        </select></label>
        {statement.fullResult && item && <Button size="xs" variant="outline" className="my-1 w-fit" onClick={() => {
          if (!statement.fullResult) return;
          setOpenError(null);
          try {
            openDataTab(containerApi, { kind: "query", connectionId: item.connectionId, info: statement.fullResult },
              `${drafts.find(draft => draft.id === item.draftId)?.title ?? "Query"} · #${statement.index + 1}`);
          } catch (error) {
            setOpenError(error instanceof Error ? error.message : "无法打开结果标签");
          }
        }}>打开数据标签 · {statement.fullResult.rowCount} 行</Button>}
        {statement.fullResultError && <p className="text-amber-600">{statement.fullResultError}</p>}
        {statement.truncated && <p className="text-amber-600">结果已达到预览上限。</p>}
        {!!statement.columns.length && <div className="my-2 max-h-72 overflow-auto border"><table className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-card"><tr>{statement.columns.map((name, i) => <th key={i} className="border p-1">{name}</th>)}</tr></thead>
          <tbody>{statement.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} title={display(cell)} className="max-w-80 truncate border p-1 font-mono">{display(cell)}</td>)}</tr>)}</tbody>
        </table></div>}
      </>}
      {!item && <p className="py-4 text-muted-foreground">在 SQL 标签绑定连接后，按 Ctrl/Cmd+Enter 执行。</p>}
      <details className="mt-3 border-t pt-2"><summary>查询历史（仅本次会话，最多 50 条）</summary>
        <Button size="sm" variant="ghost" disabled={!history.length} onClick={clearQueryHistory}>清空历史</Button>
        {notice && <p role="status">{notice}</p>}
        {history.map((entry, i) => <div key={`${entry.time}-${i}`} className="flex items-center gap-2 border-t py-1">
          <span>{new Date(entry.time).toLocaleTimeString()} · {entry.connectionId} · {labels[entry.status]}</span>
          <code className="min-w-0 flex-1 truncate" title={entry.sql}>{entry.sql}</code>
          <Button size="sm" variant="outline" onClick={() => {
            try { const draft = createSqlDraft(null); updateSqlDraftSql(draft.id, entry.sql); openSqlTab(containerApi, draft); setNotice(`已恢复到 ${draft.title}，请选择目标连接；尚未执行。`); }
            catch (error) { setNotice(error instanceof Error ? error.message : "无法恢复草稿"); }
          }}>恢复草稿</Button>
        </div>)}
      </details>
    </section>
  );
}
