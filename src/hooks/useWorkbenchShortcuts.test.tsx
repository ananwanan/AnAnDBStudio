
/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DockApi } from "@/lib/dock-layout";
import { useWorkbenchShortcuts } from "./useWorkbenchShortcuts";

function mockDockApi() {
    const next = vi.fn();
    const previous = vi.fn();
    const remove = vi.fn();

    const api = {
        activateNext: next,
        activatePrevious: previous,
        removePanel: remove,
        activePanel: { id: "welcome" },
    } as unknown as DockApi;

    return { api, next, previous, remove };
}

afterEach(cleanup);

describe("workbench keyboard shortcuts", () => {
    it("switches to the next panel", () => {
        const { api, next } = mockDockApi();
        renderHook(() => useWorkbenchShortcuts(api));

        fireEvent.keyDown(window, {
            key: "Tab",
            ctrlKey: true,
        });

        expect(next).toHaveBeenCalledWith({
            includePanel: true,
        });
    });

    it("switches to the previous panel", () => {
        const { api, previous } = mockDockApi();
        renderHook(() => useWorkbenchShortcuts(api));

        fireEvent.keyDown(window, {
            key: "Tab",
            ctrlKey: true,
            shiftKey: true,
        });

        expect(previous).toHaveBeenCalledWith({
            includePanel: true,
        });
    });

    it("closes the active panel", () => {
        const { api, remove } = mockDockApi();
        renderHook(() => useWorkbenchShortcuts(api));

        fireEvent.keyDown(window, {
            key: "w",
            ctrlKey: true,
        });

        expect(remove).toHaveBeenCalledTimes(1);
    });

    it("does not intercept typing targets", () => {
        const { api, remove } = mockDockApi();
        renderHook(() => useWorkbenchShortcuts(api));

        const input = document.createElement("input");
        document.body.appendChild(input);

        try {
            fireEvent.keyDown(input, {
                key: "w",
                ctrlKey: true,
            });

            expect(remove).not.toHaveBeenCalled();
        } finally {
            input.remove();
        }
    });

    it("ignores shortcuts while no Dockview API exists", () => {
        renderHook(() => useWorkbenchShortcuts(null));

        expect(() => {
            fireEvent.keyDown(window, {
                key: "Tab",
                ctrlKey: true,
            });
        }).not.toThrow();
    });
});
