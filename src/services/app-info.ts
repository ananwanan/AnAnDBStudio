
import { invokeIpc } from "./ipc";
import { IPC_PROTOCOL_VERSION } from "./ipc-contract";

export { IPC_PROTOCOL_VERSION };
export type { AppInfo } from "./ipc-contract";

export function getAppInfo() {
  return invokeIpc("get_app_info");
}

export function checkIpcProtocol(
  protocolVersion: number = IPC_PROTOCOL_VERSION,
) {
  return invokeIpc("check_ipc_protocol", {
    protocolVersion,
  });
}
