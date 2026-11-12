import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { BrowseCell, ResultInfo } from "@/services/browse-protocol";
import { parseWriteValue, type ColumnValue } from "@/services/edit-protocol";
import { EditModal } from "./EditModal";
import { ValueFields, initialValue, type ValueInput } from "./ValueFields";
import { changesLabel, summarize, withChanges, type ChangeSet } from "./change-set";
import type { TableEdits } from "./use-table-edits";

const READ_ONLY = {
  connection: "只读：当前连接禁止写入。",
  identity: "只读：没有可靠的唯一行身份。",
  width: "只读：表列数达到 SQLite 上限，无法同时读取隐藏行身份。",
};

function exact(cell: BrowseCell) {
  return cell.type === "null" ? "NULL" : `${cell.type.toUpperCase()} ${JSON.stringify(cell.value)}`;
}

function identity(set: ChangeSet, row: { rowId: string | null; cells: BrowseCell[] }) {
  return row.rowId !== null ? `${set.editing.rowIdAlias} = ${row.rowId}` :
    set.editing.identityColumns.map(index => `${set.columns[index]} = ${exact(row.cells[index])}`).join(" · ");
}

function insertIdentity(set: ChangeSet, values: ColumnValue[]) {
  if (set.editing.rowIdAlias) return `${set.editing.rowIdAlias} 由 SQLite 分配`;
  return set.editing.identityColumns.map(index => {
    const assigned = values.find(value => value.column === index);
    return `${set.columns[index]} = ${assigned ? exact(assigned.value) : "DEFAULT"}`;
  }).join(" · ");
}

function InsertForm({ info, values, onSave, onCancel }: {
  info: ResultInfo;
  values: ColumnValue[];
  onSave: (values: ColumnValue[]) => void;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState(() => new Map(values.map(entry => [entry.column, initialValue(entry.value)])));
  const [error, setError] = useState("");
  return <EditModal title="新增行 · 设置值" onCancel={onCancel}>
    <form className="space-y-2 text-xs" onSubmit={event => {
      event.preventDefault();
      try {
        onSave([...fields].flatMap(([column, input]) => input.type === "default" ? [] :
          [{ column, value: parseWriteValue(input.type, input.text) }]));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "无法暂存新增行。");
      }
    }}>
      <p>DEFAULT 使用 SQLite 的列默认值。选择 NULL 可显式写入空值。</p>
      {info.columns.map((name, index) => info.editing?.writable[index] && <fieldset key={index} className="rounded border p-2">
        <legend className="break-all px-1">{name}</legend>
        <ValueFields input={fields.get(index) ?? { type: "default", text: "" }}
          label={name} allowDefault onChange={(input: ValueInput) => setFields(current => new Map(current).set(index, input))} />
      </fieldset>)}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>取消</Button>
        <Button type="submit" size="sm">暂存新增行</Button>
      </div>
    </form>
  </EditModal>;
}

export function EditControls({ info, table, edits }: { info: ResultInfo | null; table: string; edits: TableEdits }) {
  const [modal, setModal] = useState<"review" | "save" | "discard" | null>(null);
  const [insert, setInsert] = useState<string | null>(null);
  const { draft, saving, blocked, uncertain, status } = edits;
  const capable = !!info?.editing && !info.editing.readOnlyReason &&
    (!draft || info.editing.schemaVersion === draft.schemaVersion);
  const editable = capable && !saving && !blocked && !uncertain;
  const existingInsert = insert ? draft?.entries.get(insert) : undefined;
  const close = () => setModal(null);
  const count = draft?.entries.size ?? 0;
  const inserts = draft ? [...draft.entries].filter(([, change]) => change.kind === "insert") : [];
  if (!info?.editing && !draft && !status) return null;
  return <>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-2 py-1 text-xs">
      <Button size="xs" variant="outline" disabled={!editable} onClick={() => setInsert(crypto.randomUUID())}>新增行</Button>
      <Button size="xs" disabled={!draft || saving || blocked || uncertain || !!info?.editing?.readOnlyReason} onClick={() => setModal("save")}>保存修改</Button>
      <Button size="xs" variant="outline" disabled={!draft || saving} onClick={() => setModal("discard")}>放弃修改</Button>
      <Button size="xs" variant="outline" disabled={!draft} onClick={() => setModal("review")}>查看修改集</Button>
      {saving && <Button size="xs" variant="outline" onClick={() => void edits.cancel()}>取消保存</Button>}
      <span role="status">{saving ? "正在提交…" : `待提交 ${count} · ${changesLabel(draft)}`}</span>
      {info?.editing?.readOnlyReason && <span>{READ_ONLY[info.editing.readOnlyReason]}</span>}
      {draft && info?.editing && info.editing.schemaVersion !== draft.schemaVersion && <span>结构已变更，旧草稿仍保留。</span>}
    </div>
    {status && <p role={status.error ? "alert" : "status"} className={`shrink-0 border-b px-2 py-1 text-xs ${status.error ? "text-destructive" : ""}`}>{status.message}</p>}
    {inserts.length > 0 && <div className="flex max-h-20 shrink-0 flex-wrap items-center gap-1 overflow-auto border-b px-2 py-1 text-xs">
      <span>待新增行</span>
      {inserts.map(([key], index) => <Button key={key} size="xs" variant="outline" disabled={!editable} onClick={() => setInsert(key)}>＋ 新增行 {index + 1}</Button>)}
    </div>}
    {insert && info && editable && <InsertForm info={info} values={existingInsert?.kind === "insert" ? existingInsert.values : []}
      onCancel={() => setInsert(null)} onSave={values => {
        edits.change(info, set => withChanges(set, [[insert, { kind: "insert", values }]]));
        setInsert(null);
      }} />}
    {modal === "review" && draft && <EditModal title={`修改集 · main.${table}`} onCancel={close}>
      <p className="mb-2 text-xs">{changesLabel(draft)}</p>
      <ol className="space-y-2 text-xs">
        {[...draft.entries].map(([key, change], index) => <li key={key} className="rounded border p-2">
          <div className="flex items-start justify-between gap-2">
            <strong className="break-all">
              {index + 1}. {change.kind === "insert" ? `新增 · ${insertIdentity(draft, change.values)}` :
                `${change.kind === "update" ? "修改" : "删除"} · ${identity(draft, change.target)}`}
            </strong>
            <Button size="xs" variant="outline" disabled={saving || uncertain} onClick={() =>
              edits.replace(withChanges(draft, [[key, null]]))}>{change.kind === "insert" ? "取消新增" : "移除此项"}</Button>
          </div>
          <ul className="mt-1 space-y-1 break-all">
            {change.kind === "insert" && <li>省略的列使用 DEFAULT。</li>}
            {change.kind === "delete" ? change.target.cells.map((cell, column) =>
              <li key={column}>{draft.columns[column]} · <code>{exact(cell)}</code></li>) :
              change.values.map(({ column, value }) => <li key={column}>
                {draft.columns[column]} · <code>{change.kind === "update" ? `${exact(change.target.cells[column])} → ` : ""}{exact(value)}</code>
              </li>)}
          </ul>
        </li>)}
      </ol>
      <div className="mt-3 flex justify-end"><Button size="sm" variant="outline" onClick={close}>关闭</Button></div>
    </EditModal>}
    {modal === "save" && draft && <EditModal title={`提交修改 · main.${table}`} onCancel={close}>
      <p className="text-xs">{changesLabel(draft)}。提交后数据库将保存这些修改。</p>
      {summarize(draft).delete > 0 && <p className="mt-1 text-xs text-destructive">确认从 main.{table} 删除 {summarize(draft).delete} 行。</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="outline" autoFocus onClick={close}>取消</Button>
        <Button size="sm" onClick={() => { close(); void edits.save(); }}>确认提交</Button>
      </div>
    </EditModal>}
    {modal === "discard" && draft && <EditModal title={`放弃草稿 · main.${table}`} onCancel={close}>
      <p className="text-xs">移除当前修改集中的 {count} 行待提交草稿。</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="outline" autoFocus onClick={close}>取消</Button>
        <Button size="sm" onClick={() => { edits.discard(); close(); }}>确认放弃</Button>
      </div>
    </EditModal>}
  </>;
}
