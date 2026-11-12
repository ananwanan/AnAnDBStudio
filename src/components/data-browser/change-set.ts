import type { BrowseCell, BrowseRow, EditInfo, ResultInfo } from "@/services/browse-protocol";
import { encodeEditRequest, type Change, type ColumnValue, type OriginalRow, type WriteValue } from "@/services/edit-protocol";

export interface ChangeSet {
  schemaVersion: number;
  columns: string[];
  editing: EditInfo;
  entries: ReadonlyMap<string, Change>;
}

export function createChangeSet(info: ResultInfo): ChangeSet {
  const editing = info.editing;
  if (!editing || editing.readOnlyReason) throw new Error("此表为只读。");
  return { schemaVersion: editing.schemaVersion, columns: info.columns, editing, entries: new Map() };
}

export function rowIdentity(info: EditInfo, row: BrowseRow, rowId: string | null) {
  if (info.rowIdAlias) return rowId === null ? null : `rowid:${rowId}`;
  if (!info.identityColumns.length) return null;
  const cells = info.identityColumns.map(index => row[index]);
  return cells.every(cell => cell && cell.type !== "null" && !isPreview(cell)) ? JSON.stringify(cells) : null;
}

export function isPreview(cell: BrowseCell) {
  return cell.type === "textPreview" || cell.type === "blobPreview" || cell.type === "textBytesPreview";
}

export function completeRow(row: BrowseRow) {
  return !row.some(isPreview);
}

function equals(a: BrowseCell, b: WriteValue) {
  if (a.type === "null" || b.type === "null") return a.type === b.type;
  if (a.type !== b.type) return false;
  if (a.type === "real") return Object.is(Number(a.value), Number(b.value));
  return a.value === b.value;
}

export function withChanges(set: ChangeSet, edits: Iterable<[string, Change | null]>): ChangeSet {
  const entries = new Map(set.entries);
  for (const [id, change] of edits) {
    if (change) entries.set(id, change);
    else entries.delete(id);
  }
  encodeEditRequest({ schemaVersion: set.schemaVersion, changes: [...entries.values()] });
  return { ...set, entries };
}

export function updateCell(set: ChangeSet, key: string, original: OriginalRow, assignment: ColumnValue): ChangeSet {
  const previous = set.entries.get(key);
  if (previous?.kind === "delete" || previous?.kind === "insert") return set;
  const target = previous?.target ?? original;
  const values = previous?.values.filter(value => value.column !== assignment.column) ?? [];
  if (!equals(target.cells[assignment.column], assignment.value)) values.push(assignment);
  return withChanges(set, [[key, values.length ? { kind: "update", target, values } : null]]);
}

export function deleteRows(set: ChangeSet, rows: { key: string; original: OriginalRow }[]): ChangeSet {
  return withChanges(set, rows.map(({ key, original }) => {
    const previous = set.entries.get(key);
    return [key, previous?.kind === "insert" ? null : { kind: "delete", target: previous?.target ?? original }];
  }));
}

export function summarize(set: ChangeSet | null) {
  const counts = { insert: 0, update: 0, delete: 0 };
  set?.entries.forEach(change => { counts[change.kind]++; });
  return counts;
}

export function changesLabel(set: ChangeSet | null) {
  const counts = summarize(set);
  return `新增 ${counts.insert} · 修改 ${counts.update} · 删除 ${counts.delete}`;
}
