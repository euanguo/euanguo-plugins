import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_FEATURE_ROW_ICONS_PATCH,
  DEFAULT_FEATURE_BASE_BRANCH,
  DEFAULT_FEATURE_BRANCH_TEMPLATE,
  FEATURE_ROW_ICON_ITEMS,
  FEATURE_ROW_ICON_OPTIONS,
  featureRowIconPatch,
  harborPreferenceStyle,
  PALETTE_PRESET_OPTIONS,
  PALETTE_PRESETS,
  resolveHarborPreferences,
  resolvePalette,
  SEMANTIC_COLOR_ROLES,
  visibleFeatureRowIconCount,
} from "../lib/domain/preferences.ts";

describe("resolveHarborPreferences", () => {
  it("falls back to slim appearance:v2 defaults when undefined", () => {
    const prefs = resolveHarborPreferences(undefined);
    assert.equal(prefs.palettePreset, "Default");
    assert.equal(prefs.rowDensity, "detailed");
    assert.equal(prefs.worktreeLabel, "alias-over-branch");
    assert.equal(prefs.statusDisplay, "dot");
    assert.equal(prefs.defaultChildrenExpanded, true);
    assert.equal(prefs.showQuickActions, true);
    assert.equal(prefs.pageSize, 5);
    assert.equal(prefs.autoProjectIcons, true);
    assert.equal(prefs.workspaceOwnership, "filesystem");
    assert.equal(prefs.showUnregisteredWorktrees, false);
    assert.equal(prefs.groupByRepository, false);
    assert.equal(prefs.showTitleAttention, false);
    assert.equal(prefs.featureBranchTemplate, DEFAULT_FEATURE_BRANCH_TEMPLATE);
    assert.equal(prefs.featureDefaultBase, DEFAULT_FEATURE_BASE_BRANCH);
    assert.deepEqual(prefs.featureRowIcons, {
      repoCount: true,
      newThread: true,
      hub: true,
      disclosure: true,
    });
  });

  it("ignores malformed or removed v1 values safely", () => {
    const malformed = resolveHarborPreferences({
      palettePreset: "Custom",
      rowDensity: "three-line",
      statusDisplay: "spinner",
      worktreeLabel: "unknown",
      defaultChildExpansion: "maybe",
      workspaceOwnership: "bb claims",
      showQuickActions: "no",
      pageSize: Number.NaN,
      autoProjectIcons: 1,
      showTitleAttention: "yes",
      featureBranchTemplate: "bad\u0007name",
      featureDefaultBase: "main\nnext",
      featureRowShowRepoCount: "false",
      featureRowShowNewThread: 0,
      featureRowShowHub: null as unknown as boolean,
      featureRowShowDisclosure: "hide",
    });

    assert.equal(malformed.palettePreset, "Default");
    assert.equal(malformed.rowDensity, "detailed");
    assert.equal(malformed.statusDisplay, "dot");
    assert.equal(malformed.worktreeLabel, "alias-over-branch");
    assert.equal(malformed.defaultChildrenExpanded, true);
    assert.equal(malformed.workspaceOwnership, "filesystem");
    assert.equal(malformed.showQuickActions, true);
    assert.equal(malformed.pageSize, 5);
    assert.equal(malformed.autoProjectIcons, true);
    assert.equal(malformed.showTitleAttention, false);
    assert.equal(
      malformed.featureBranchTemplate,
      DEFAULT_FEATURE_BRANCH_TEMPLATE,
    );
    assert.equal(malformed.featureDefaultBase, DEFAULT_FEATURE_BASE_BRANCH);
    assert.deepEqual(malformed.featureRowIcons, {
      repoCount: true,
      newThread: true,
      hub: true,
      disclosure: true,
    });
  });

  it("resolves valid compact/expanded options, booleans, and clamped pageSize", () => {
    const prefs = resolveHarborPreferences({
      palettePreset: "High contrast",
      rowDensity: "compact",
      statusDisplay: "icon",
      worktreeLabel: "alias-and-branch",
      defaultChildExpansion: "collapsed",
      showQuickActions: false,
      pageSize: 25,
      autoProjectIcons: false,
      workspaceOwnership: "claimed",
      showUnregisteredWorktrees: true,
      groupByRepository: true,
      showTitleAttention: true,
      featureBranchTemplate: "  topic/{slug} ",
      featureDefaultBase: " main ",
      featureRowShowRepoCount: false,
      featureRowShowNewThread: false,
      featureRowShowHub: true,
      featureRowShowDisclosure: false,
    });

    assert.equal(prefs.palettePreset, "High contrast");
    assert.equal(prefs.rowDensity, "compact");
    assert.equal(prefs.statusDisplay, "icon");
    assert.equal(prefs.worktreeLabel, "alias-and-branch");
    assert.equal(prefs.defaultChildrenExpanded, false);
    assert.equal(prefs.showQuickActions, false);
    assert.equal(prefs.pageSize, 25);
    assert.equal(prefs.autoProjectIcons, false);
    assert.equal(prefs.workspaceOwnership, "claimed");
    assert.equal(prefs.showUnregisteredWorktrees, true);
    assert.equal(prefs.groupByRepository, true);
    assert.equal(prefs.showTitleAttention, true);
    assert.equal(prefs.featureBranchTemplate, "topic/{slug}");
    assert.equal(prefs.featureDefaultBase, "main");
    assert.deepEqual(prefs.featureRowIcons, {
      repoCount: false,
      newThread: false,
      hub: true,
      disclosure: false,
    });
  });

  it("clamps out-of-range pageSize values cleanly", () => {
    assert.equal(resolveHarborPreferences({ pageSize: 0 }).pageSize, 1);
    assert.equal(resolveHarborPreferences({ pageSize: -10 }).pageSize, 1);
    assert.equal(resolveHarborPreferences({ pageSize: 5000 }).pageSize, 100);
  });

  it("exposes exactly the 3 curated palettes with all semantic color roles", () => {
    assert.deepEqual(PALETTE_PRESET_OPTIONS, [
      "Default",
      "High contrast",
      "Colorblind-friendly",
    ]);

    for (const preset of PALETTE_PRESET_OPTIONS) {
      const palette = resolvePalette(preset);
      assert.deepEqual(palette, PALETTE_PRESETS[preset]);
      for (const role of SEMANTIC_COLOR_ROLES) {
        assert.equal(typeof palette[role], "string");
        assert.ok(palette[role].length > 0);
      }
    }
  });

  it("projects resolved palette colors onto CSS custom properties", () => {
    const prefs = resolveHarborPreferences({
      palettePreset: "Colorblind-friendly",
    });
    const style = harborPreferenceStyle(prefs) as Record<string, string>;
    assert.equal(
      style["--harbor-status-working"],
      PALETTE_PRESETS["Colorblind-friendly"].working,
    );
    assert.equal(
      style["--harbor-pr-merged"],
      PALETTE_PRESETS["Colorblind-friendly"].prMerged,
    );
  });

  it("maps Feature row icon visibility patches and counts inline icons cleanly", () => {
    assert.deepEqual(FEATURE_ROW_ICON_OPTIONS, [
      "repoCount",
      "newThread",
      "hub",
      "disclosure",
    ]);
    assert.equal(FEATURE_ROW_ICON_ITEMS.length, 4);
    assert.deepEqual(featureRowIconPatch("repoCount", false), {
      featureRowShowRepoCount: false,
    });
    assert.deepEqual(featureRowIconPatch("newThread", false), {
      featureRowShowNewThread: false,
    });
    assert.deepEqual(featureRowIconPatch("hub", true), {
      featureRowShowHub: true,
    });
    assert.deepEqual(featureRowIconPatch("disclosure", false), {
      featureRowShowDisclosure: false,
    });
    assert.equal(
      visibleFeatureRowIconCount({
        repoCount: false,
        newThread: true,
        hub: false,
        disclosure: true,
      }),
      2,
    );
    const resetPrefs = resolveHarborPreferences(ALL_FEATURE_ROW_ICONS_PATCH);
    assert.equal(visibleFeatureRowIconCount(resetPrefs.featureRowIcons), 4);
  });
});
