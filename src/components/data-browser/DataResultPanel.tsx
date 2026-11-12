import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { Button } from "@/components/ui/button";
import type { DataTabSource } from "@/lib/data-tabs";
import type { ResultInfo } from "@/services/browse-protocol";
import { openTable, releaseResult } from "@/services/sqlite-results";
import { useSqliteWorkspace } from "@/stores/sqlite-workspace";
import { subscribeTableRefresh } from "@/lib/edit-lifecycle";
import { TableControls, type TableOptions } from "./TableControls";
import { EditControls } from "./EditControls";
import { useTableEdits, type TableEdits } from "./use-table-edits";

const DataGrid = lazy(() => import("./DataGrid").then(module => ({ default: module.DataGrid })));

function release(connectionId: string, sessionId: string) {
  void releaseResult(connectionId, sessionId).catch(error => console.warn(error.code ?? "Result release failed"));
}

export function DataResultPanel({ params, api }: IDockviewPanelProps<{ source?: DataTabSource }>) {
  const { connections, closingIds } = useSqliteWorkspace();
  const source = params.source;
  const connection = connections.find(item => item.id === source?.connectionId);
  if (!source || !connection) {
    return <p role="status" className="p-3 text-xs">结果已失效。数据库连接已关闭。</p>;
  }
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-background" aria-label="数据浏览">
      {source.kind === "table" ? <TableResult source={source} panelId={api?.id}
        blocked={closingIds?.includes(connection.id)} showError={() => api?.setActive()} /> : <QueryResult source={source} />}
    </section>
  );
}

function QueryResult({ source }: { source: Extract<DataTabSource, { kind: "query" }> }) {
  const [cancelled, setCancelled] = useState(false);
  if (cancelled) return <p role="status" className="p-3 text-xs">已取消加载，结果已释放。</p>;
  return <ResultGrid connectionId={source.connectionId} info={source.info} onCancel={() => {
    release(source.connectionId, source.info.id);
    setCancelled(true);
  }} />;
}

function TableResult({ source, panelId, blocked, showError }: {
  source: Extract<DataTabSource, { kind: "table" }>;
  panelId?: string;
  blocked?: boolean;
  showError: () => void;
}) {
  const { connectionId, table, schema } = source;
  const [options, setOptions] = useState<TableOptions>({ sort: null, filter: null });
  const [revision, setRevision] = useState(0);
  const [countRows, setCountRows] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [info, setInfo] = useState<ResultInfo | null>(null);
  const [cancelledRevision, setCancelledRevision] = useState<number | null>(null);
  const edits = useTableEdits(panelId, connectionId, table, blocked, showError);
  const refresh = useCallback((count = false) => {
    setCountRows(count);
    setInfo(null);
    setRevision(current => current + 1);
  }, []);
  const opened = useCallback((result: ResultInfo) => {
    setColumns(result.columns);
    setInfo(result);
  }, []);
  useEffect(() => subscribeTableRefresh((id, changedTable) => {
    if (id === connectionId) refresh(changedTable === table);
  }), [connectionId, table, refresh]);
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-2 py-1">
        <span className="max-w-40 truncate text-xs text-muted-foreground" title={`${schema}.${table}`}>{schema}.{table}</span>
        <TableControls columns={columns} onApply={next => {
          setOptions(next);
          refresh();
        }} onRefresh={refresh} />
      </div>
      <EditControls info={info} table={table} edits={edits} />
      {cancelledRevision === revision
        ? <p role="status" className="p-3 text-xs">已取消加载。点击刷新可重新打开。</p>
        : <TableRows key={revision} connectionId={connectionId} table={table} schema={schema} options={options} countRows={countRows}
            edits={edits} onOpened={opened} onCancel={() => { setInfo(null); setCancelledRevision(revision); }} />}
    </>
  );
}

function TableRows({ connectionId, table, schema, options, countRows, edits, onOpened, onCancel }: {
  connectionId: string;
  table: string;
  schema: "main";
  options: TableOptions;
  countRows: boolean;
  edits: TableEdits;
  onOpened: (info: ResultInfo) => void;
  onCancel: () => void;
}) {
  const [info, setInfo] = useState<ResultInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let sessionId: string | undefined;
    void openTable(connectionId, { schema, table, ...options }, controller.signal, countRows).then(result => {
      if (controller.signal.aborted) {
        release(connectionId, result.id);
        return;
      }
      sessionId = result.id;
      onOpened(result);
      setInfo(result);
    }, cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法打开表数据");
    });
    return () => {
      controller.abort();
      if (sessionId) release(connectionId, sessionId);
    };
  }, [connectionId, schema, table, options, countRows, onOpened]);

  if (error) return <p role="alert" className="p-3 text-xs text-destructive">{error}</p>;
  if (!info) return <div className="flex items-center gap-2 p-3 text-xs">
    <span role="status">正在打开表数据…</span>
    <Button size="xs" variant="ghost" onClick={onCancel}>取消加载</Button>
  </div>;
  return <ResultGrid connectionId={connectionId} info={info} onCancel={onCancel} edits={edits} />;
}

function ResultGrid({ connectionId, info, onCancel, edits }: {
  connectionId: string;
  info: ResultInfo;
  onCancel: () => void;
  edits?: TableEdits;
}) {
  const [requestedSize, setRequestedSize] = useState(100);
  const [baseOffset, setBaseOffset] = useState(0);
  const [jumpTo, setJumpTo] = useState("1");
  const pageSize = Math.min(info.maxPageSize, requestedSize);
  const sizes = [...new Set([25, 50, 100].map(size => Math.min(size, info.maxPageSize)))];
  const controls = (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-2">
          每页行数
          <select aria-label="每页行数" className="rounded border bg-background px-1" value={pageSize} onChange={event => setRequestedSize(Number(event.target.value))}>
            {sizes.map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <form className="flex items-center gap-1" onSubmit={event => {
          event.preventDefault();
          const row = Number(jumpTo);
          if (Number.isSafeInteger(row) && row >= 1 && row <= (info.rowCount ?? 2_147_483_647)) {
            setBaseOffset(row - 1);
          }
        }}>
          <input type="number" aria-label="目标行号" min={1} max={Math.max(1, info.rowCount ?? 2_147_483_647)}
            required className="w-24 rounded border bg-background px-1" value={jumpTo}
            onChange={event => setJumpTo(event.target.value)} />
          <Button size="xs" type="submit" variant="ghost" disabled={info.rowCount === 0}>跳到行</Button>
          {baseOffset !== 0 && <Button size="xs" type="button" variant="ghost" onClick={() => {
            setBaseOffset(0); setJumpTo("1");
          }}>回到首行</Button>}
        </form>
      </div>
  );
  return (
    <Suspense fallback={<p role="status" className="p-3 text-xs">正在加载表格…</p>}>
      <DataGrid key={`${pageSize}:${baseOffset}`} connectionId={connectionId} info={info}
        pageSize={pageSize} baseOffset={baseOffset} onCancel={onCancel} controls={controls} edits={edits} />
    </Suspense>
  );
}
