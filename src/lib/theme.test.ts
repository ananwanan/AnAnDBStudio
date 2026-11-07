
import { describe, expect, it } from "vitest";
import { parseTheme, resolveTheme } from "./theme";

describe("theme preferences", () => {
    it("accepts supported themes", () => {
        expect(parseTheme("light")).toBe("light");
        expect(parseTheme("dark")).toBe("dark");
        expect(parseTheme("system")).toBe("system");
    });

    it("falls back to system for invalid values", () => {
        expect(parseTheme(null)).toBe("system");
        expect(parseTheme("invalid")).toBe("system");
    });

    it("resolves system light and dark", () => {
        expect(resolveTheme("system", false)).toBe("light");
        expect(resolveTheme("system", true)).toBe("dark");
    });

    it("respects explicit choices", () => {
        expect(resolveTheme("light", true)).toBe("light");
        expect(resolveTheme("dark", false)).toBe("dark");
    });
});
