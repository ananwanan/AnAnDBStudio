import { useSyncExternalStore } from "react";
import type { SqliteConnectionInfo, SqliteSchemaSnapshot } from "@/services/ipc-contract";
import {
  closeSqliteConnection,
  listSqliteConnections,
  openSqliteConnection,
} from "@/services/sqlite-connections";
import { getSqliteSchema } from "@/services/sqlite-schema";

export type SchemaState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: SqliteSchemaSnapshot }
  | { readonly status: "error"; readonly message: string };

export interface WorkspaceState {
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly connections: readonly SqliteConnectionInfo[];
  readonly selectedId: string | null;
  readonly schemas: Readonly<Record<string, SchemaState>>;
  readonly error: string | null;
  readonly closingIds: readonly string[];
}

const INITIAL: WorkspaceState = {
  initialized: false,
  loading: false,
  connections: [],
  selectedId: null,
  schemas: {},
  error: null,
  closingIds: [],
};

let state: WorkspaceState = INITIAL;
const listeners = new Set<() => void>();
const schemaVersions = new Map<string, number>();
let initialization: Promise<void> | null = null;

function publish(next: WorkspaceState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function patch(change: Partial<WorkspaceState>): void {
  publish({ ...state, ...change });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "数据库操作失败，请检查文件和连接状态。";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): WorkspaceState {
  return state;
}

export function useSqliteWorkspace(): WorkspaceState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Backend handles never persist across application restarts. */
export function initializeSqliteWorkspace(): Promise<void> {
  if (initialization) return initialization;
  if (state.initialized) return Promise.resolve();

  patch({ loading: true, error: null });
  initialization = (async () => {
    try {
      const connections = await listSqliteConnections();
      patch({
        connections,
        selectedId: connections[0]?.id ?? null,
        initialized: true,
        schemas: {},
      });
      if (connections[0]) void refreshSqliteSchema(connections[0].id);
    } catch (error) {
      patch({ error: describeError(error) });
    } finally {
      patch({ loading: false });
      initialization = null;
    }
  })();
  return initialization;
}

export function selectSqliteConnection(id: string): void {
  if (!state.connections.some((connection) => connection.id === id)) return;
  patch({ selectedId: id, error: null });
  if (!state.schemas[id]) void refreshSqliteSchema(id);
}

export async function addSqliteConnection(path: string, readOnly: boolean): Promise<void> {
  if (!path.trim()) throw new Error("请选择 SQLite 数据库文件。");
  if (!state.initialized) {
    await initializeSqliteWorkspace();
    if (!state.initialized) throw new Error(state.error ?? "无法初始化 SQLite 连接管理。");
  }
  try {
    const connection = await openSqliteConnection(path, readOnly);
    patch({
      connections: [...state.connections, connection],
      selectedId: connection.id,
      error: null,
    });
    void refreshSqliteSchema(connection.id);
  } catch (error) {
    patch({ error: describeError(error) });
    throw error;
  }
}

export async function removeSqliteConnection(id: string): Promise<void> {
  if (state.closingIds.includes(id)) return;
  if (!state.connections.some((connection) => connection.id === id)) return;
  patch({ closingIds: [...state.closingIds, id], error: null });
  try {
    await closeSqliteConnection(id);
    const remaining = state.connections.filter((connection) => connection.id !== id);
    const schemas = { ...state.schemas };
    delete schemas[id];
    schemaVersions.delete(id);
    patch({
      connections: remaining,
      schemas,
      selectedId: state.selectedId === id ? (remaining[0]?.id ?? null) : state.selectedId,
    });
  } catch (error) {
    // The backend removes a handle before closing it. A close error may
    // therefore still mean the handle no longer exists; re-sync from Rust.
    try {
      const connections = await listSqliteConnections();
      const live = new Set(connections.map((connection) => connection.id));
      const schemas = Object.fromEntries(
        Object.entries(state.schemas).filter(([connectionId]) => live.has(connectionId)),
      );
      if (!live.has(id)) schemaVersions.delete(id);
      patch({
        connections,
        schemas,
        selectedId: state.selectedId && live.has(state.selectedId)
          ? state.selectedId : (connections[0]?.id ?? null),
      });
    } catch {
      // Keep the connection visible for retry when the registry is unavailable.
    }
    patch({ error: describeError(error) });
    throw error;
  } finally {
    patch({ closingIds: state.closingIds.filter((value) => value !== id) });
  }
}

export async function refreshSqliteSchema(id: string): Promise<void> {
  if (!state.connections.some((connection) => connection.id === id)) return;
  if (state.closingIds.includes(id)) return;
  const version = (schemaVersions.get(id) ?? 0) + 1;
  schemaVersions.set(id, version);
  patch({ schemas: { ...state.schemas, [id]: { status: "loading" } } });
  try {
    const snapshot = await getSqliteSchema(id);
    if (schemaVersions.get(id) !== version ||
      !state.connections.some((connection) => connection.id === id) ||
      state.closingIds.includes(id)) return;
    patch({ schemas: { ...state.schemas, [id]: { status: "ready", snapshot } } });
  } catch (error) {
    if (schemaVersions.get(id) !== version ||
      !state.connections.some((connection) => connection.id === id) ||
      state.closingIds.includes(id)) return;
    patch({
      schemas: {
        ...state.schemas,
        [id]: { status: "error", message: describeError(error) },
      },
    });
  }
}

export function dismissSqliteError(): void {
  patch({ error: null });
}
