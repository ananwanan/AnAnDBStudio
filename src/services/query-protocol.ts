export type QueryCell = { type: "null" } | {
  type: "integer" | "real" | "text" | "blob" | "textBytes";
  value: string;
};
export interface StatementResult {
  index: number;
  columns: string[];
  rows: QueryCell[][];
  affectedRows: string;
  truncated: boolean;
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
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uint = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === "string";
const decimal = (v: unknown): v is string => text(v) && /^\d+$/.test(v) && v.length <= 20;
function validCell(v: unknown): boolean {
  if (!record(v)) return false;
  if (v.type === "null") return true;
  if (!text(v.value) || v.value.length > 32768) return false;
  switch (v.type) {
    case "integer": return /^-?\d+$/.test(v.value) && BigInt(v.value) >= -(1n << 63n) && BigInt(v.value) < (1n << 63n);
    case "real": return /^(?:-?inf|NaN)$/.test(v.value) || (v.value.trim() !== "" && Number.isFinite(Number(v.value)));
    case "text": return true;
    case "blob": case "textBytes": return /^(?:[0-9a-f]{2})*$/.test(v.value);
    default: return false;
  }
}
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
    if (!record(s) || s.index !== index || !Array.isArray(s.columns) || s.columns.length > 128 ||
      !s.columns.every(text) || !Array.isArray(s.rows) || s.rows.length > 200 ||
      !decimal(s.affectedRows) || typeof s.truncated !== "boolean" ||
      !s.rows.every(row => Array.isArray(row) && row.length === (s.columns as unknown[]).length && row.every(validCell))) {
      throw new Error("Invalid statement result");
    }
  }
  if (JSON.stringify(v).length > 2 * 1024 * 1024) throw new Error("Query result exceeds preview budget");
  return v as unknown as QueryJob;
}
