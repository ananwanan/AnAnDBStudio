import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAppInfo } from "./app-info";

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

  it("propagates transport errors", async () => {
    invokeMock.mockRejectedValue(new Error("Transport unavailable"));
    await expect(getAppInfo()).rejects.toThrow("Transport unavailable");
  });
});
