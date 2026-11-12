import { expect, it } from "vitest";
import type { ResultInfo } from "@/services/browse-protocol";
import { encodeEditRequest, parseWriteValue, type OriginalRow } from "@/services/edit-protocol";
import { createChangeSet, deleteRows, rowIdentity, updateCell, withChanges } from "./change-set";

const info: ResultInfo = {
  id: "1", columns: ["pk", "v", "n"], maxPageSize: 100, rowCount: null,
  editing: { schemaVersion: 1, readOnlyReason: null, writable: [true, true, true], identityColumns: [0], rowIdAlias: null },
};

it("merges repeated updates against the first snapshot and removes restored values", () => {
  const row: OriginalRow = { rowId: null, cells: [{ type: "integer", value: "9223372036854775807" }, { type: "null" }, { type: "text", value: "seed" }] };
  const key = rowIdentity(info.editing!, row.cells, null)!;
  let set = createChangeSet(info);
  set = updateCell(set, key, row, { column: 1, value: parseWriteValue("text", "") });
  const freshRow: OriginalRow = { ...row, cells: [row.cells[0], { type: "text", value: "concurrent" }, row.cells[2]] };
  set = updateCell(set, key, freshRow, { column: 2, value: parseWriteValue("text", "new") });
  set = updateCell(set, key, freshRow, { column: 1, value: parseWriteValue("null", "") });
  expect(set.entries.get(key)).toEqual({ kind: "update", target: row, values: [{ column: 2, value: { type: "text", value: "new" } }] });
  set = updateCell(set, key, row, { column: 2, value: parseWriteValue("text", "seed") });
  expect(set.entries.size).toBe(0);
  set = withChanges(set, [["new", { kind: "insert", values: [] }]]);
  set = deleteRows(set, [{ key: "new", original: row }, { key, original: row }]);
  expect([...set.entries.values()]).toEqual([{ kind: "delete", target: row }]);
  expect(updateCell(set, key, row, { column: 1, value: { type: "text", value: "ignored" } })).toBe(set);
});

it("validates SQLite storage classes and enforces payload limits without Number converting int64", () => {
  expect(parseWriteValue("integer", "-9223372036854775808")).toEqual({ type: "integer", value: "-9223372036854775808" });
  expect(() => parseWriteValue("integer", "9223372036854775808")).toThrow(/int64/);
  expect(() => parseWriteValue("integer", "1.0")).toThrow(/十进制/);
  expect(parseWriteValue("blob", "00FF")).toEqual({ type: "blob", value: "00ff" });
  expect(() => parseWriteValue("blob", "123")).toThrow(/十六进制/);
  expect(() => parseWriteValue("real", "1e999")).toThrow(/REAL/);
  expect(parseWriteValue("text", "猫😀")).toEqual({ type: "text", value: "猫😀" });
  expect(() => parseWriteValue("text", "\ud800")).toThrow(/Unicode/);
  expect(() => encodeEditRequest({ schemaVersion: 1, changes: Array.from({ length: 257 }, () => ({ kind: "insert", values: [] })) })).toThrow(/256/);
  expect(() => encodeEditRequest({ schemaVersion: 1, changes: Array.from({ length: 40 }, () => ({
    kind: "insert", values: [{ column: 0, value: parseWriteValue("blob", "ab".repeat(16_384)) }],
  })) })).toThrow(/1 MiB/);
});
