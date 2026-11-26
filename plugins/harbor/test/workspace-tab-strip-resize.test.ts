import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

// The hook uses the source-tree `@/` alias; resolve it for Node tests.
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

const { useElementWidth, useNarrowPane } = await import(
  "../hooks/use-narrow-pane.ts"
);

interface FakeElement {
  nodeType: number;
  tagName: string;
  children: FakeElement[];
  parentNode: FakeElement | null;
  style: Record<string, string>;
  attributes: Record<string, string>;
  ownerDocument: unknown;
  width: number;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getBoundingClientRect(): { width: number };
  appendChild(child: FakeElement): FakeElement;
  removeChild(child: FakeElement): FakeElement;
  insertBefore(child: FakeElement, refChild: FakeElement | null): FakeElement;
  addEventListener(): void;
  removeEventListener(): void;
}

class FakeResizeObserverHarness {
  private readonly observers = new Set<FakeResizeObserver>();

  install(): typeof ResizeObserver {
    const observers = this.observers;
    return class HarnessResizeObserver implements ResizeObserver {
      readonly callback: ResizeObserverCallback;
      readonly nodes = new Set<Element>();

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.add(this);
      }

      observe(target: Element): void {
        this.nodes.add(target);
      }

      unobserve(target: Element): void {
        this.nodes.delete(target);
      }

      disconnect(): void {
        this.nodes.clear();
        observers.delete(this);
      }
    } as unknown as typeof ResizeObserver;
  }

  trigger(node: FakeElement, width: number): number {
    node.width = width;
    let notified = 0;
    for (const observer of [...this.observers]) {
      const target = node as unknown as Element;
      if (!observer.nodes.has(target)) continue;
      notified += 1;
      observer.callback(
        [
          {
            target,
            borderBoxSize: [
              { inlineSize: width, blockSize: 36 },
            ] as unknown as readonly ResizeObserverSize[],
            contentRect: {
              width,
              height: 36,
              top: 0,
              left: 0,
              bottom: 36,
              right: width,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            },
          } as unknown as ResizeObserverEntry,
        ],
        observer as unknown as ResizeObserver,
      );
    }
    return notified;
  }

  isObserved(node: FakeElement): boolean {
    const target = node as unknown as Element;
    for (const observer of this.observers) {
      if (observer.nodes.has(target)) return true;
    }
    return false;
  }
}

interface FakeResizeObserver {
  readonly callback: ResizeObserverCallback;
  readonly nodes: Set<Element>;
}

const globals = globalThis as {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
  document?: Document;
  window?: unknown;
  ResizeObserver?: typeof ResizeObserver;
  requestAnimationFrame?: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
};

describe("useNarrowPane & useElementWidth ResizeObserver lifecycle", () => {
  const prevAct = globals.IS_REACT_ACT_ENVIRONMENT;
  const prevDocument = globals.document;
  const prevWindow = globals.window;
  const prevResizeObserver = globals.ResizeObserver;
  const prevRaf = globals.requestAnimationFrame;
  const prevCancelRaf = globals.cancelAnimationFrame;

  let harness: FakeResizeObserverHarness;
  let paneWidth = 800;
  let host: FakeElement;
  let root: ReturnType<typeof createRoot> | null = null;
  let doc: Document;
  let rafQueue: Map<number, FrameRequestCallback>;
  let nextRafId = 1;

  function makeElement(tag: string): FakeElement {
    const node: FakeElement = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      children: [],
      parentNode: null,
      style: {},
      attributes: {},
      ownerDocument: null,
      width: paneWidth,
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      removeAttribute(name) {
        delete this.attributes[name];
      },
      getBoundingClientRect() {
        return { width: this.width };
      },
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) this.children.splice(index, 1);
        child.parentNode = null;
        return child;
      },
      insertBefore(child, refChild) {
        const index = refChild ? this.children.indexOf(refChild) : -1;
        if (index >= 0) this.children.splice(index, 0, child);
        else this.children.push(child);
        child.parentNode = this;
        return child;
      },
      addEventListener() {},
      removeEventListener() {},
    };
    node.ownerDocument = doc;
    return node;
  }

  function resizeNode(node: FakeElement, width: number): number {
    if (width > 0) paneWidth = width;
    return harness.trigger(node, width);
  }

  function flushRaf(): void {
    const callbacks = [...rafQueue.values()];
    rafQueue.clear();
    for (const cb of callbacks) cb(16);
  }

  beforeEach(() => {
    paneWidth = 800;
    rafQueue = new Map();
    nextRafId = 1;
    harness = new FakeResizeObserverHarness();

    class FakeHTMLIFrameElement {}
    const fakeWindow = {
      event: undefined,
      HTMLIFrameElement: FakeHTMLIFrameElement,
    };
    doc = {
      createElement: (tag: string) =>
        makeElement(tag) as unknown as HTMLElement,
      createTextNode: (text: string) =>
        ({ nodeType: 3, textContent: text, parentNode: null }) as unknown as Text,
      addEventListener() {},
      removeEventListener() {},
      activeElement: null,
      HTMLIFrameElement: FakeHTMLIFrameElement,
      defaultView: fakeWindow,
      body: null as unknown as HTMLElement,
    } as unknown as Document;
    (doc as { body: HTMLElement }).body = makeElement(
      "body",
    ) as unknown as HTMLElement;

    globals.IS_REACT_ACT_ENVIRONMENT = true;
    globals.document = doc;
    globals.window = fakeWindow;
    globals.ResizeObserver = harness.install();
    globals.requestAnimationFrame = (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    };
    globals.cancelAnimationFrame = (id: number) => {
      rafQueue.delete(id);
    };

    host = makeElement("div");
    doc.body.appendChild(host as unknown as Node);
    root = createRoot(host as unknown as HTMLElement);
  });

  afterEach(async () => {
    if (root !== null) {
      const toUnmount = root;
      root = null;
      await act(async () => {
        toUnmount.unmount();
      });
    }
    globals.IS_REACT_ACT_ENVIRONMENT = prevAct;
    globals.document = prevDocument;
    globals.window = prevWindow;
    globals.ResizeObserver = prevResizeObserver;
    globals.requestAnimationFrame = prevRaf;
    globals.cancelAnimationFrame = prevCancelRaf;
  });

  it("collapses when right panel narrows center pane and expands back cleanly when widened", async () => {
    function PersistentStrip() {
      const { ref, narrow } = useNarrowPane();
      return createElement("div", {
        ref,
        "data-compact": narrow ? "true" : "false",
      });
    }

    await act(async () => {
      root?.render(createElement(PersistentStrip));
    });
    const strip = host.children[0];
    assert.ok(strip);
    assert.equal(strip.attributes["data-compact"], "false");
    assert.equal(harness.isObserved(strip), true);

    await act(async () => {
      assert.equal(resizeNode(strip, 480), 1);
    });
    assert.equal(strip.attributes["data-compact"], "true");

    // Inside hysteresis band (540px): remains compact.
    await act(async () => {
      assert.equal(resizeNode(strip, 540), 1);
    });
    assert.equal(strip.attributes["data-compact"], "true");

    // Right panel closed / shrunk so center pane widens to 600px: expands back.
    await act(async () => {
      assert.equal(resizeNode(strip, 600), 1);
    });
    assert.equal(strip.attributes["data-compact"], "false");

    // Repeated cycle also recovers cleanly.
    await act(async () => {
      resizeNode(strip, 450);
    });
    assert.equal(strip.attributes["data-compact"], "true");
    await act(async () => {
      resizeNode(strip, 700);
    });
    assert.equal(strip.attributes["data-compact"], "false");
  });

  it("rebinds ResizeObserver when the compact/expanded DOM element itself swaps", async () => {
    function SwappingStrip() {
      const { ref, narrow } = useNarrowPane();
      return narrow
        ? createElement("div", { key: "compact", ref, "data-compact": "true" })
        : createElement("div", { key: "expanded", ref, "data-compact": "false" });
    }

    await act(async () => {
      root?.render(createElement(SwappingStrip));
    });
    const nodeA = host.children[0];
    assert.ok(nodeA);
    assert.equal(nodeA.attributes["data-compact"], "false");
    assert.equal(harness.isObserved(nodeA), true);

    await act(async () => {
      resizeNode(nodeA, 480);
    });
    const nodeB = host.children[0];
    assert.ok(nodeB);
    assert.notEqual(nodeB, nodeA);
    assert.equal(nodeB.attributes["data-compact"], "true");
    assert.equal(harness.isObserved(nodeA), false);
    assert.equal(harness.isObserved(nodeB), true);

    // Widening the newly mounted nodeB must expand back rather than staying stuck.
    await act(async () => {
      assert.equal(resizeNode(nodeB, 800), 1);
    });
    const nodeC = host.children[0];
    assert.ok(nodeC);
    assert.equal(nodeC.attributes["data-compact"], "false");
    assert.equal(harness.isObserved(nodeB), false);
    assert.equal(harness.isObserved(nodeC), true);
  });

  it("handles starting narrow, ignores 0px hidden measurements, and recovers when widened", async () => {
    paneWidth = 420;
    function PersistentStrip() {
      const { ref, narrow } = useNarrowPane();
      return createElement("div", {
        ref,
        "data-compact": narrow ? "true" : "false",
      });
    }

    await act(async () => {
      root?.render(createElement(PersistentStrip));
    });
    const strip = host.children[0];
    assert.ok(strip);
    assert.equal(strip.attributes["data-compact"], "true");

    await act(async () => {
      resizeNode(strip, 0);
    });
    assert.equal(strip.attributes["data-compact"], "true");

    await act(async () => {
      resizeNode(strip, 620);
    });
    assert.equal(strip.attributes["data-compact"], "false");
  });

  it("rebinds useElementWidth after conditional loading-to-ready mounts", async () => {
    let latestWidth = 0;
    function LateMountedContainer({ ready }: { readonly ready: boolean }) {
      const { ref, width } = useElementWidth();
      latestWidth = width;
      if (!ready) {
        return createElement("div", { key: "loading", "data-loading": "true" });
      }
      return createElement("div", { key: "ready", ref, "data-ready": "true" });
    }

    await act(async () => {
      root?.render(createElement(LateMountedContainer, { ready: false }));
    });
    assert.equal(latestWidth, 0);

    paneWidth = 720;
    await act(async () => {
      root?.render(createElement(LateMountedContainer, { ready: true }));
    });
    const container = host.children[0];
    assert.ok(container);
    assert.equal(container.attributes["data-ready"], "true");
    assert.equal(latestWidth, 720);
    assert.equal(harness.isObserved(container), true);

    await act(async () => {
      resizeNode(container, 500);
      flushRaf();
    });
    assert.equal(latestWidth, 500);
  });
});
