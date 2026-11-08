/**
 * @vitest-environment jsdom
 */

import { isTauri } from "@tauri-apps/api/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAppInfo } from "@/services/app-info";
import { StatusBar } from "./StatusBar";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(),
}));

vi.mock("@/services/app-info", () => ({
  getAppInfo: vi.fn(),
}));

const isTauriMock = vi.mocked(isTauri);
const getAppInfoMock = vi.mocked(getAppInfo);

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(cleanup);

describe("StatusBar IPC indicator", () => {
  it("does not invoke the backend in a browser preview", () => {
    isTauriMock.mockReturnValue(false);
    render(<StatusBar />);

    expect(screen.getByRole("status").textContent).toContain("IPC unavailable");
    expect(getAppInfoMock).not.toHaveBeenCalled();
  });

  it("shows the protocol after a successful typed IPC call", async () => {
    isTauriMock.mockReturnValue(true);
    getAppInfoMock.mockResolvedValue({
      appName: "AnAnDB Studio",
      version: "0.1.0",
      protocolVersion: 1,
    });
    render(<StatusBar />);

    expect(await screen.findByText("Rust IPC connected · protocol 1")).toBeTruthy();
    expect(getAppInfoMock).toHaveBeenCalledTimes(1);
  });

  it("shows a bounded error state when the IPC call fails", async () => {
    isTauriMock.mockReturnValue(true);
    getAppInfoMock.mockRejectedValue(new Error("Backend unavailable"));
    render(<StatusBar />);

    expect(await screen.findByText("Rust IPC check failed")).toBeTruthy();
  });
});
