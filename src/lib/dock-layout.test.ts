/**
 * @vitest-environment jsdom
 */

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import {
    LAYOUT_STORAGE_KEY,
    loadSavedLayout,
    resetLayout,
    restoreLayout,
    saveLayout,
    subscribeLayoutPersistence,
    type DockApi,
} from "./dock-layout";

function createMockApi() {
    const panels: { id: string }[] = [];
    const listeners = new Set<() => void>();
    const savedLayout = { fixture: "layout" };

    const mock = {
        panels,
        toJSON: vi.fn(() => savedLayout),
        addPanel: vi.fn(({ id }: { id: string }) => {
            panels.push({ id });
        }),
        clear: vi.fn(() => {
            panels.splice(0);
        }),
        fromJSON: vi.fn(() => {
            panels.push({ id: "explorer" });
        }),
        onDidLayoutChange: vi.fn((listener: () => void) => {
            listeners.add(listener);

            return {
                dispose: () => listeners.delete(listener),
            };
        }),
    };

    return {
        api: mock as unknown as DockApi,
        mock,
        emitLayoutChange: () => {
            for (const listener of listeners) {
                listener();
            }
        },
    };
}

beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("Dockview layout persistence", () => {
    it("returns null when no layout is saved", () => {
        expect(loadSavedLayout()).toBeNull();
    });

    it("saves and loads a versioned layout", () => {
        const { api } = createMockApi();

        saveLayout(api);

        expect(loadSavedLayout()).toEqual({
            fixture: "layout",
        });

        const raw = localStorage.getItem(
            LAYOUT_STORAGE_KEY,
        );

        expect(JSON.parse(raw!)).toMatchObject({
            version: 1,
        });
    });

    it("clears corrupted JSON", () => {
        localStorage.setItem(
            LAYOUT_STORAGE_KEY,
            "{broken",
        );

        expect(loadSavedLayout()).toBeNull();

        expect(
            localStorage.getItem(LAYOUT_STORAGE_KEY),
        ).toBeNull();
    });

    it("rejects unsupported layout versions", () => {
        localStorage.setItem(
            LAYOUT_STORAGE_KEY,
            JSON.stringify({
                version: 999,
                layout: {},
            }),
        );

        expect(loadSavedLayout()).toBeNull();
    });

    it("creates default panels when nothing is saved", () => {
        const { api, mock } = createMockApi();

        restoreLayout(api);

        expect(mock.addPanel).toHaveBeenCalledTimes(3);

        expect(mock.panels.map((p) => p.id)).toEqual([
            "explorer",
            "welcome",
            "results",
        ]);
    });

    it("restores a previously saved layout", () => {
        const { api, mock } = createMockApi();

        saveLayout(api);
        restoreLayout(api);

        expect(mock.fromJSON).toHaveBeenCalledTimes(1);
        expect(mock.addPanel).not.toHaveBeenCalled();
    });

    it("recovers when Dockview rejects a saved layout", () => {
        const { api, mock } = createMockApi();

        saveLayout(api);

        mock.fromJSON.mockImplementationOnce(() => {
            throw new Error("Invalid layout");
        });

        restoreLayout(api);

        expect(mock.clear).toHaveBeenCalledTimes(1);
        expect(mock.addPanel).toHaveBeenCalledTimes(3);

        expect(
            localStorage.getItem(LAYOUT_STORAGE_KEY),
        ).toBeNull();
    });

    it("resets layout and persists the default", () => {
        const { api, mock } = createMockApi();

        resetLayout(api);

        expect(mock.clear).toHaveBeenCalled();
        expect(mock.addPanel).toHaveBeenCalledTimes(3);
        expect(loadSavedLayout()).not.toBeNull();
    });

    it("debounces repeated layout changes", () => {
        const { api, mock, emitLayoutChange } =
            createMockApi();

        const dispose = subscribeLayoutPersistence(api);

        emitLayoutChange();
        vi.advanceTimersByTime(200);
        emitLayoutChange();

        vi.advanceTimersByTime(349);

        expect(mock.toJSON).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);

        expect(mock.toJSON).toHaveBeenCalledTimes(1);

        dispose();
    });

    it("flushes pending changes on pagehide", () => {
        const { api, mock, emitLayoutChange } =
            createMockApi();

        const dispose = subscribeLayoutPersistence(api);

        emitLayoutChange();

        window.dispatchEvent(new Event("pagehide"));

        expect(mock.toJSON).toHaveBeenCalledTimes(1);
        expect(loadSavedLayout()).not.toBeNull();

        vi.advanceTimersByTime(500);

        expect(mock.toJSON).toHaveBeenCalledTimes(1);

        dispose();
    });
});
