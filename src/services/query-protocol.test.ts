import { describe, expect, it } from "vitest";
import { decodeQueryId, decodeQueryJob } from "./query-protocol";
function job() {
  return { id: "1", result: { status: "completed", elapsedMs: 1, transactionOpen: false, rolledBack: false, error: null,
    statements: [{ index: 0, columns: ["x", "x", "x", "x", "x"], rows: [[{ type: "null" }, { type: "integer", value: "9223372036854775807" }, { type: "blob", value: "00ff" }, { type: "text", value: "<script>" }, { type: "textBytes", value: "ff" }]], affectedRows: "0", truncated: false }] } };
}
describe("SQL result protocol", () => {
  it("preserves int64, duplicate column names, null, text and binary bytes", () => {
    expect(decodeQueryJob(job())).toEqual(job());
    expect(decodeQueryJob({ id: "1", result: null })).toEqual({ id: "1", result: null });
  });
  it("rejects malformed cells, identifiers and oversized responses", () => {
    for (const id of [0, "0", "-1", "abc", null]) expect(() => decodeQueryId(id)).toThrow();
    for (const value of [{ type: "integer", value: "9223372036854775808" }, { type: "blob", value: "fff" }, { type: "real", value: "" }, { type: "html", value: "x" }]) {
      const j = job(); j.result.statements[0].rows[0][0] = value;
      expect(() => decodeQueryJob(j)).toThrow();
    }
    const j = job(); j.result.statements[0].rows = Array(201).fill(j.result.statements[0].rows[0]);
    expect(() => decodeQueryJob(j)).toThrow();
  });
  it("rejects row width mismatch and inconsistent completion status", () => {
    const j = job(); j.result.statements[0].columns.pop();
    expect(() => decodeQueryJob(j)).toThrow();
    expect(() => decodeQueryJob({ ...job(), result: { ...job().result, status: "failed" } })).toThrow();
  });
});
