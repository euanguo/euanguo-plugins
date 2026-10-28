import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOM_COLOR_DEFAULTS,
  nestPreferenceStyle,
  resolveNestPreferences,
  SEMANTIC_COLOR_ROLES,
} from "../lib/preferences.ts";

describe("resolveNestPreferences", () => {
  it("preserves current behavior while settings load or are unknown", () => {
    const loading = resolveNestPreferences(undefined);
    assert.equal(loading.palettePreset, "Default");
    assert.equal(loading.rowLayout, "two-line");
    assert.equal(loading.worktreeLabel, "alias-over-branch");
    assert.equal(loading.statusDisplay, "dot");
    assert.equal(loading.defaultChildrenExpanded, true);
    assert.equal(loading.showProviderIcons, true);
    assert.equal(loading.showPullRequestMetadata, true);
    assert.equal(loading.showRelativeTime, true);
    assert.equal(loading.showChildCount, true);
    assert.equal(loading.showThreadLocation, true);
    assert.equal(loading.showPinAction, true);
    assert.equal(loading.showSnoozeAction, true);
    assert.equal(loading.showSettleAction, true);
    assert.equal(loading.workspaceOwnership, "filesystem");
    assert.equal(loading.showUnregisteredWorktrees, false);
    assert.equal(loading.pageSize, 5);
    assert.equal(loading.colors.working, "#34A853");
    assert.equal(loading.colors.prReady, "#34A853");

    const malformed = resolveNestPreferences({
      palettePreset: "Unknown",
      rowLayout: "Three lines",
      statusDisplay: "Sparkles",
      defaultChildExpansion: "Sometimes",
      showProviderIcons: "false",
      pageSize: Number.NaN,
    });
    assert.equal(malformed.palettePreset, "Default");
    assert.equal(malformed.rowLayout, "two-line");
    assert.equal(malformed.worktreeLabel, "alias-over-branch");
    assert.equal(malformed.statusDisplay, "dot");
    assert.equal(malformed.defaultChildrenExpanded, true);
    assert.equal(malformed.showProviderIcons, true);
    assert.equal(malformed.showPinAction, true);
    assert.equal(malformed.showSnoozeAction, true);
    assert.equal(malformed.showSettleAction, true);
    assert.equal(malformed.pageSize, 5);
  });

  it("controls each quick row action independently", () => {
    const preferences = resolveNestPreferences({
      showPinAction: false,
      showSnoozeAction: false,
      showSettleAction: true,
    });

    assert.equal(preferences.showPinAction, false);
    assert.equal(preferences.showSnoozeAction, false);
    assert.equal(preferences.showSettleAction, true);
    assert.equal(
      resolveNestPreferences({ showPinAction: "no" }).showPinAction,
      true,
    );
  });

  it("can restore bb's claimed workspace ownership", () => {
    assert.equal(
      resolveNestPreferences({ workspaceOwnership: "bb claims" })
        .workspaceOwnership,
      "claimed",
    );
    assert.equal(
      resolveNestPreferences({ workspaceOwnership: "Unknown" })
        .workspaceOwnership,
      "filesystem",
    );
  });

  it("shows unregistered worktrees only when explicitly enabled", () => {
    assert.equal(
      resolveNestPreferences({
        showUnregisteredWorktrees: true,
      }).showUnregisteredWorktrees,
      true,
    );
    assert.equal(
      resolveNestPreferences({
        showUnregisteredWorktrees: "yes",
      }).showUnregisteredWorktrees,
      false,
    );
  });

  it("takes a configured page size, bounded", () => {
    assert.equal(
      resolveNestPreferences({ pageSize: 12 }).pageSize,
      12,
    );
    assert.equal(
      resolveNestPreferences({ pageSize: 0 }).pageSize,
      1,
    );
    assert.equal(
      resolveNestPreferences({ pageSize: 5000 }).pageSize,
      100,
    );
  });

  it("resolves where a row's details live, defaulting to no branch", () => {
    assert.equal(resolveNestPreferences(undefined).rowDetails, "row-no-branch");
    assert.equal(
      resolveNestPreferences({ rowDetails: "In the row" }).rowDetails,
      "row",
    );
    assert.equal(
      resolveNestPreferences({ rowDetails: "In the row, no branch" }).rowDetails,
      "row-no-branch",
    );
    assert.equal(
      resolveNestPreferences({ rowDetails: "On hover" }).rowDetails,
      "hover",
    );
    // A label that is no longer offered lands on the default, not on a mode
    // with no label of its own.
    assert.equal(
      resolveNestPreferences({ rowDetails: "Sideways" }).rowDetails,
      "row-no-branch",
    );
  });

  it("reads the compact row options by their declared labels", () => {
    const oneLine = resolveNestPreferences({
      rowLayout: "One line",
      statusDisplay: "Status icon",
      showChildCount: false,
      showThreadLocation: false,
    });
    assert.equal(oneLine.rowLayout, "one-line");
    assert.equal(oneLine.statusDisplay, "icon");
    assert.equal(oneLine.showChildCount, false);
    assert.equal(oneLine.showThreadLocation, false);

    // A non-boolean is not a preference, so the default holds.
    assert.equal(
      resolveNestPreferences({ showChildCount: "no" }).showChildCount,
      true,
    );
  });

  it("reads every worktree label mode by its declared label", () => {
    for (const [option, mode] of [
      ["Alias over branch", "alias-over-branch"],
      ["Alias + branch", "alias-and-branch"],
      ["Alias only", "alias-only"],
      ["Branch only", "branch-only"],
    ] as const) {
      assert.equal(
        resolveNestPreferences({ worktreeLabel: option }).worktreeLabel,
        mode,
      );
    }
  });

  it("resolves distinct high-contrast and colorblind-friendly presets", () => {
    const contrast = resolveNestPreferences({
      palettePreset: "High contrast",
    });
    const colorblind = resolveNestPreferences({
      palettePreset: "Colorblind-friendly",
    });

    for (const role of SEMANTIC_COLOR_ROLES) {
      assert.match(contrast.colors[role], /^#[0-9A-F]{6}$/);
      assert.match(colorblind.colors[role], /^#[0-9A-F]{6}$/);
    }
    assert.notDeepEqual(contrast.colors, colorblind.colors);
  });

  it("accepts only six-digit custom hex colors and falls back per role", () => {
    const preferences = resolveNestPreferences({
      palettePreset: "Custom",
      workingColor: "  #abcdef ",
      waitingColor: "red",
      unreadColor: "#12345",
      errorColor: "#1234567",
      idleColor: "var(--bad)",
      staleColor: "#445566",
      prReviewColor: "#010203",
    });

    assert.equal(preferences.colors.working, "#ABCDEF");
    assert.equal(preferences.colors.waiting, CUSTOM_COLOR_DEFAULTS.waiting);
    assert.equal(preferences.colors.unread, CUSTOM_COLOR_DEFAULTS.unread);
    assert.equal(preferences.colors.error, CUSTOM_COLOR_DEFAULTS.error);
    assert.equal(
      preferences.colors.inactive,
      CUSTOM_COLOR_DEFAULTS.inactive,
    );
    assert.equal(preferences.colors.stale, "#445566");
    assert.equal(preferences.colors.prReview, "#010203");
  });

  it("resolves behavior preferences independently of palette", () => {
    const preferences = resolveNestPreferences({
      palettePreset: "Custom",
      defaultChildExpansion: "Collapsed",
      showProviderIcons: false,
      showPullRequestMetadata: false,
      showRelativeTime: false,
    });

    assert.equal(preferences.defaultChildrenExpanded, false);
    assert.equal(preferences.showProviderIcons, false);
    assert.equal(preferences.showPullRequestMetadata, false);
    assert.equal(preferences.showRelativeTime, false);
  });
});

describe("nestPreferenceStyle", () => {
  it("projects only owner-scoped semantic variables", () => {
    const style = nestPreferenceStyle(
      resolveNestPreferences({ palettePreset: "Colorblind-friendly" }),
    );
    assert.deepEqual(Object.keys(style).sort(), [
      "--nest-pr-blocked",
      "--nest-pr-checks",
      "--nest-pr-closed",
      "--nest-pr-draft",
      "--nest-pr-merged",
      "--nest-pr-ready",
      "--nest-pr-review",
      "--nest-status-agent",
      "--nest-status-command",
      "--nest-status-error",
      "--nest-status-goal",
      "--nest-status-inactive",
      "--nest-status-plan",
      "--nest-status-stale",
      "--nest-status-unread",
      "--nest-status-waiting",
      "--nest-status-workflow",
      "--nest-status-working",
    ]);
    assert.equal(style["--nest-status-working"], "#009E73");
  });
});
