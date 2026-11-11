import type { BrowseCell, BrowseRow } from "@/services/browse-protocol";

function textPreview(value: string, incomplete = false) {
  const limit = 160;
  if (value.length <= limit) return incomplete ? `${value}…` : value;
  // Avoid splitting a UTF-16 surrogate pair at the display boundary.
  const end = value.codePointAt(limit - 1)! > 0xffff ? limit - 1 : limit;
  return `${value.slice(0, end)}…`;
}

export function displayCell(cell: BrowseCell): string {
  switch (cell.type) {
    case "null": return "NULL";
    case "blob": return `BLOB · ${cell.value.length / 2} B`;
    case "blobPreview": return `BLOB · ${cell.bytes} B`;
    case "textBytes": return `TEXT · 0x${cell.value.slice(0, 64)}${cell.value.length > 64 ? "…" : ""}`;
    case "textBytesPreview": return `TEXT · ${cell.bytes} B · 0x${cell.value.slice(0, 64)}…`;
    case "textPreview": return `${textPreview(cell.value, true)} (${cell.bytes} B)`;
    case "text": return cell.value.length === 0 ? '""' : textPreview(cell.value);
    default: return cell.value;
  }
}

export function cellTooltip(cell: BrowseCell): string {
  if (cell.type === "blob" || cell.type === "blobPreview") {
    return `${displayCell(cell)} · 0x${cell.value.slice(0, 64)}${cell.type === "blobPreview" || cell.value.length > 64 ? "…" : ""}`;
  }
  return displayCell(cell);
}

export type Delimiter = "\t" | ",";

function field(cell: BrowseCell, delimiter: Delimiter): string {
  switch (cell.type) {
    case "null": return "NULL";
    case "blob": return `X'${cell.value}'`;
    case "textBytes": return `CAST(X'${cell.value}' AS TEXT)`;
    case "textPreview":
    case "textBytesPreview":
    case "blobPreview":
      throw new Error("选区含超出传输上限的字段。可在 SQL 编辑器中用 substr() 选择较小的片段。");
    case "text": {
      const { value } = cell;
      return value === "" || value === "NULL" || value.includes(delimiter) || /["\r\n]/.test(value)
        ? `"${value.replaceAll('"', '""')}"`
        : value;
    }
    default: return cell.value;
  }
}

export const MAX_SELECTION_CELLS = 10_000;
const MAX_EXPORT_BYTES = 4 * 1024 * 1024;

export function serializeSelection(rows: BrowseRow[], delimiter: Delimiter): string {
  let bytes = 0;
  const encoder = new TextEncoder();
  return rows.map(row => {
    const fields = row.map(cell => {
      const value = field(cell, delimiter);
      bytes += encoder.encode(value).length + 1;
      if (bytes > MAX_EXPORT_BYTES) throw new Error("选区超过 4 MiB，请缩小选区。");
      return value;
    });
    return fields.join(delimiter);
  }).join(delimiter === "," ? "\r\n" : "\n");
}

export function clipboardCell(cell: BrowseCell): string {
  return cell.type === "text" ? cell.value : field(cell, "\t");
}
