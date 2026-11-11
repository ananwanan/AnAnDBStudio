import { decodeResultInfo, type ResultInfo } from "./browse-protocol";
import { decimal, decodeCell, isRecord as record, isUint as uint, text, type QueryCell } from "./result-values";

export type { QueryCell } from "./result-values";
export interface StatementResult {
  index: number;
  columns: string[];
  rows: QueryCell[][];
  affectedRows: string;
  truncated: boolean;
  fullResult?: ResultInfo;
  fullResultError?: string;
}
export interface QueryResult {
  statements: StatementResult[];
  error: { message: string; statementIndex: number; offset: number } | null;
  status: "completed" | "failed" | "cancelled" | "timedOut";
  elapsedMs: number;
  transactionOpen: boolean;
  rolledBack: boolean;
}
export interface QueryJob { id: string; result: QueryResult | null }
export function decodeQueryId(v: unknown): string {
  if (!decimal(v) || v === "0") throw new Error("Invalid query job identifier");
  return v;
}
export function decodeQueryJob(v: unknown): QueryJob {
  if (!record(v)) throw new Error("Invalid query job");
  decodeQueryId(v.id);
  if (v.result === null) return { id: v.id as string, result: null };
  const r = v.result;
  if (!record(r) || !["completed", "failed", "cancelled", "timedOut"].includes(String(r.status)) ||
    !uint(r.elapsedMs) || typeof r.transactionOpen !== "boolean" || typeof r.rolledBack !== "boolean" ||
    !Array.isArray(r.statements) || r.statements.length > 100 ||
    !(r.error === null || (record(r.error) && text(r.error.message) && r.error.message.length <= 300000 &&
      uint(r.error.statementIndex) && r.error.statementIndex <= 100 && uint(r.error.offset) && r.error.offset <= 262144)) ||
    (r.status === "completed") !== (r.error === null)) throw new Error("Invalid query result");
  for (const [index, s] of r.statements.entries()) {
    if (!record(s) || s.index !== index || !Array.isArray(s.columns) || s.columns.length > 2048 ||
      !s.columns.every(text) || !Array.isArray(s.rows) || s.rows.length > 200 ||
      !decimal(s.affectedRows) || typeof s.truncated !== "boolean" ||
      !s.rows.every(row => Array.isArray(row) && row.length === (s.columns as unknown[]).length && row.every(decodeCell))) {
      throw new Error("Invalid statement result");
    }
    if (s.fullResult !== undefined) {
      const info = decodeResultInfo(s.fullResult);
      if (info.rowCount === null || info.columns.length !== s.columns.length ||
        !info.columns.every((column, i) => column === (s.columns as string[])[i])) {
        throw new Error("Result session metadata does not match the statement");
      }
    }
    if (s.fullResultError !== undefined && (!text(s.fullResultError) || s.fullResultError.length > 4096)) {
      throw new Error("Invalid full result error");
    }
  }
  if (JSON.stringify(v).length > 2 * 1024 * 1024) throw new Error("Query result exceeds preview budget");
  return v as unknown as QueryJob;
}
