
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "anandb.theme";

export function parseTheme(value: string | null): Theme {
    if (value === "light" || value === "dark") {
        return value;
    }
    return "system";
}

export function resolveTheme(
    theme: Theme,
    systemIsDark: boolean,
): ResolvedTheme {
    if (theme === "system") {
        return systemIsDark ? "dark" : "light";
    }
    return theme;
}
