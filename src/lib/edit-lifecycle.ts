import { useSyncExternalStore } from "react";

export interface EditGuard {
  id: string;
  connectionId: string;
  table: string;
  summary: () => string | null;
  saving: () => boolean;
  canSave: () => boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}

type Decision = "save" | "discard" | "cancel";
interface Prompt {
  title: string;
  lines: string[];
  canSave: boolean;
  canDiscard: boolean;
  resolve: (decision: Decision) => void;
}

const guards = new Map<string, EditGuard>();
const listeners = new Set<() => void>();
const refreshListeners = new Set<(connectionId: string, table: string) => void>();
let prompt: Prompt | null = null;
let resolving = false;

export function registerEditGuard(guard: EditGuard) {
  guards.set(guard.id, guard);
  return () => { if (guards.get(guard.id) === guard) guards.delete(guard.id); };
}

export function subscribeTableRefresh(listener: (connectionId: string, table: string) => void) {
  refreshListeners.add(listener);
  return () => { refreshListeners.delete(listener); };
}

export function refreshConnectionTables(connectionId: string, table: string) {
  refreshListeners.forEach(listener => listener(connectionId, table));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useEditPrompt() {
  return useSyncExternalStore(subscribe, () => prompt);
}

function setPrompt(next: Prompt | null) {
  prompt = next;
  listeners.forEach(listener => listener());
}

export function hasPendingEdits(include: (guard: EditGuard) => boolean = () => true) {
  return [...guards.values()].some(guard => include(guard) && (guard.saving() || guard.summary()));
}

export async function protectEdits(title: string, include: (guard: EditGuard) => boolean = () => true) {
  const relevant = [...guards.values()].filter(include);
  const dirty = relevant.filter(guard => guard.summary() || guard.saving());
  if (!dirty.length) return true;
  if (resolving) return false;
  resolving = true;
  try {
    const saving = dirty.some(guard => guard.saving());
    const decision = await new Promise<Decision>(resolve => {
      setPrompt({
        title,
        lines: dirty.map(guard => `${guard.table} — ${guard.saving() ? "正在提交，请等待结果" : guard.summary()}`),
        canSave: !saving && dirty.every(guard => guard.canSave()),
        canDiscard: !saving,
        resolve,
      });
    });
    setPrompt(null);
    if (decision === "cancel" || saving || dirty.some(guard => guard.saving())) return false;
    if (decision === "discard") {
      dirty.forEach(guard => guard.discard());
      return true;
    }
    for (const guard of dirty) {
      if (!guard.canSave() || !(await guard.save())) return false;
    }
    return !hasPendingEdits(include);
  } finally {
    resolving = false;
  }
}
