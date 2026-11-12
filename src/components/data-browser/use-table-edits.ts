import { useId, useLayoutEffect, useRef, useState } from "react";
import { refreshConnectionTables, registerEditGuard } from "@/lib/edit-lifecycle";
import type { ResultInfo } from "@/services/browse-protocol";
import { cancelSqliteEdit, commitSqliteEdit, editErrorMessage, editOutcomeUnknown } from "@/services/sqlite-edits";
import { openTable, releaseResult } from "@/services/sqlite-results";
import { changesLabel, createChangeSet, type ChangeSet } from "./change-set";

export function useTableEdits(panelId: string | undefined, connectionId: string, table: string, blocked = false, showError?: () => void) {
  const fallbackId = useId();
  const [draft, setDraft] = useState<ChangeSet | null>(null);
  const current = useRef<ChangeSet | null>(null);
  const [saving, setSaving] = useState(false);
  const operation = useRef<{ id: string; controller: AbortController; submitted: boolean } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const unknown = useRef(false);
  const [status, setStatus] = useState<{ error: boolean; message: string } | null>(null);

  function replace(next: ChangeSet | null) {
    current.current = next?.entries.size ? next : null;
    setDraft(current.current);
  }

  function change(info: ResultInfo, apply: (set: ChangeSet) => ChangeSet) {
    if (blocked || operation.current || unknown.current) throw new Error("当前无法编辑此修改集。");
    const base = current.current ?? createChangeSet(info);
    if (!info.editing || info.editing.readOnlyReason || base.schemaVersion !== info.editing.schemaVersion) {
      throw new Error("表结构或写入权限已变更。请核对修改集后重新编辑。");
    }
    replace(apply(base));
  }

  function discard() {
    replace(null);
    unknown.current = false;
    setUncertain(false);
    setStatus({ error: false, message: "已放弃本地草稿。" });
  }

  async function save() {
    const batch = current.current;
    if (!batch || blocked || operation.current || unknown.current) return false;
    const active = { id: crypto.randomUUID(), controller: new AbortController(), submitted: false };
    operation.current = active;
    setSaving(true);
    setStatus(null);
    let sessionId: string | undefined;
    try {
      const info = await openTable(connectionId, { schema: "main", table, sort: null, filter: null }, active.controller.signal);
      sessionId = info.id;
      active.controller.signal.throwIfAborted();
      active.submitted = true;
      const result = await commitSqliteEdit(connectionId, sessionId, active.id, {
        schemaVersion: batch.schemaVersion, changes: [...batch.entries.values()],
      });
      replace(null);
      setStatus({ error: false, message: `已提交 · 新增 ${result.inserted} · 修改 ${result.updated} · 删除 ${result.deleted}` });
      refreshConnectionTables(connectionId, table);
      return true;
    } catch (error) {
      if (active.submitted && editOutcomeUnknown(error)) {
        unknown.current = true;
        setUncertain(true);
      }
      setStatus({ error: true, message: active.controller.signal.aborted && !active.submitted ? "已取消保存，修改集仍保留。" : editErrorMessage(error) });
      return false;
    } finally {
      if (sessionId) void releaseResult(connectionId, sessionId).catch(() => {});
      operation.current = null;
      setSaving(false);
    }
  }

  async function cancel() {
    const active = operation.current;
    if (!active) return;
    if (!active.submitted) active.controller.abort();
    else {
      try { await cancelSqliteEdit(connectionId, active.id); }
      catch { setStatus({ error: true, message: "取消请求未获确认。请等待保存结果。" }); }
    }
  }

  useLayoutEffect(() => registerEditGuard({
    id: panelId ?? fallbackId, connectionId, table: `main.${table}`,
    summary: () => current.current ? changesLabel(current.current) : null,
    saving: () => operation.current !== null,
    canSave: () => !blocked && !unknown.current && !operation.current,
    save: async () => {
      const saved = await save();
      if (!saved) showError?.();
      return saved;
    },
    discard,
  }));

  return { draft, saving, blocked, uncertain, status, change, replace, discard, save, cancel };
}

export type TableEdits = ReturnType<typeof useTableEdits>;
