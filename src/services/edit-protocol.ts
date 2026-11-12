import type { BrowseCell } from "./browse-protocol";
import { isRecord, isUint } from "./result-values";

export type WriteType = "null" | "text" | "integer" | "real" | "blob";
export type WriteValue = { type: "null" } | { type: Exclude<WriteType, "null">; value: string };
export interface ColumnValue { column: number; value: WriteValue }
export interface OriginalRow { rowId: string | null; cells: BrowseCell[] }
export type Change =
  | { kind: "insert"; values: ColumnValue[] }
  | { kind: "update"; target: OriginalRow; values: ColumnValue[] }
  | { kind: "delete"; target: OriginalRow };
export interface EditRequest { schemaVersion: number; changes: Change[] }
export interface EditResult { inserted: number; updated: number; deleted: number }

export const MAX_CHANGES = 256;
export const MAX_EDIT_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

export function encodeEditRequest(request: EditRequest) {
  const payload = JSON.stringify(request);
  if (request.changes.length > MAX_CHANGES || encoder.encode(payload).length > MAX_EDIT_BYTES) {
    throw new Error("每批修改最多 256 行，提交数据最多 1 MiB。");
  }
  return payload;
}

export function decodeEditResult(value: unknown): EditResult {
  if (!isRecord(value) || !isUint(value.inserted) || !isUint(value.updated) || !isUint(value.deleted) ||
    value.inserted + value.updated + value.deleted < 1 || value.inserted + value.updated + value.deleted > MAX_CHANGES) {
    throw new Error("Invalid edit acknowledgement");
  }
  return { inserted: value.inserted, updated: value.updated, deleted: value.deleted };
}

export function parseWriteValue(type: WriteType, input: string): WriteValue {
  switch (type) {
    case "null": return { type };
    case "text":
      if (encoder.encode(input).length > 16_384 || /[\uD800-\uDFFF]/u.test(input)) {
        throw new Error("TEXT 必须是有效 Unicode，且最多 16 KiB。");
      }
      return { type, value: input };
    case "integer": {
      if (input.length > 20 || !/^[+-]?\d+$/.test(input)) throw new Error("请输入十进制整数。");
      const value = BigInt(input);
      if (value < -(1n << 63n) || value >= (1n << 63n)) throw new Error("整数超出 int64 范围。");
      return { type, value: value.toString() };
    }
    case "real":
      if (input.length > 64 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input) ||
        !Number.isFinite(Number(input))) throw new Error("请输入有限的 REAL 数值。");
      return { type, value: input };
    case "blob":
      if (input.length > 32_768 || !/^(?:[0-9a-f]{2})*$/i.test(input)) {
        throw new Error("BLOB 使用成对的十六进制数字，最多 16 KiB。");
      }
      return { type, value: input.toLowerCase() };
  }
}
