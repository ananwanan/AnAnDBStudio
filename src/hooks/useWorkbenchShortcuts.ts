
import { useEffect } from "react";
import type { DockApi } from "@/lib/dock-layout";
import { closeActiveWorkbenchPanel } from "@/lib/workbench-panels";

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
        return false;
    }

    return target.closest(
        'input, textarea, select, [contenteditable], [role="textbox"]',
    ) !== null;
}

export function useWorkbenchShortcuts(api: DockApi | null) {
    useEffect(() => {
        if (!api) return;

        function onKeyDown(event: KeyboardEvent) {
            if (
                event.defaultPrevented ||
                event.isComposing ||
                event.repeat ||
                !event.ctrlKey ||
                event.altKey ||
                event.metaKey
            ) {
                return;
            }

            // Do not take shortcuts away from text editors.
            if (isEditableTarget(event.target)) {
                return;
            }

            const key = event.key.toLowerCase();

            if (key === "tab") {
                event.preventDefault();

                if (event.shiftKey) {
                    api!.activatePrevious({ includePanel: true });
                } else {
                    api!.activateNext({ includePanel: true });
                }

                return;
            }

            if (key === "w" && !event.shiftKey) {
                event.preventDefault();
                closeActiveWorkbenchPanel(api!);
            }
        }

        window.addEventListener("keydown", onKeyDown);

        return () => {
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [api]);
}
