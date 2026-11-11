import { decodeCell, isRecord, isUint, type QueryCell } from "./result-values";

export interface ResultInfo {
  id: string;
  columns: string[];
  maxPageSize: number;
  rowCount: number | null;
}

export type BrowseCell = QueryCell | {
  type: "textPreview" | "blobPreview" | "textBytesPreview";
  value: string;
  bytes: number;
};
export type BrowseRow = BrowseCell[];
export interface ResultPage { rows: BrowseRow[]; end: boolean }

export type FilterOperator = "eq" | "ne" | "gt" | "lt" | "ge" | "le" | "contains" | "like" | "isNull" | "isNotNull";
export type FilterValue = { type: "text" | "integer" | "real" | "blob"; value: string };
export interface TableRequest {
  schema: "main";
  table: string;
  sort: { column: string; descending: boolean } | null;
  filter: { column: string; operator: FilterOperator; value: FilterValue | null } | null;
}

export function decodeResultInfo(raw: unknown): ResultInfo {
  if (!isRecord(raw) ||
    typeof raw.id !== "string" || !/^[1-9]\d{0,19}$/.test(raw.id) ||
    !Array.isArray(raw.columns) || raw.columns.length < 1 || raw.columns.length > 2048 ||
    !raw.columns.every(column => typeof column === "string" && column.length <= 262144) ||
    !isUint(raw.maxPageSize) || raw.maxPageSize < 1 || raw.maxPageSize > 100 ||
    !(raw.rowCount === null || (isUint(raw.rowCount) && raw.rowCount <= 1_000_000))) {
    throw new Error("Invalid result session metadata");
  }
  return raw as unknown as ResultInfo;
}

function validBrowseCell(raw: unknown): raw is BrowseCell {
  if (!isRecord(raw)) return false;
  if (raw.type === "textPreview" || raw.type === "blobPreview" || raw.type === "textBytesPreview") {
    return isUint(raw.bytes) && typeof raw.value === "string" &&
      decodeCell({ type: raw.type.slice(0, -7), value: raw.value }) &&
      raw.bytes > (raw.type === "textPreview" ? raw.value.length : raw.value.length / 2);
  }
  return decodeCell(raw);
}

export function decodeResultPage(raw: unknown): ResultPage {
  if (!isRecord(raw) || typeof raw.end !== "boolean" || !Array.isArray(raw.rows) || raw.rows.length > 100 ||
    !raw.rows.every(row => Array.isArray(row) && row.length > 0 && row.length <= 2048 && row.every(validBrowseCell))) {
    throw new Error("Invalid SQLite result page");
  }
  return raw as unknown as ResultPage;
}
