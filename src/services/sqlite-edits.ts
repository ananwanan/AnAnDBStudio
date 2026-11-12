import { invokeIpc, IpcError } from "./ipc";
import { encodeEditRequest, type EditRequest } from "./edit-protocol";

export async function commitSqliteEdit(id: string, sessionId: string, operationId: string, request: EditRequest) {
  const result = await invokeIpc("commit_sqlite_edit", { id, sessionId, operationId, payload: encodeEditRequest(request), timeoutMs: 30_000 });
  const expected = { insert: 0, update: 0, delete: 0 };
  for (const change of request.changes) expected[change.kind]++;
  if (result.inserted !== expected.insert || result.updated !== expected.update || result.deleted !== expected.delete) {
    throw new IpcError("INVALID_RESPONSE", "Commit acknowledgement does not match the edit batch");
  }
  return result;
}

export function cancelSqliteEdit(id: string, operationId: string) {
  return invokeIpc("cancel_sqlite_edit", { id, operationId });
}

export function editOutcomeUnknown(error: unknown) {
  return error instanceof IpcError && ["EDIT_UNKNOWN", "INVALID_RESPONSE", "TRANSPORT_ERROR"].includes(error.code);
}

export function editErrorMessage(error: unknown) {
  if (editOutcomeUnknown(error)) return "提交结果不确定。请刷新并核对数据库，确认后再放弃草稿或重新编辑。";
  if (!(error instanceof IpcError)) return error instanceof Error ? error.message : "保存修改失败。";
  const explanations: Record<string, string> = {
    EDIT_READ_ONLY: "当前表、连接或 SQLite 日志设置不允许网格写入。",
    EDIT_TRANSACTION_OPEN: "SQL 编辑器有未结束的事务。请先在 SQL 编辑器提交或回滚。",
    EDIT_SCHEMA_CHANGED: "数据库结构已变更。请核对修改集，放弃旧草稿后重新编辑。",
    EDIT_ROW_MISSING: "目标行已经不存在，或其行身份已变更。",
    EDIT_ROW_CHANGED: "目标行已变更。请刷新并比较原值，移除冲突修改后重新编辑。",
    EDIT_AFFECTED_ROWS: "SQLite 的实际影响行数异常，整批已回滚。",
    EDIT_CONSTRAINT: "SQLite 拒绝了违反约束的修改。",
    EDIT_BUSY: "SQLite 数据库被其他操作锁定，请稍后重试。",
    CONNECTION_BUSY: "此连接正在执行其他任务，请稍后重试。",
    RESULT_CANCELLED: "保存已取消，修改集仍保留。",
    RESULT_TIMED_OUT: "保存超时，修改集仍保留。",
  };
  const explanation = explanations[error.code];
  return explanation ? `${explanation} ${error.message}` : error.message;
}
