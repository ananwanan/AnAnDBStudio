import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  CellStyleModule, ColumnAutoSizeModule, InfiniteRowModelModule, RenderApiModule,
  RowApiModule, ScrollApiModule, TooltipModule, themeQuartz,
  type CellClickedEvent, type ColDef, type GridApi,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { Button } from "@/components/ui/button";
import type { BrowseRow, ResultInfo } from "@/services/browse-protocol";
import { IpcError } from "@/services/ipc";
import { exportSelection, readResultPage } from "@/services/sqlite-results";
import { createResultDatasource } from "./result-datasource";
import {
  MAX_SELECTION_CELLS, cellTooltip, clipboardCell, displayCell, serializeSelection,
  type Delimiter,
} from "./selection";

const modules = [
  InfiniteRowModelModule, ColumnAutoSizeModule, TooltipModule, CellStyleModule,
  RenderApiModule, RowApiModule, ScrollApiModule,
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
}

export function DataGrid({ connectionId, info, pageSize, baseOffset = 0, onCancel, controls }: DataGridProps) {
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
  const selection = useRef<Range | null>(null);
  const extendingWithMouse = useRef(false);

  const columnDefs = useMemo<ColDef<BrowseRow>[]>(() => [
    {
      colId: ROW_NUMBER, headerName: "#", width: 82, pinned: "left", lockPinned: true,
      resizable: false, suppressAutoSize: true, valueGetter: ({ node }) => baseOffset + (node?.rowIndex ?? -1) + 1,
    },
    ...info.columns.map((name, index): ColDef<BrowseRow> => ({
      colId: String(index),
      headerName: name || '""',
      headerTooltip: name,
      width: 150,
      valueGetter: ({ data }) => data?.[index] ? displayCell(data[index]) : "",
      tooltipValueGetter: ({ data }) => data?.[index] ? cellTooltip(data[index]) : undefined,
      cellClassRules: {
        "anandb-cell-selected": ({ node }) => {
          if (!selection.current || node.rowIndex === null) return false;
          const { top, bottom, left, right } = bounds(selection.current);
          return node.rowIndex >= top && node.rowIndex <= bottom && index >= left && index <= right;
        },
      },
    })),
  ], [info.columns, baseOffset]);

  useEffect(() => {
    if (!api) return;
    const source = createResultDatasource(
      (offset, limit, signal) => readResultPage(connectionId, info, baseOffset + offset, limit, signal),
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
  }, [api, connectionId, info, baseOffset]);

  function choose(point: Point, extend: boolean) {
    selection.current = { start: extend && selection.current ? selection.current.start : point, end: point };
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
      rows.push(data.slice(left, right + 1));
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

  if (expired) return <p role="alert" className="p-3 text-xs text-destructive">{error}</p>;

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-card px-2 py-1">
        {controls}
        <Button size="xs" variant="ghost" onClick={() => api?.autoSizeAllColumns()}>适配列宽</Button>
        <Button size="xs" variant="ghost" disabled={!hasSelection} onClick={() => void copy()}>复制</Button>
        <Button size="xs" variant="ghost" disabled={!hasSelection || saving} onClick={() => void download("\t")}>导出 TSV</Button>
        <Button size="xs" variant="ghost" disabled={!hasSelection || saving} onClick={() => void download(",")}>导出 CSV</Button>
        {pending > 0 && <Button size="xs" variant="outline" onClick={onCancel}>取消加载</Button>}
        {notice && <span role="status" className="text-xs text-muted-foreground">{notice}</span>}
      </div>
      {error && <p role="alert" className="border-b px-2 py-1 text-xs text-destructive">{error}</p>}
      <div className="relative min-h-0 min-w-0 flex-1" aria-label="只读数据表格"
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
        {pending ? "正在加载…" : "只读"} · 已缓存 {loaded} 行 · 每页 {pageSize} 行{total === null ? "" : ` · 共 ${total} 行`}
      </footer>
    </>
  );
}
