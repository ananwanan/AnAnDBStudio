import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkIpcProtocol, getAppInfo } from "./app-info";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("getAppInfo", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes the registered Tauri command and returns a validated response", async () => {
    invokeMock.mockResolvedValue({
      appName: "AnAnDB Studio",
      version: "0.1.0",
      protocolVersion: 1,
    });

    await expect(getAppInfo()).resolves.toEqual({
      appName: "AnAnDB Studio",
      version: "0.1.0",
      protocolVersion: 1,
    });
    expect(invokeMock).toHaveBeenCalledWith("get_app_info");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it.each([null, [], {}, { appName: "AnAnDB Studio", version: 1, protocolVersion: 1 }])(
    "rejects an invalid IPC response: %j",
    async (response) => {
      invokeMock.mockResolvedValue(response);
      await expect(getAppInfo()).rejects.toThrow("Invalid get_app_info IPC response");
    },
  );

  it("rejects unsupported protocol versions", async () => {
    invokeMock.mockResolvedValue({
      appName: "AnAnDB Studio",
      version: "0.1.0",
      protocolVersion: 2,
    });

    await expect(getAppInfo()).rejects.toThrow("Unsupported IPC protocol version");
  });

  it("normalizes transport errors", async () => {
    invokeMock.mockRejectedValue(new Error("Transport unavailable"));

    await expect(getAppInfo()).rejects.toMatchObject({
      code: "TRANSPORT_ERROR",
      message: "Cannot communicate with Rust backend",
    });
  });


  it("accepts a compatible IPC protocol", async () => {
    invokeMock.mockResolvedValue(undefined);

    await expect(checkIpcProtocol(1)).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith(
      "check_ipc_protocol",
      { protocolVersion: 1 },
    );
  });

  it("propagates protocol mismatch from Rust", async () => {
    invokeMock.mockRejectedValue({
      code: "PROTOCOL_MISMATCH",
      message: "Unsupported IPC protocol version",
    });

    await expect(checkIpcProtocol(999)).rejects.toMatchObject({
      code: "PROTOCOL_MISMATCH",
      message: "Unsupported IPC protocol version",
    });
  });

});
