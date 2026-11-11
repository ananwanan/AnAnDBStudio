import { useState } from "react";
import {
  ChevronRight, Database, FolderTree, KeyRound, LoaderCircle,
  Plus, RefreshCw, Table2, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { SqliteSchemaObject, SqliteSchemaObjectKind } from "@/services/ipc-contract";
import {
  dismissSqliteError, refreshSqliteSchema, removeSqliteConnection,
  selectSqliteConnection, useSqliteWorkspace,
} from "@/stores/sqlite-workspace";

const GROUPS: ReadonlyArray<{ kind: SqliteSchemaObjectKind; title: string }> = [
  { kind: "table", title: "Tables" },
  { kind: "view", title: "Views" },
  { kind: "index", title: "Indexes" },
  { kind: "trigger", title: "Triggers" },
];

function SchemaObjectNode({ object, onBrowse }: { object: SqliteSchemaObject; onBrowse: () => void }) {
  const [menu, setMenu] = useState(false);
  const browsable = object.kind === "table" && !object.name.toLowerCase().startsWith("sqlite_");
  return (
    <div>
    <details className="group/object pl-4">
      <summary className="flex cursor-pointer items-center gap-1 rounded px-1 py-1 text-sm hover:bg-muted"
        onDoubleClick={browsable ? onBrowse : undefined}
        onContextMenu={browsable ? event => { event.preventDefault(); setMenu(true); } : undefined}
        onKeyDown={browsable ? event => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault(); setMenu(true);
          }
        } : undefined}>
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open/object:rotate-90" />
        <Table2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate" title={object.name}>{object.name}</span>
      </summary>
      <div className="pl-6 text-xs text-muted-foreground">
        {object.columns.length === 0 ? (
          <div className="py-1">{object.kind === "index" || object.kind === "trigger" ? `所属表：${object.tableName}` : "无字段"}</div>
        ) : object.columns.map((column) => (
          <div key={`${column.cid}:${column.name}`} className="flex flex-wrap items-center gap-1 py-1" title={column.defaultSql === null ? undefined : `DEFAULT ${column.defaultSql}`}>
            {column.primaryKeyPosition > 0 && <KeyRound className="size-3 text-amber-500" aria-label="主键" />}
            <span className="break-all">{column.name}</span>
            <span className="text-[10px] opacity-70">{column.declaredType || "(untyped)"}</span>
            {column.primaryKeyPosition > 0 && <span className="text-[10px]">PK{column.primaryKeyPosition}</span>}
            {column.notNull && <span className="text-[10px]">NOT NULL</span>}
            {column.hidden !== 0 && <span className="text-[10px]">hidden:{column.hidden}</span>}
          </div>
        ))}
      </div>
    </details>
    {menu && <div role="menu" className="ml-6 w-fit rounded border bg-popover p-1 shadow-sm">
      <button role="menuitem" type="button" autoFocus className="rounded px-2 py-1 text-xs hover:bg-muted"
        onBlur={() => setMenu(false)}
        onKeyDown={event => { if (event.key === "Escape") setMenu(false); }}
        onClick={() => { setMenu(false); onBrowse(); }}>查看数据</button>
    </div>}
    </div>
  );
}

interface ExplorerSidebarProps {
  onNewConnection: () => void;
  onOpenTable?: (connectionId: string, schema: "main", table: string) => void;
}

export function ExplorerSidebar({ onNewConnection, onOpenTable }: ExplorerSidebarProps) {
  const workspace = useSqliteWorkspace();
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const selected = workspace.connections.find((connection) => connection.id === workspace.selectedId);
  const schema = selected ? workspace.schemas[selected.id] : undefined;
  const objects = schema?.status === "ready" ? schema.snapshot.objects : [];
  const term = filter.trim().toLocaleLowerCase();

  return (
    <aside aria-label="数据库资源管理器" className="flex h-full min-h-0 w-full flex-col bg-muted/30">
      <div className="flex h-11 items-center justify-between gap-2 px-3">
        <div className="flex items-center gap-2">
          <FolderTree className="size-4 text-muted-foreground" />
          <span className="text-xs font-semibold tracking-wide">EXPLORER</span>
        </div>
        <Button size="icon-xs" variant="ghost" aria-label="新建数据库连接" title="新建连接" onClick={onNewConnection}>
          <Plus className="size-4" />
        </Button>
      </div>
      <Separator />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Database className="size-4 text-muted-foreground" />
          数据库连接
        </div>
        {workspace.loading && <p role="status" className="text-xs text-muted-foreground">正在读取连接列表…</p>}
        {workspace.error && (
          <div role="alert" className="my-2 rounded border border-destructive/40 p-2 text-xs text-destructive">
            {workspace.error}
            <Button size="xs" variant="ghost" onClick={dismissSqliteError}>清除</Button>
          </div>
        )}
        {!workspace.loading && workspace.connections.length === 0 && (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            暂无数据库连接。使用上方 + 打开现有 SQLite 数据库。
          </div>
        )}
        <div className="space-y-1">
          {workspace.connections.map((connection) => (
            <div key={connection.id} className="rounded border border-border/60">
              <div className="flex items-center gap-1 p-1">
                <button
                  type="button"
                  title={connection.path}
                  aria-pressed={workspace.selectedId === connection.id}
                  onClick={() => { selectSqliteConnection(connection.id); setFilter(""); }}
                  className={`flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left text-xs hover:bg-muted ${workspace.selectedId === connection.id ? "bg-muted font-semibold" : ""}`}
                >
                  <Database className="size-3.5 shrink-0" />
                  <span className="truncate">{connection.path.split(/[/\\]/).pop() || connection.path}</span>
                  {connection.readOnly && <span className="shrink-0 text-[10px] text-muted-foreground">RO</span>}
                </button>
                <Button
                  size="icon-xs" variant="ghost" title="刷新 Schema" aria-label={`刷新 ${connection.path}`}
                  disabled={workspace.closingIds.includes(connection.id)}
                  onClick={() => void refreshSqliteSchema(connection.id)}
                ><RefreshCw className="size-3.5" /></Button>
                <Button
                  size="icon-xs" variant="ghost" title="关闭连接" aria-label={`关闭 ${connection.path}`}
                  disabled={workspace.closingIds.includes(connection.id)}
                  onClick={() => void removeSqliteConnection(connection.id).catch(() => undefined)}
                ><Trash2 className="size-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
        {selected && (
          <div className="mt-3" key={selected.id}>
            <input
              className="mb-2 w-full rounded border bg-background px-2 py-1 text-xs"
              type="search"
              aria-label="筛选数据库对象"
              placeholder="筛选表、视图、索引、触发器"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            {browseError && <p role="alert" className="py-1 text-xs text-destructive">{browseError}</p>}
            {schema?.status === "loading" && (
              <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" /> 正在读取 Schema…
              </p>
            )}
            {schema?.status === "error" && (
              <div role="alert" className="rounded border border-destructive/40 p-2 text-xs text-destructive">
                {schema.message}
                <Button size="xs" variant="ghost" onClick={() => void refreshSqliteSchema(selected.id)}>重试</Button>
              </div>
            )}
            {schema?.status === "ready" && GROUPS.map((group) => {
              const matching = objects.filter((object) => object.kind === group.kind && (
                !term || object.name.toLocaleLowerCase().includes(term) ||
                object.tableName.toLocaleLowerCase().includes(term) ||
                object.columns.some((column) => column.name.toLocaleLowerCase().includes(term))
              ));
              return (
                <details key={group.kind} className="group/category" open>
                  <summary className="flex cursor-pointer items-center gap-1 rounded px-1 py-1.5 text-xs font-semibold hover:bg-muted">
                    <ChevronRight className="size-3.5 transition-transform group-open/category:rotate-90" />
                    {group.title} ({matching.length})
                  </summary>
                  {matching.map((object) => <SchemaObjectNode key={`${object.kind}:${object.name}`} object={object} onBrowse={() => {
                    setBrowseError(null);
                    try { onOpenTable?.(selected.id, schema.snapshot.schema, object.name); }
                    catch (error) { setBrowseError(error instanceof Error ? error.message : "无法打开数据标签"); }
                  }} />)}
                  {matching.length === 0 && <p className="pl-5 text-xs text-muted-foreground">无匹配对象</p>}
                </details>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
