export type QueryCell = { type: "null" } | {
  type: "integer" | "real" | "text" | "blob" | "textBytes";
  value: string;
};
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const isUint = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export const text = (v: unknown): v is string => typeof v === "string";
export const decimal = (v: unknown): v is string => text(v) && /^\d+$/.test(v) && v.length <= 20;
export function decodeCell(v: unknown): v is QueryCell {
  if (!isRecord(v)) return false;
  if (v.type === "null") return true;
  if (!text(v.value) || v.value.length > 32768) return false;
  switch (v.type) {
    case "integer": return v.value.length <= 20 && /^-?\d+$/.test(v.value) && BigInt(v.value) >= -(1n << 63n) && BigInt(v.value) < (1n << 63n);
    case "real": return /^(?:-?inf|NaN)$/.test(v.value) || (v.value.trim() !== "" && Number.isFinite(Number(v.value)));
    case "text": return true;
    case "blob": case "textBytes": return /^(?:[0-9a-f]{2})*$/.test(v.value);
    default: return false;
  }
}
