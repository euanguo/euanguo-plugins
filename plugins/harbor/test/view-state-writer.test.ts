import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, describe, it } from "node:test";
import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  VIEW_STATE_STORAGE_KEY,
  type ViewStateStorage,
} from "../lib/ui/view-state.ts";

// The hook uses the source-tree alias; these tests execute the hook itself.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const root = new URL("..", import.meta.url).href;
    const candidates = [
      `${root}${specifier.slice(2)}`,
      `${root}${specifier.slice(2)}.ts`,
      `${root}${specifier.slice(2)}.tsx`,
    ];
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        return nextResolve(candidate, context);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  },
});

const { useInboxViewState } = await import("../hooks/use-inbox-view-state.ts");

const globals = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
  document?: Document;
  window?: unknown;
};
globals.IS_REACT_ACT_ENVIRONMENT = true;

function fakeStorage(): ViewStateStorage & { writes: number; value: string | null } {
  const store = {
    writes: 0,
    value: null as string | null,
    getItem() {
      return store.value;
    },
    setItem(_key: string, value: string) {
      store.writes += 1;
      store.value = value;
    },
  };
  return store;
}

function fakeDocument(): Document {
  const element = (): HTMLElement => {
    const children: Node[] = [];
    const node = {
      nodeType: 1,
      children,
      tagName: "div",
      ownerDocument: document as unknown as Document,
      style: {},
      appendChild(child: Node) {
        children.push(child);
        return child;
      },
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {},
      removeAttribute() {},
    };
    return node as unknown as HTMLElement;
  };
  const document = {
    createElement: element,
    body: null,
    addEventListener() {},
    removeEventListener() {},
    activeElement: null,
    HTMLIFrameElement: class {},
    defaultView: {
      HTMLIFrameElement: class {},
    },
    createTextNode(text: string) {
      return { nodeType: 3, textContent: text } as unknown as Text;
    },
  } as unknown as Document;
  document.body = document.createElement("body");
  return document;
}

function decodeStore(store: { value: string | null }): Record<string, unknown> {
  assert.ok(store.value);
  return JSON.parse(store.value) as Record<string, unknown>;
}

describe("view state writer", () => {
  const previousDocument: Document | undefined = globals.document;
  const previousWindow: unknown = globals.window;
  let storage: ReturnType<typeof fakeStorage>;
  let root: ReturnType<typeof createRoot> | null = null;
  let container: HTMLElement | null = null;
  let viewState: ReturnType<typeof useInboxViewState> | null = null;

  async function renderHook() {
    storage = fakeStorage();
    globals.window = { localStorage: storage };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const Probe = () => {
      viewState = useInboxViewState();
      return null;
    };
    await act(async () => {
      root?.render(createElement(Probe));
    });
    assert.ok(viewState);
  }

  afterEach(() => {
    if (root !== null) {
      act(() => {
        root?.unmount();
      });
    }
    globals.document = previousDocument;
    globals.window = previousWindow;
    root = null;
    container = null;
    viewState = null;
  });

  it("writes once for one patch", async () => {
    globalThis.document = fakeDocument();
    await renderHook();
    const writesBefore = storage.writes;

    await act(async () => {
      viewState?.patch({ filter: "working" });
    });

    assert.equal(storage.writes - writesBefore, 1);
    assert.deepEqual(decodeStore(storage).filter, "working");
  });

  it("makes the second patch in a tick see the first result", async () => {
    globalThis.document = fakeDocument();
    await renderHook();

    await act(async () => {
      viewState?.patch({ collapsedGroups: ["grp_one"] });
      viewState?.patch({ collapsedProjects: ["proj_one"] });
    });

    assert.equal(storage.writes, 2);
    const written = decodeStore(storage);
    assert.deepEqual(written.collapsedGroups, ["grp_one"]);
    assert.deepEqual(written.collapsedProjects, ["proj_one"]);
    assert.deepEqual(viewState?.state.collapsedGroups, ["grp_one"]);
  });

  it("makes two setter calls in one tick compose", async () => {
    globalThis.document = fakeDocument();
    await renderHook();

    await act(async () => {
      viewState?.api.setFamilyOverride("thread_one", true);
      viewState?.api.setFamilyOverride("thread_one", false);
    });

    const written = decodeStore(storage);
    assert.deepEqual(written.expandedFamilies, []);
    assert.deepEqual(written.collapsedFamilies, ["thread_one"]);
    assert.equal(viewState?.api.familyOverride("thread_one"), false);
  });

  it("keeps the storage key contract", () => {
    assert.equal(VIEW_STATE_STORAGE_KEY, "bb.harbor.view-state.v2");
  });
});
