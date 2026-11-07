
import { invokeIpc, IpcError } from "./ipc";

export const IPC_PROTOCOL_VERSION = 1;

export interface AppInfo {
  readonly appName: string;
  readonly version: string;
  readonly protocolVersion: number;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export async function getAppInfo(): Promise<AppInfo> {
  const response = await invokeIpc<unknown>("get_app_info");

  if (
    !isRecord(response) ||
    typeof response.appName !== "string" ||
    typeof response.version !== "string" ||
    typeof response.protocolVersion !== "number" ||
    !Number.isInteger(response.protocolVersion)
  ) {
    throw new IpcError(
      "INVALID_RESPONSE",
      "Invalid get_app_info IPC response",
    );
  }

  if (response.protocolVersion !== IPC_PROTOCOL_VERSION) {
    throw new IpcError(
      "PROTOCOL_MISMATCH",
      "Unsupported IPC protocol version",
    );
  }

  return {
    appName: response.appName,
    version: response.version,
    protocolVersion: response.protocolVersion,
  };
}

export async function checkIpcProtocol(
  protocolVersion: number = IPC_PROTOCOL_VERSION,
): Promise<void> {
  await invokeIpc<void>("check_ipc_protocol", {
    protocolVersion,
  });
}
