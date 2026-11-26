import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_KEYS,
  APPEARANCE_KV_KEY,
  normalizeAppearanceValue,
  resolveAppearance,
  validAppearanceValue,
} from "../lib/domain/appearance.ts";

describe("appearance:v2 domain model", () => {
  it("stores under appearance:v2 with curated keys only and zero hex overrides", () => {
    assert.equal(APPEARANCE_KV_KEY, "appearance:v2");
    assert.equal(APPEARANCE_KEYS.length, 14);
    for (const key of APPEARANCE_KEYS) {
      assert.equal(key.endsWith("Color"), false);
    }
    assert.equal("rowLayout" in APPEARANCE_DEFAULTS, false);
    assert.equal("rowDetails" in APPEARANCE_DEFAULTS, false);
  });

  it("ignores removed v1 keys without migration shims", () => {
    const resolved = resolveAppearance({
      palettePreset: "Custom",
      rowLayout: "one-line",
      rowDetails: "hover",
      workingColor: "#123456",
      showPinAction: false,
      rowDensity: "compact",
      pageSize: 12,
    });

    assert.equal(resolved.palettePreset, "Default");
    assert.equal(resolved.rowDensity, "compact");
    assert.equal(resolved.pageSize, 12);
    assert.equal("workingColor" in resolved, false);
    assert.equal("rowLayout" in resolved, false);
  });

  it("validates strict domain bounds and normalizes finite numbers & templates", () => {
    assert.equal(validAppearanceValue("pageSize", 1), true);
    assert.equal(validAppearanceValue("pageSize", 100), true);
    assert.equal(validAppearanceValue("pageSize", 0), false);
    assert.equal(validAppearanceValue("pageSize", 101), false);
    assert.equal(validAppearanceValue("pageSize", 12.5), false);
    assert.equal(validAppearanceValue("palettePreset", "Custom"), false);
    assert.equal(validAppearanceValue("featureBranchTemplate", ""), false);
    assert.equal(
      validAppearanceValue("featureBranchTemplate", "bad\u0000name"),
      false,
    );

    assert.equal(normalizeAppearanceValue("pageSize", 0), 1);
    assert.equal(normalizeAppearanceValue("pageSize", 999), 100);
    assert.equal(normalizeAppearanceValue("pageSize", Number.NaN), undefined);
    assert.equal(
      normalizeAppearanceValue("featureBranchTemplate", "  feat/{slug} "),
      "feat/{slug}",
    );
    assert.equal(
      normalizeAppearanceValue("featureDefaultBase", "  main "),
      "main",
    );
    assert.equal(
      normalizeAppearanceValue("featureDefaultBase", "bad\tbase"),
      undefined,
    );
  });
});
