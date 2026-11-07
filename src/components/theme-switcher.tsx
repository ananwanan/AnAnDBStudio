
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import type { Theme } from "@/lib/theme";

const themes: { value: Theme; label: string }[] = [
    { value: "light", label: "浅色" },
    { value: "dark", label: "深色" },
    { value: "system", label: "跟随系统" },
];

export function ThemeSwitcher() {
    const { theme, setTheme } = useTheme();

    return (
        <div className="flex gap-2" role="group" aria-label="界面主题">
            {themes.map(({ value, label }) => (
                <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={theme === value ? "default" : "outline"}
                    aria-pressed={theme === value}
                    onClick={() => setTheme(value)}
                >
                    {label}
                </Button>
            ))}
        </div>
    );
}
