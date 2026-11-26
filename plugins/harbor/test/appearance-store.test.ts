import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_KV_KEY,
} from "../lib/domain/appearance.ts";
import { createAppearanceStore } from "../lib/stores/appearance-store.ts";

function createFakeBb(options?: {
  delayMs?: number;
  failNextSet?: boolean;
}) {
  const storage = new Map<string, unknown>();
  let failNextSet = options?.failNextSet ?? false;
  const delay = () =>
    options?.delayMs
      ? new Promise<void>((resolve) => setTimeout(resolve, options.delayMs))
      : Promise.resolve();

  const bb = {
    storage: {
      kv: {
        async get(key: string) {
          await delay();
          const value = storage.get(key);
          return value === undefined ? undefined : structuredClone(value);
        },
        async set(key: string, value: unknown) {
          await delay();
          if (failNextSet) {
            failNextSet = false;
            throw new Error("Simulated KV write failure");
          }
          storage.set(key, structuredClone(value));
        },
      },
    },
  } as unknown as BbPluginApi;

  return { bb, storage };
}

describe("createAppearanceStore", () => {
  it("reads defaults when kv row is empty and ignores legacy v1 rows", async () => {
    const { bb, storage } = createFakeBb();
    storage.set("appearance:v1", { rowLayout: "one-line", workingColor: "#111111" });
    const store = createAppearanceStore(bb);

    const values = await store.get();
    assert.deepEqual(values, APPEARANCE_DEFAULTS);
    assert.equal(storage.get(APPEARANCE_KV_KEY), undefined);
  });

  it("serializes concurrent set() patches so no updates are dropped", async () => {
    const { bb, storage } = createFakeBb({ delayMs: 8 });
    const store = createAppearanceStore(bb);

    await Promise.all([
      store.set({ palettePreset: "High contrast" }),
      store.set({ rowDensity: "compact" }),
      store.set({ statusDisplay: "icon" }),
      store.set({ pageSize: 24 }),
      store.set({ showTitleAttention: true }),
      store.set({ featureBranchTemplate: "bugfix/{slug}" }),
    ]);

    const finalValues = await store.get();
    assert.equal(finalValues.palettePreset, "High contrast");
    assert.equal(finalValues.rowDensity, "compact");
    assert.equal(finalValues.statusDisplay, "icon");
    assert.equal(finalValues.pageSize, 24);
    assert.equal(finalValues.showTitleAttention, true);
    assert.equal(finalValues.featureBranchTemplate, "bugfix/{slug}");
    assert.deepEqual(storage.get(APPEARANCE_KV_KEY), finalValues);
  });

  it("recovers cleanly after a rejected write without wedging subsequent calls", async () => {
    const { bb } = createFakeBb({ failNextSet: true });
    const store = createAppearanceStore(bb);

    await assert.rejects(
      store.set({ rowDensity: "compact" }),
      /Simulated KV write failure/,
    );

    const updated = await store.set({ pageSize: 15 });
    assert.equal(updated.pageSize, 15);
    assert.equal(updated.rowDensity, APPEARANCE_DEFAULTS.rowDensity);
  });

  it("clamps pageSize bounds and ignores invalid or unknown fields", async () => {
    const { bb } = createFakeBb();
    const store = createAppearanceStore(bb);

    const clampedLow = await store.set({ pageSize: 0 });
    assert.equal(clampedLow.pageSize, 1);

    const clampedHigh = await store.set({ pageSize: 500 });
    assert.equal(clampedHigh.pageSize, 100);

    const afterInvalid = await store.set({
      pageSize: Number.NaN,
      palettePreset: "Custom",
      featureBranchTemplate: "",
      rowDensity: "compact",
    });
    assert.equal(afterInvalid.pageSize, 100);
    assert.equal(afterInvalid.palettePreset, "Default");
    assert.equal(
      afterInvalid.featureBranchTemplate,
      APPEARANCE_DEFAULTS.featureBranchTemplate,
    );
    assert.equal(afterInvalid.rowDensity, "compact");
  });
});
