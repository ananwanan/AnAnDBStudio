// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { NewConnectionDialog } from "./NewConnectionDialog";
import { chooseSqliteFile } from "@/services/sqlite-file-picker";
import { addSqliteConnection } from "@/stores/sqlite-workspace";

vi.mock("@/services/sqlite-file-picker", () => ({ chooseSqliteFile: vi.fn() }));
vi.mock("@/stores/sqlite-workspace", () => ({ addSqliteConnection: vi.fn() }));

const pick = vi.mocked(chooseSqliteFile);
const connect = vi.mocked(addSqliteConnection);

beforeEach(() => {
  vi.clearAllMocks();
  connect.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("SQLite connection dialog", () => {
  it("selects a native file, defaults to read-only, and opens the connection", async () => {
    pick.mockResolvedValueOnce("C:\\data\\sample.db");
    const onClose = vi.fn();
    render(<NewConnectionDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /浏览/ }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "现有数据库文件" })).toHaveProperty("value", "C:\\data\\sample.db"));
    fireEvent.click(screen.getByRole("button", { name: /^连接$/ }));
    await waitFor(() => expect(connect).toHaveBeenCalledWith("C:\\data\\sample.db", true));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an error and stays open on failure", async () => {
    connect.mockRejectedValueOnce(new Error("not a SQLite database"));
    const onClose = vi.fn();
    render(<NewConnectionDialog onClose={onClose} />);
    fireEvent.change(screen.getByRole("textbox", { name: "现有数据库文件" }), {
      target: { value: "/tmp/bad.db" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^连接$/ }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "not a SQLite database");
    expect(onClose).not.toHaveBeenCalled();
  });
});
