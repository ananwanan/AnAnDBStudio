import { decodeCell, isRecord, isUint, type QueryCell } from "./result-values";

export interface ResultInfo {
  id: string;
  columns: string[];
  maxPageSize: number;
  rowCount: number | null;
  editing?: EditInfo;
  observedRowCount?: number;
}

export interface EditInfo {
  schemaVersion: number;
  readOnlyReason: "connection" | "identity" | "width" | null;
  writable: boolean[];
  identityColumns: number[];
  rowIdAlias: string | null;
}

export type BrowseCell = QueryCell | {
  type: "textPreview" | "blobPreview" | "textBytesPreview";
  value: string;
  bytes: number;
};
export type BrowseRow = BrowseCell[];
export interface ResultPage { rows: BrowseRow[]; end: boolean; rowIds?: string[] }

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
    !(raw.rowCount === null || (isUint(raw.rowCount) && raw.rowCount <= 1_000_000)) ||
    !(raw.observedRowCount === undefined || isUint(raw.observedRowCount))) {
    throw new Error("Invalid result session metadata");
  }
  if (raw.editing !== undefined) {
    const edit = raw.editing;
    const width = raw.columns.length;
    if (!isRecord(edit) || typeof edit.schemaVersion !== "number" || !Number.isInteger(edit.schemaVersion) ||
      edit.schemaVersion < -2_147_483_648 || edit.schemaVersion > 2_147_483_647 ||
      ![null, "connection", "identity", "width"].includes(edit.readOnlyReason as string | null) ||
      !Array.isArray(edit.writable) || edit.writable.length !== raw.columns.length ||
      !edit.writable.every(value => typeof value === "boolean") ||
      !Array.isArray(edit.identityColumns) || !edit.identityColumns.every(value => isUint(value) && value < width) ||
      new Set(edit.identityColumns).size !== edit.identityColumns.length ||
      !(edit.rowIdAlias === null || ["rowid", "_rowid_", "oid"].includes(edit.rowIdAlias as string)) ||
      (edit.rowIdAlias !== null && edit.identityColumns.length !== 0) ||
      (edit.readOnlyReason === null && edit.rowIdAlias === null && edit.identityColumns.length === 0)) {
      throw new Error("Invalid table edit metadata");
    }
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
  if (raw.rowIds !== undefined && (!Array.isArray(raw.rowIds) || raw.rowIds.length !== raw.rows.length ||
    !raw.rowIds.every(value => decodeCell({ type: "integer", value })))) {
    throw new Error("Invalid SQLite row identities");
  }
  return raw as unknown as ResultPage;
}
