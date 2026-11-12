import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useEditPrompt } from "@/lib/edit-lifecycle";

export function EditModal({ title, onCancel, children }: { title: string; onCancel: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (element.showModal) element.showModal();
    else element.setAttribute("open", "");
    return () => {
      if (element.close) element.close();
      else element.removeAttribute("open");
    };
  }, []);
  return <dialog ref={dialog} aria-label={title}
    className="m-auto max-h-[85vh] w-[min(44rem,calc(100%-2rem))] overflow-auto rounded-lg border bg-card p-4 text-card-foreground shadow-lg backdrop:bg-black/40"
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 className="mb-3 text-sm font-semibold">{title}</h2>
    {children}
  </dialog>;
}

export function EditLeavePrompt() {
  const prompt = useEditPrompt();
  if (!prompt) return null;
  const cancel = () => prompt.resolve("cancel");
  return <EditModal title={prompt.title} onCancel={cancel}>
    <ul className="mb-3 space-y-1 text-xs">{prompt.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
    {prompt.lines.length > 1 && <p className="mb-2 text-xs">各表依次提交，每张表使用独立事务。已提交的表会保留写入。</p>}
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="outline" autoFocus onClick={cancel}>取消</Button>
      <Button size="sm" variant="outline" disabled={!prompt.canDiscard} onClick={() => prompt.resolve("discard")}>放弃草稿</Button>
      <Button size="sm" disabled={!prompt.canSave} onClick={() => prompt.resolve("save")}>提交并继续</Button>
    </div>
  </EditModal>;
}
