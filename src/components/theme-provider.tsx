
import {
    createContext,
    useContext,
    useLayoutEffect,
    useState,
    type ReactNode,
} from "react";
import {
    parseTheme,
    resolveTheme,
    THEME_STORAGE_KEY,
    type Theme,
} from "@/lib/theme";

interface ThemeContextValue {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function loadTheme(): Theme {
    try {
        return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
        return "system";
    }
}

export function ThemeProvider({
    children,
}: {
    children: ReactNode;
}) {
    const [theme, setThemeState] = useState<Theme>(loadTheme);

    useLayoutEffect(() => {
        const root = document.documentElement;
        const media = window.matchMedia("(prefers-color-scheme: dark)");

        const applyTheme = () => {
            const resolved = resolveTheme(theme, media.matches);

            root.classList.toggle("dark", resolved === "dark");
            root.classList.toggle("light", resolved === "light");
            root.style.colorScheme = resolved;
        };

        applyTheme();

        if (theme === "system") {
            media.addEventListener("change", applyTheme);
            return () => media.removeEventListener("change", applyTheme);
        }
    }, [theme]);

    function setTheme(nextTheme: Theme) {
        setThemeState(nextTheme);
        try {
            localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        } catch {
            // The selected theme remains active for this session.
        }
    }

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme(): ThemeContextValue {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error("useTheme requires ThemeProvider");
    }
    return context;
}
