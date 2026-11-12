import { useLayoutEffect, useRef } from "react";
import type { BrowseCell } from "@/services/browse-protocol";
import type { WriteType } from "@/services/edit-protocol";

export type InputType = WriteType | "default";
export interface ValueInput { type: InputType; text: string }

const TYPES: { type: InputType; label: string }[] = [
  { type: "default", label: "DEFAULT" },
  { type: "null", label: "NULL" },
  { type: "text", label: "TEXT" },
  { type: "integer", label: "INTEGER" },
  { type: "real", label: "REAL" },
  { type: "blob", label: "BLOB（十六进制）" },
];

export function initialValue(cell: BrowseCell): ValueInput {
  switch (cell.type) {
    case "null": return { type: "null", text: "" };
    case "text": case "integer": case "real": case "blob":
      return { type: cell.type, text: cell.value };
    default: return { type: "text", text: "" };
  }
}

export function ValueFields({ input, onChange, allowDefault = false, label, focus = false }: {
  input: ValueInput;
  onChange: (input: ValueInput) => void;
  allowDefault?: boolean;
  label: string;
  focus?: boolean;
}) {
  const select = useRef<HTMLSelectElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!focus) return;
    if (field.current?.disabled) select.current?.focus();
    else {
      field.current?.focus();
      field.current?.select();
    }
  }, [focus, input.type]);
  return <div className="flex flex-wrap items-start gap-1">
    <select ref={select} aria-label={`${label} 类型`} className="rounded border bg-background p-1"
      value={input.type} onChange={event => onChange({ ...input, type: event.target.value as InputType })}>
      {TYPES.filter(item => allowDefault || item.type !== "default").map(item =>
        <option key={item.type} value={item.type}>{item.label}</option>)}
    </select>
    <textarea ref={field} aria-label={`${label} 值`} className="min-w-28 flex-1 rounded border bg-background p-1"
      disabled={input.type === "null" || input.type === "default"}
      rows={2} maxLength={32_768} value={input.text}
      onChange={event => onChange({ ...input, text: event.target.value })} />
  </div>;
}
