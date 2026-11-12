import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  CellStyleModule, ColumnAutoSizeModule, CustomEditorModule, InfiniteRowModelModule, RenderApiModule,
  RowApiModule, ScrollApiModule, TooltipModule, themeQuartz,
  type CellClickedEvent, type ColDef, type GridApi,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { Button } from "@/components/ui/button";
import type { BrowseCell, BrowseRow, ResultInfo } from "@/services/browse-protocol";
import { MAX_CHANGES, type WriteValue } from "@/services/edit-protocol";
import { IpcError } from "@/services/ipc";
import { exportSelection, readResultPage } from "@/services/sqlite-results";
import { createResultDatasource } from "./result-datasource";
import { completeRow, deleteRows, rowIdentity, updateCell } from "./change-set";
import { ValueEditor } from "./ValueEditor";
import type { TableEdits } from "./use-table-edits";
import {
  MAX_SELECTION_CELLS, cellTooltip, clipboardCell, displayCell, serializeSelection,
  type Delimiter,
} from "./selection";

const modules = [
  InfiniteRowModelModule, ColumnAutoSizeModule, TooltipModule, CellStyleModule,
  RenderApiModule, RowApiModule, ScrollApiModule, CustomEditorModule,
];
const gridTheme = themeQuartz.withParams({
  backgroundColor: "var(--background)",
  foregroundColor: "var(--foreground)",
  headerBackgroundColor: "var(--card)",
  borderColor: "var(--border)",
  accentColor: "var(--primary)",
  fontFamily: "inherit",
  fontSize: 12,
  spacing: 5,
});
const ROW_NUMBER = "row-number";
const defaults: ColDef<BrowseRow> = {
  sortable: false, editable: false, resizable: true, suppressMovable: true, cellDataType: false,
};

type Point = { row: number; column: number };
type Range = { start: Point; end: Point };

function bounds({ start, end }: Range) {
  return {
    top: Math.min(start.row, end.row), bottom: Math.max(start.row, end.row),
    left: Math.min(start.column, end.column), right: Math.max(start.column, end.column),
  };
}

interface DataGridProps {
  connectionId: string;
  info: ResultInfo;
  pageSize: number;
  baseOffset?: number;
  onCancel: () => void;
  controls?: ReactNode;
  edits?: TableEdits;
}

export function DataGrid({ connectionId, info, pageSize, baseOffset = 0, onCancel, controls, edits }: DataGridProps) {
  const [api, setApi] = useState<GridApi<BrowseRow> | null>(null);
  const [pending, setPending] = useState(0);
  const [total, setTotal] = useState(info.rowCount);
  const [empty, setEmpty] = useState(info.rowCount === 0);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [hasSelection, setHasSelection] = useState(false);
  const [hasDeleteSelection, setHasDeleteSelection] = useState(false);
  const selection = useRef<Range | null>(null);
  const deleteSelection = useRef<WeakRef<BrowseRow>[]>([]);
  const extendingWithMouse = useRef(false);
  const rowIds = useMemo(() => new WeakMap<BrowseRow, string>(), [info]);
  const editState = useRef(edits);
  const canWrite = !!edits && !!info.editing && !info.editing.readOnlyReason && !edits.saving && !edits.blocked &&
    !edits.uncertain && (!edits.draft || edits.draft.schemaVersion === info.editing.schemaVersion);
  const writeState = useRef(canWrite);
  useLayoutEffect(() => {
    editState.current = edits;
    writeState.current = canWrite;
  });

  const access = useMemo(() => {
    const editing = info.editing;
    const keys = new WeakMap<BrowseRow, string | null>();
    const complete = new WeakMap<BrowseRow, boolean>();
    function key(row: BrowseRow) {
      if (!editing) return null;
      if (!keys.has(row)) keys.set(row, rowIdentity(editing, row, rowIds.get(row) ?? null));
      return keys.get(row) ?? null;
    }
    function change(row: BrowseRow) {
      const id = key(row);
      const draft = editState.current?.draft;
      return id && draft && draft.schemaVersion === editing?.schemaVersion ? draft.entries.get(id) : undefined;
    }
    function delta(row: BrowseRow, index: number) {
      const entry = change(row);
      return entry?.kind === "update" ? entry.values.find(value => value.column === index)?.value : undefined;
    }
    function target(row: BrowseRow) {
      const id = key(row);
      if (!complete.has(row)) complete.set(row, completeRow(row));
      return id && complete.get(row) ? { key: id, original: { rowId: rowIds.get(row) ?? null, cells: row } } : null;
    }
    return { change, delta, target };
  }, [info.editing, rowIds]);

  const columnDefs = useMemo<ColDef<BrowseRow>[]>(() => [
    {
      colId: ROW_NUMBER, headerName: "#", width: 82, pinned: "left", lockPinned: true,
      resizable: false, suppressAutoSize: true, valueGetter: ({ node, data }) => {
        const number = baseOffset + (node?.rowIndex ?? -1) + 1;
        return data && access.change(data)?.kind === "delete" ? `待删除 ${number}` : number;
      },
      cellClassRules: { "anandb-row-deleted": ({ data }) => !!data && access.change(data)?.kind === "delete" },
    },
    ...info.columns.map((name, index): ColDef<BrowseRow> => ({
      colId: String(index),
      headerName: name || '""',
      headerTooltip: name,
      width: 150,
      valueGetter: ({ data }) => data ? access.delta(data, index) ?? data[index] : undefined,
      cellRenderer: ({ data, value }: { data?: BrowseRow; value?: BrowseCell }) =>
        value ? `${data && access.delta(data, index) ? "✎ " : ""}${displayCell(value)}` : "",
      tooltipValueGetter: ({ data, value }: { data?: BrowseRow; value?: BrowseCell }) => {
        if (!data || !value) return undefined;
        if (info.editing && !info.editing.readOnlyReason && !access.target(data)) {
          return `${cellTooltip(value)} · 原行含部分预览值，无法核对完整原值。`;
        }
        if (info.editing?.writable[index] === false) return `${cellTooltip(value)} · 生成列或隐藏列，只读。`;
        if (value.type === "textBytes") return `${cellTooltip(value)} · 无效 UTF-8，单元格只读。`;
        return `${access.delta(data, index) ? "待修改 · " : ""}${cellTooltip(value)}`;
      },
      editable: ({ data }) => !!data && writeState.current && !!info.editing?.writable[index] &&
        data[index].type !== "textBytes" && !!access.target(data) && access.change(data)?.kind !== "delete",
      cellEditor: ValueEditor,
      cellEditorPopup: true,
      cellEditorParams: ({ data }: { data: BrowseRow }) => ({
        stage: (value: WriteValue) => {
          const target = access.target(data);
          if (!target || !writeState.current) throw new Error("此行当前无法编辑。");
          editState.current?.change(info, set => updateCell(set, target.key, target.original, { column: index, value }));
        },
      }),
      suppressKeyboardEvent: ({ event, editing }) => editing || event.isComposing || event.keyCode === 229 ||
        (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete")),
      cellClassRules: {
        "anandb-cell-modified": ({ data }) => !!data && !!access.delta(data, index),
        "anandb-row-deleted": ({ data }) => !!data && access.change(data)?.kind === "delete",
        "anandb-cell-selected": ({ node }) => {
          if (!selection.current || node.rowIndex === null) return false;
          const { top, bottom, left, right } = bounds(selection.current);
          return node.rowIndex >= top && node.rowIndex <= bottom && index >= left && index <= right;
        },
      },
    })),
  ], [info, baseOffset, access]);

  useEffect(() => { api?.refreshCells({ force: true }); }, [api, edits?.draft, canWrite]);

  useEffect(() => {
    if (!api) return;
    const source = createResultDatasource(
      async (offset, limit, signal) => {
        const page = await readResultPage(connectionId, info, baseOffset + offset, limit, signal);
        page.rowIds?.forEach((id, index) => rowIds.set(page.rows[index], id));
        return page;
      },
      setPending,
      (offset, page) => {
        if (offset === 0) setEmpty(page.rows.length === 0);
        if (page.end && (baseOffset === 0 || page.rows.length > 0)) {
          const end = baseOffset + offset + page.rows.length;
          setTotal(previous => Math.min(previous ?? Infinity, end));
        }
      },
      error => {
        setError(error instanceof Error ? error.message : "读取数据页失败");
        if (error instanceof IpcError &&
          ["RESULT_EXPIRED", "RESULT_CANCELLED", "RESULT_TIMED_OUT", "CONNECTION_NOT_FOUND", "QUERY_FAILED"].includes(error.code)) {
          setExpired(true);
        }
      },
      info.rowCount === null ? undefined : info.rowCount - baseOffset,
    );
    api.setGridOption("datasource", source);
    return () => source.destroy?.();
  }, [api, connectionId, info, baseOffset, rowIds]);

  function choose(point: Point, extend: boolean) {
    selection.current = { start: extend && selection.current ? selection.current.start : point, end: point };
    const { top, bottom } = bounds(selection.current);
    const rows: WeakRef<BrowseRow>[] = [];
    if (info.editing && api && bottom - top < MAX_CHANGES) {
      for (let index = top; index <= bottom; index++) {
        const data = api.getDisplayedRowAtIndex(index)?.data;
        if (!data || !access.target(data)) break;
        rows.push(new WeakRef(data));
      }
    }
    deleteSelection.current = rows.length === bottom - top + 1 ? rows : [];
    setHasDeleteSelection(deleteSelection.current.length > 0);
    setHasSelection(true);
    setNotice("");
    api?.refreshCells({ force: true });
  }

  function clickCell(event: CellClickedEvent<BrowseRow>) {
    extendingWithMouse.current = false;
    if (event.rowIndex === null || event.column.getColId() === ROW_NUMBER) return;
    choose({ row: event.rowIndex, column: Number(event.column.getColId()) },
      event.event instanceof MouseEvent && event.event.shiftKey);
  }

  function selectedRows(): BrowseRow[] {
    if (!api) throw new Error("表格尚未就绪。");
    const focus = api.getFocusedCell();
    const point = focus && focus.column.getColId() !== ROW_NUMBER
      ? { row: focus.rowIndex, column: Number(focus.column.getColId()) }
      : null;
    const range = selection.current ?? (point && { start: point, end: point });
    if (!range) throw new Error("请选择要复制的单元格。");
    const { top, bottom, left, right } = bounds(range);
    if ((bottom - top + 1) * (right - left + 1) > MAX_SELECTION_CELLS) {
      throw new Error("选区超过 10,000 个单元格，请缩小选区。");
    }
    const rows: BrowseRow[] = [];
    for (let i = top; i <= bottom; i++) {
      const data = api.getDisplayedRowAtIndex(i)?.data;
      if (!data) throw new Error("选区有未加载的数据，请缩小选区。");
      rows.push(data.slice(left, right + 1).map((cell, index) => access.delta(data, left + index) ?? cell));
    }
    return rows;
  }

  async function copy() {
    try {
      const rows = selectedRows();
      const value = rows.length === 1 && rows[0].length === 1
        ? clipboardCell(rows[0][0]) : serializeSelection(rows, "\t");
      await navigator.clipboard.writeText(value);
      setNotice("已复制选区。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "复制失败。");
    }
  }

  async function download(delimiter: Delimiter) {
    setSaving(true);
    try {
      const value = serializeSelection(selectedRows(), delimiter);
      const extension = delimiter === "," ? "csv" : "tsv";
      const saved = await exportSelection(extension, value);
      setNotice(saved ? `已保存 ${extension.toUpperCase()} 选区。` : "已取消保存。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "导出失败。");
    } finally {
      setSaving(false);
    }
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 ||
      (event.target instanceof Element && event.target.closest("textarea, input, select, [data-cell-editor]"))) return;
    const focus = api?.getFocusedCell();
    if (!api || !focus || focus.column.getColId() === ROW_NUMBER) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copy();
    } else if (event.shiftKey && event.key.startsWith("Arrow")) {
      event.preventDefault();
      event.stopPropagation();
      const point = { row: focus.rowIndex, column: Number(focus.column.getColId()) };
      const row = Math.max(0, Math.min(api.getDisplayedRowCount() - 1,
        point.row + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0)));
      const column = Math.max(0, Math.min(info.columns.length - 1,
        point.column + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0)));
      if (!selection.current) choose(point, false);
      choose({ row, column }, true);
      api.ensureIndexVisible(row);
      api.ensureColumnVisible(String(column));
      api.setFocusedCell(row, String(column));
    }
  }

  function markDeletion() {
    try {
      if (!api || !edits || !canWrite || !selection.current) return;
      const { top, bottom } = bounds(selection.current);
      const targets = new Map<string, NonNullable<ReturnType<typeof access.target>>>();
      for (let i = top; i <= bottom; i++) {
        const row = api.getDisplayedRowAtIndex(i)?.data;
        const target = row && access.target(row);
        if (!target || deleteSelection.current[i - top]?.deref() !== row) {
          setHasDeleteSelection(false);
          throw new Error("选区数据已刷新或不完整，请重新选择要删除的行。");
        }
        targets.set(target.key, target);
      }
      edits.change(info, set => deleteRows(set, [...targets.values()]));
      setNotice(`已标记 ${targets.size} 行待删除。`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "无法标记删除。");
    }
  }

  if (expired) return <p role="alert" className="p-3 text-xs text-destructive">{error}</p>;

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-card px-2 py-1">
        {controls}
        <Button size="xs" variant="ghost" onClick={() => api?.autoSizeAllColumns()}>适配列宽</Button>
        <Button size="xs" variant="ghost" disabled={!hasSelection} onClick={() => void copy()}>复制</Button>
        <Button size="xs" variant="ghost" disabled={!hasSelection || saving} onClick={() => void download("\t")}>导出 TSV</Button>
        <Button size="xs" variant="ghost" disabled={!hasSelection || saving} onClick={() => void download(",")}>导出 CSV</Button>
        {edits && <Button size="xs" variant="outline" disabled={!hasDeleteSelection || !canWrite}
          title="选择最多 256 行具有完整原值的数据" onClick={markDeletion}>删除选中行</Button>}
        {pending > 0 && <Button size="xs" variant="outline" onClick={onCancel}>取消加载</Button>}
        {notice && <span role="status" className="text-xs text-muted-foreground">{notice}</span>}
      </div>
      {error && <p role="alert" className="border-b px-2 py-1 text-xs text-destructive">{error}</p>}
      <div className="relative min-h-0 min-w-0 flex-1" aria-label={canWrite ? "可编辑数据表格" : "只读数据表格"}
        onMouseDownCapture={event => { extendingWithMouse.current = event.shiftKey; }}
        onKeyDownCapture={handleKeys}>
        <AgGridReact<BrowseRow>
          modules={modules}
          theme={gridTheme}
          columnDefs={columnDefs}
          defaultColDef={defaults}
          rowModelType="infinite"
          cacheBlockSize={pageSize}
          maxBlocksInCache={4}
          maxConcurrentDatasourceRequests={2}
          blockLoadDebounceMillis={70}
          infiniteInitialRowCount={Math.max(1, info.rowCount === null ? pageSize : info.rowCount - baseOffset)}
          rowHeight={26}
          headerHeight={29}
          rowBuffer={4}
          suppressCellFocus={false}
          suppressDragLeaveHidesColumns
          suppressNoRowsOverlay
          stopEditingWhenCellsLoseFocus
          popupParent={document.body}
          onGridReady={event => setApi(event.api)}
          onCellClicked={clickCell}
          onCellFocused={event => {
            if (extendingWithMouse.current || event.rowIndex === null || !event.column || typeof event.column === "string") return;
            if (selection.current?.end.row === event.rowIndex && String(selection.current.end.column) === event.column.getColId()) return;
            if (event.column.getColId() !== ROW_NUMBER) choose({ row: event.rowIndex, column: Number(event.column.getColId()) }, false);
          }}
          onModelUpdated={event => {
            let rows = 0;
            event.api.forEachNode(node => { if (node.data) rows++; });
            setLoaded(rows);
          }}
        />
        {empty && <div className="pointer-events-none absolute inset-0 grid place-content-center text-xs text-muted-foreground">
          {baseOffset ? "该位置没有数据" : "没有符合条件的数据"}
        </div>}
      </div>
      <footer role="status" className="shrink-0 border-t bg-card px-2 py-1 text-xs text-muted-foreground">
        {pending ? "正在加载…" : canWrite ? "双击或 F2 编辑" : "只读"} · 已缓存 {loaded} 行 · 每页 {pageSize} 行
        {total !== null ? ` · 共 ${total} 行` : info.observedRowCount !== undefined ? ` · 刷新时共 ${info.observedRowCount} 行` : ""}
      </footer>
    </>
  );
}
