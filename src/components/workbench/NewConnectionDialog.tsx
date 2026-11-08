import { useEffect, useRef, useState, type FormEvent } from "react";
import { FolderOpen, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chooseSqliteFile } from "@/services/sqlite-file-picker";
import { addSqliteConnection } from "@/stores/sqlite-workspace";

interface NewConnectionDialogProps {
  onClose: () => void;
}

export function NewConnectionDialog({ onClose }: NewConnectionDialogProps) {
  const [path, setPath] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, pending]);

  async function browse() {
    setError(null);
    try {
      const selected = await chooseSqliteFile();
      if (selected !== null) setPath(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法打开文件选择器。");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!path.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await addSqliteConnection(path.trim(), readOnly);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "数据库连接失败。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sqlite-connect-title"
        className="w-full max-w-xl rounded-lg border bg-card p-5 text-card-foreground shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="sqlite-connect-title" className="text-base font-semibold">连接 SQLite 数据库</h2>
          <Button variant="ghost" size="icon" aria-label="关闭连接窗口" disabled={pending} onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="sqlite-database-path" className="mb-2 block text-sm font-medium">现有数据库文件</label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              id="sqlite-database-path"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              type="text"
              value={path}
              disabled={pending}
              placeholder="选择或输入 .sqlite / .db 文件路径"
              onChange={(event) => setPath(event.target.value)}
              required
            />
            <Button type="button" variant="outline" disabled={pending} onClick={() => void browse()}>
              <FolderOpen className="size-4" /> 浏览
            </Button>
          </div>
          <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={readOnly} disabled={pending} onChange={(event) => setReadOnly(event.target.checked)} />
            只读模式（推荐，防止误修改）
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            仅连接已存在的 SQLite 文件，不创建或修改数据库结构。
          </p>
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>取消</Button>
            <Button type="submit" disabled={pending || !path.trim()}>
              {pending && <LoaderCircle className="size-4 animate-spin" />}
              连接
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
