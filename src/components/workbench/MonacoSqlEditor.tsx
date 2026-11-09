import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { useTheme } from "@/components/theme-provider";

type MonacoHost = typeof globalThis & {
  MonacoEnvironment?: { getWorker: (_moduleId: string, _label: string) => Worker };
};

// Bundle the worker with Vite. No CDN or remote code is required by the WebView.
const host = globalThis as MonacoHost;
host.MonacoEnvironment ??= { getWorker: () => new EditorWorker() };

interface MonacoSqlEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

export function MonacoSqlEditor({ id, value, onChange }: MonacoSqlEditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const model = useRef<monaco.editor.ITextModel | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const { theme } = useTheme();

  useEffect(() => {
    if (!container.current) return;
    const uri = monaco.Uri.parse(`inmemory://anandb/${encodeURIComponent(id)}.sql`);
    const textModel = monaco.editor.createModel(value, "sql", uri);
    model.current = textModel;
    const instance = monaco.editor.create(container.current, {
      model: textModel,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: "on",
      renderWhitespace: "selection",
      fixedOverflowWidgets: true,
      accessibilitySupport: "auto",
    });
    editor.current = instance;
    const subscription = instance.onDidChangeModelContent(() => {
      onChangeRef.current(textModel.getValue());
    });
    return () => {
      subscription.dispose();
      instance.dispose();
      textModel.dispose();
      editor.current = null;
      model.current = null;
    };
    // A Dockview panel has a stable document id for its whole lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (model.current && model.current.getValue() !== value) {
      model.current.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      monaco.editor.setTheme(
        theme === "dark" || (theme === "system" && media.matches) ? "vs-dark" : "vs",
      );
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  return <div ref={container} aria-label="SQL 代码编辑器" className="h-full min-h-0 w-full" />;
}
