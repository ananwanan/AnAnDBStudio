import { describe, expect, it } from "vitest";
import { decodeResultInfo, decodeResultPage, type BrowseRow } from "./browse-protocol";
import { clipboardCell, displayCell, serializeSelection } from "@/components/data-browser/selection";

const row: BrowseRow = [
  { type: "null" },
  { type: "text", value: "" },
  { type: "integer", value: "-9223372036854775808" },
  { type: "integer", value: "9223372036854775807" },
  { type: "real", value: "5e-324" },
  { type: "blob", value: "00ff" },
  { type: "textBytes", value: "ff" },
  { type: "text", value: "猫,\t\"😀\n" },
];

describe("SQLite result values", () => {
  it("decodes typed cells and column positions without converting integers to numbers", () => {
    expect(decodeResultInfo({ id: "42", columns: ["same", "same"], maxPageSize: 100, rowCount: 1000000 }).columns).toEqual(["same", "same"]);
    expect(decodeResultPage({ end: true, rows: [row] }).rows[0]).toEqual(row);
    expect(row.map(displayCell)).toEqual([
      "NULL", '""', "-9223372036854775808", "9223372036854775807", "5e-324",
      "BLOB · 2 B", "TEXT · 0xff", '猫,\t"😀\n',
    ]);
    expect(clipboardCell(row[3])).toBe("9223372036854775807");
    expect(clipboardCell(row[7])).toBe('猫,\t"😀\n');
  });

  it("rejects invalid wire values and displays only bounded binary previews", () => {
    const invalid = [
      { type: "integer", value: "9223372036854775808" },
      { type: "integer", value: "-9223372036854775809" },
      { type: "integer", value: 42 },
      { type: "blob", value: "abc" },
      { type: "textPreview", value: "text", bytes: 4 },
    ];
    for (const cell of invalid) expect(() => decodeResultPage({ end: true, rows: [[cell]] })).toThrow();
    const preview = { type: "blobPreview", bytes: 120000, value: "00".repeat(120), } as const;
    expect(displayCell(preview)).toBe("BLOB · 120000 B");
    expect(decodeResultPage({ end: true, rows: [[preview]] }).rows[0][0]).toEqual(preview);
    expect(() => serializeSelection([[preview]], "\t")).toThrow("超出传输上限");
  });

  it("escapes tabs, commas, quotes and multiline text without losing int64 digits", () => {
    expect(serializeSelection([row], "\t")).toBe("NULL\t\"\"\t-9223372036854775808\t9223372036854775807\t5e-324\tX'00ff'\tCAST(X'ff' AS TEXT)\t\"猫,\t\"\"😀\n\"");
    expect(serializeSelection([[row[0], row[1], row[7]], [{ type: "text", value: "NULL" }]], ","))
      .toBe('NULL,"","猫,\t""😀\n"\r\n"NULL"');
  });
});
