import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROJECT_BADGE_PALETTE,
  automaticProjectColor,
  bestBadgeForeground,
  canonicalProjectColor,
  contrastRatio,
  projectBadgeLetter,
  projectBadgePresentation,
  validProjectId,
} from "../lib/project-colors.ts";

describe("project badge colors", () => {
  it("selects a stable palette color from project id, not display name", () => {
    const first = automaticProjectColor("project-stable-id");
    assert.ok(PROJECT_BADGE_PALETTE.some((color) => color === first));
    assert.equal(automaticProjectColor("project-stable-id"), first);
    assert.equal(
      projectBadgePresentation("project-stable-id", undefined).backgroundColor,
      projectBadgePresentation("project-stable-id", undefined).backgroundColor,
    );
    assert.equal(projectBadgeLetter("  Alpha"), "A");
    assert.equal(projectBadgeLetter("Beta"), "B");
    assert.equal(projectBadgeLetter("  "), "?");
  });

  it("accepts only canonicalizable opaque six-digit hex overrides", () => {
    assert.equal(canonicalProjectColor(" #a1b2c3 "), "#A1B2C3");
    for (const invalid of [
      "#fff",
      "#11223344",
      "red",
      "var(--primary)",
      "#GG0000",
      "",
      true,
      null,
    ]) {
      assert.equal(canonicalProjectColor(invalid), null);
    }
  });

  it("uses a valid override and otherwise restores the automatic color", () => {
    const automatic = projectBadgePresentation("project-a", null);
    const custom = projectBadgePresentation("project-a", "#abcdef");
    assert.equal(custom.backgroundColor, "#ABCDEF");
    assert.equal(custom.isCustom, true);
    assert.equal(automatic.isCustom, false);
    assert.equal(
      projectBadgePresentation("project-a", "not-css").backgroundColor,
      automatic.backgroundColor,
    );
  });

  it("chooses the stronger black or white contrast at and around crossover", () => {
    for (const background of [
      "#000000",
      "#FFFFFF",
      "#747474",
      "#757575",
      "#777777",
      ...PROJECT_BADGE_PALETTE,
    ]) {
      const selected = bestBadgeForeground(background);
      const rejected = selected === "#000000" ? "#FFFFFF" : "#000000";
      assert.ok(
        contrastRatio(background, selected) >=
          contrastRatio(background, rejected),
      );
      assert.ok(contrastRatio(background, selected) >= 4.5);
    }
  });

  it("keeps every automatic badge color readable with its selected foreground", () => {
    for (const color of PROJECT_BADGE_PALETTE) {
      const foreground = bestBadgeForeground(color);
      assert.ok(contrastRatio(color, foreground) >= 4.5);
    }
  });

  it("bounds project ids and rejects control characters", () => {
    assert.equal(validProjectId("project-1"), true);
    assert.equal(validProjectId(""), false);
    assert.equal(validProjectId("a".repeat(201)), false);
    assert.equal(validProjectId("project\n1"), false);
  });
});
