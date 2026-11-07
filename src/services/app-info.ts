import { invoke } from "@tauri-apps/api/core";

export const IPC_PROTOCOL_VERSION = 1;

export interface AppInfo {
  readonly appName: string;
  readonly version: string;
  readonly protocolVersion: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Only this adapter knows the Tauri command name and wire response shape.
 * Rust responses are untrusted at runtime even when invoke<T> is used.
 */
export async function getAppInfo(): Promise<AppInfo> {
  const response: unknown = await invoke("get_app_info");

  if (
    !isRecord(response) ||
    typeof response.appName !== "string" ||
    typeof response.version !== "string" ||
    typeof response.protocolVersion !== "number" ||
    !Number.isInteger(response.protocolVersion)
  ) {
    throw new Error("Invalid get_app_info IPC response");
  }

  if (response.protocolVersion !== IPC_PROTOCOL_VERSION) {
    throw new Error("Unsupported IPC protocol version");
  }

  return {
    appName: response.appName,
    version: response.version,
    protocolVersion: response.protocolVersion,
  };
}
