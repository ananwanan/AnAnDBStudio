
/**
 * @vitest-environment jsdom
 */

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";

import { ThemeProvider, useTheme } from "./theme-provider";
import { THEME_STORAGE_KEY } from "../lib/theme";

type ChangeHandler = (event: MediaQueryListEvent) => void;

const handlers = new Set<ChangeHandler>();
let systemDark = false;

function TestControls() {
    const { theme, setTheme } = useTheme();

    return (
        <div>
            <span data-testid="theme">{theme}</span>
            <button onClick={() => setTheme("light")}>Light</button>
            <button onClick={() => setTheme("dark")}>Dark</button>
            <button onClick={() => setTheme("system")}>System</button>
        </div>
    );
}

function renderProvider() {
    return render(
        <ThemeProvider>
            <TestControls />
        </ThemeProvider>,
    );
}

function changeSystemTheme(dark: boolean) {
    systemDark = dark;

    act(() => {
        for (const handler of handlers) {
            handler({
                matches: dark,
                media: "(prefers-color-scheme: dark)",
            } as MediaQueryListEvent);
        }
    });
}

beforeEach(() => {
    systemDark = false;
    handlers.clear();
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";

    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: (query: string) => ({
            media: query,
            get matches() {
                return systemDark;
            },
            addEventListener: (
                type: string,
                handler: ChangeHandler,
            ) => {
                if (type === "change") handlers.add(handler);
            },
            removeEventListener: (
                type: string,
                handler: ChangeHandler,
            ) => {
                if (type === "change") handlers.delete(handler);
            },
        }),
    });
});

afterEach(() => {
    cleanup();
    handlers.clear();
});

describe("ThemeProvider", () => {
    it("defaults to system theme", () => {
        renderProvider();

        expect(screen.getByTestId("theme").textContent).toBe("system");
        expect(document.documentElement.classList.contains("light"))
            .toBe(true);
    });

    it("switches to dark and persists the preference", () => {
        renderProvider();

        fireEvent.click(screen.getByText("Dark"));

        expect(document.documentElement.classList.contains("dark"))
            .toBe(true);
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    });

    it("restores the saved theme", () => {
        localStorage.setItem(THEME_STORAGE_KEY, "dark");
        renderProvider();

        expect(screen.getByTestId("theme").textContent).toBe("dark");
        expect(document.documentElement.classList.contains("dark"))
            .toBe(true);
    });

    it("reacts to system theme changes", () => {
        renderProvider();

        changeSystemTheme(true);

        expect(document.documentElement.classList.contains("dark"))
            .toBe(true);

        changeSystemTheme(false);

        expect(document.documentElement.classList.contains("light"))
            .toBe(true);
    });

    it("ignores system changes in explicit light mode", () => {
        renderProvider();

        fireEvent.click(screen.getByText("Light"));
        changeSystemTheme(true);

        expect(document.documentElement.classList.contains("light"))
            .toBe(true);
    });
});
