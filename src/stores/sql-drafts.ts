import { useSyncExternalStore } from "react";

export const SQL_DRAFT_STORAGE_KEY = "anandb.sql.drafts.v1";
export const SQL_PANEL_PREFIX = "sql-editor:";
const MAX_DRAFTS = 50;
const MAX_SQL_LENGTH = 256 * 1024;
const MAX_STORED_LENGTH = 1024 * 1024;

export interface SqlDraft {
  readonly id: string;
  readonly title: string;
  readonly sql: string;
  readonly connectionId: string | null;
}

interface SqlDraftSnapshot {
  readonly drafts: readonly SqlDraft[];
  readonly persistenceError: string | null;
}

function readDrafts(): SqlDraft[] {
  try {
    const raw = localStorage.getItem(SQL_DRAFT_STORAGE_KEY);
    if (!raw) return [];
    if (raw.length > MAX_STORED_LENGTH) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) ||
      parsed.version !== 1 || !("drafts" in parsed) || !Array.isArray(parsed.drafts)) return [];
    if (parsed.drafts.length > MAX_DRAFTS) return [];
    const ids = new Set<string>();
    const drafts: SqlDraft[] = [];
    for (const entry of parsed.drafts as unknown[]) {
      if (!entry || typeof entry !== "object" ||
        !("id" in entry) || typeof entry.id !== "string" ||
        !entry.id.startsWith(SQL_PANEL_PREFIX) || ids.has(entry.id) ||
        !("title" in entry) || typeof entry.title !== "string" || entry.title.length > 100 ||
        !("sql" in entry) || typeof entry.sql !== "string" || entry.sql.length > MAX_SQL_LENGTH ||
        !("connectionId" in entry) ||
        (entry.connectionId !== null && typeof entry.connectionId !== "string")) return [];
      ids.add(entry.id);
      drafts.push({
        id: entry.id,
        title: entry.title,
        sql: entry.sql,
        connectionId: entry.connectionId,
      });
    }
    return drafts;
  } catch {
    return [];
  }
}

let snapshot: SqlDraftSnapshot = {
  drafts: typeof localStorage === "undefined" ? [] : readDrafts(),
  persistenceError: null,
};
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function notify(next: SqlDraftSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function flush(): void {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  try {
    if (snapshot.drafts.length > MAX_DRAFTS ||
      snapshot.drafts.some((draft) => draft.sql.length > MAX_SQL_LENGTH)) {
      throw new Error("SQL 草稿超出本地保存限额（每个 256 Ki 字符，最多 50 个标签）。");
    }
    const raw = JSON.stringify({ version: 1, drafts: snapshot.drafts });
    if (raw.length > MAX_STORED_LENGTH) {
      throw new Error("SQL 草稿总大小超出本地保存限额（1 Mi 字符）。");
    }
    localStorage.setItem(SQL_DRAFT_STORAGE_KEY, raw);
    if (snapshot.persistenceError) notify({ ...snapshot, persistenceError: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "本地存储不可用。";
    if (snapshot.persistenceError !== message) {
      notify({ ...snapshot, persistenceError: message });
    }
  }
}

function scheduleSave(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}

function changeDrafts(drafts: readonly SqlDraft[]): void {
  notify({ ...snapshot, drafts });
  scheduleSave();
}

export function useSqlDrafts(): SqlDraftSnapshot {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => snapshot,
    () => snapshot,
  );
}

export function getSqlDraft(id: string): SqlDraft | undefined {
  return snapshot.drafts.find((draft) => draft.id === id);
}

export function getSqlDrafts(): readonly SqlDraft[] {
  return snapshot.drafts;
}

let fallbackId = 0;

export function createSqlDraft(connectionId: string | null): SqlDraft {
  if (snapshot.drafts.length >= MAX_DRAFTS) {
    throw new Error("查询草稿已达到 50 个，请先清理不再需要的草稿。");
  }
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${++fallbackId}-${Math.random().toString(36).slice(2)}`;
  const usedTitles = new Set(snapshot.drafts.map((draft) => draft.title));
  let number = 1;
  while (usedTitles.has(`Query ${number}`)) number++;
  const draft = {
    id: `${SQL_PANEL_PREFIX}${uuid}`,
    title: `Query ${number}`,
    sql: "",
    connectionId,
  };
  changeDrafts([...snapshot.drafts, draft]);
  return draft;
}

export function updateSqlDraftSql(id: string, sql: string): void {
  if (getSqlDraft(id)?.sql === sql) return;
  changeDrafts(snapshot.drafts.map((draft) => draft.id === id ? { ...draft, sql } : draft));
}

export function renameSqlDraft(id: string, title: string): void {
  const next = title.trim().slice(0, 100);
  if (!next || getSqlDraft(id)?.title === next) return;
  changeDrafts(snapshot.drafts.map((draft) => draft.id === id ? { ...draft, title: next } : draft));
}

export function setSqlDraftConnection(id: string, connectionId: string | null): void {
  if (getSqlDraft(id)?.connectionId === connectionId) return;
  changeDrafts(snapshot.drafts.map((draft) => draft.id === id
    ? { ...draft, connectionId } : draft));
}

export function forgetSqlDraft(id: string): void {
  if (!getSqlDraft(id)) return;
  changeDrafts(snapshot.drafts.filter((draft) => draft.id !== id));
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
}
