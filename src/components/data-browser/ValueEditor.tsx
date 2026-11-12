import { useRef, useState, type KeyboardEvent } from "react";
import { useGridCellEditor, type CustomCellEditorProps } from "ag-grid-react";
import type { BrowseCell, BrowseRow } from "@/services/browse-protocol";
import { parseWriteValue } from "@/services/edit-protocol";
import { ValueFields, initialValue } from "./ValueFields";

export function ValueEditor({ value, column, api, node, stage }: CustomCellEditorProps<BrowseRow, BrowseCell> & {
  stage: (value: ReturnType<typeof parseWriteValue>) => void;
}) {
  const [input, setInput] = useState(() => initialValue(value ?? { type: "null" }));
  const [error, setError] = useState("");
  const composing = useRef(false);
  useGridCellEditor({ isCancelAfterEnd: () => true });

  function finish() {
    api.stopEditing(true);
    if (node.rowIndex !== null) api.setFocusedCell(node.rowIndex, column);
  }

  function confirm() {
    try {
      if (input.type !== "default") stage(parseWriteValue(input.type, input.text));
      finish();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无效值。");
    }
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
    } else if (event.key === "Enter" && !event.shiftKey && (!(event.target instanceof HTMLSelectElement) || input.type === "null")) {
      event.preventDefault();
      if (event.target instanceof HTMLButtonElement) event.target.click();
      else confirm();
    }
  }

  return <div className="w-72 rounded border bg-card p-2 text-xs shadow" data-cell-editor
    onKeyDown={handleKeys} onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}>
    <ValueFields input={input} onChange={setInput} label={column.getColDef().headerName ?? "单元格"} focus />
    {error && <p role="alert" className="mt-1 text-destructive">{error}</p>}
    <div className="mt-1 flex justify-end gap-2">
      <button type="button" className="rounded border px-2 py-1" onClick={finish}>取消</button>
      <button type="button" className="rounded border px-2 py-1" onClick={confirm}>确认</button>
    </div>
  </div>;
}
