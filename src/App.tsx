
import { Database, Monitor, Moon, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useTheme } from "@/components/theme-provider";
import type { Theme } from "@/lib/theme";

const themes = [
  { value: "light", label: "浅色", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
  { value: "system", label: "系统", Icon: Monitor },
] as const;

function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-1" role="group" aria-label="界面主题">
      {themes.map(({ value, label, Icon }) => (
        <Button
          key={value}
          type="button"
          variant={theme === value ? "secondary" : "ghost"}
          size="sm"
          aria-label={`${label}主题`}
          aria-pressed={theme === value}
          onClick={() => setTheme(value as Theme)}
        >
          <Icon className="size-4" aria-hidden="true" />
          <span>{label}</span>
        </Button>
      ))}
    </div>
  );
}

export default function App() {
  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-2">
          <Database className="size-5 text-primary" />
          <span className="font-semibold">AnAnDB Studio</span>
          <Badge variant="secondary">M0.3</Badge>
        </div>
        <ThemeSelector />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 border-r bg-muted/30 p-3">
          <div className="text-xs font-semibold tracking-wider text-muted-foreground">
            EXPLORER
          </div>
          <Separator className="my-3" />
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            暂无数据库连接
            <p className="mt-2 text-xs">
              SQLite 连接管理将在 M1 实现。
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-3xl space-y-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Welcome to AnAnDB Studio
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                A professional cross-platform database management studio.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>UI Foundation</CardTitle>
                  <CardDescription>
                    M0.3 Theme and Components
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Badge variant="outline">In development</Badge>
                  <p className="text-sm text-muted-foreground">
                    Tailwind CSS, shadcn/ui and theme persistence.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Database Engine</CardTitle>
                  <CardDescription>
                    SQLite 3
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Database connections and schema browsing
                    are planned for M1.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
      </div>

      <footer className="flex h-7 shrink-0 items-center justify-between border-t bg-card px-3 text-xs text-muted-foreground">
        <span>Ready</span>
        <span>AnAnDB Studio · M0.3</span>
      </footer>
    </div>
  );
}
