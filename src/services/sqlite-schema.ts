import { invokeIpc } from "./ipc";
import type {
    SqliteSchemaColumn,
    SqliteSchemaObject,
    SqliteSchemaObjectKind,
    SqliteSchemaSnapshot,
} from "./ipc-contract";

export type {
    SqliteSchemaColumn,
    SqliteSchemaObject,
    SqliteSchemaObjectKind,
    SqliteSchemaSnapshot,
};

export function getSqliteSchema(id: string) {
    return invokeIpc("get_sqlite_schema", { id });
}
