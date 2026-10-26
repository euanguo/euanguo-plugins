import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFile(new URL("../" + relative, import.meta.url), "utf8");

const [server, settings, preferences, readme, projectColors, tabs, appearance, switchSource, fieldSource] =
  await Promise.all([
    read("server.ts"),
    read("components/settings/nest-settings.tsx"),
    read("lib/preferences.ts"),
    read("README.md"),
    read("lib/project-colors.ts"),
    read("components/settings/settings-tabs.tsx"),
    read("lib/appearance.ts"),
    read("components/ui/switch.tsx"),
    read("components/ui/control.tsx"),
  ]);

describe("Nest refactor contract", () => {
  /**
   * Four tabs, one subject each, ordered by what a user comes here to change.
   *
   * This was a single 4,646px column because the host draws one form row per
   * `bb.settings` descriptor above the plugin's section and the plugin cannot
   * group or collapse them. Moving the appearance settings into the plugin's
   * own store is what made a tab strip worth having at all: it now governs the
   * whole page instead of the bottom third.
   */
  it("splits the settings page into four tabs", () => {
    for (const id of ["threads", "palette", "projects", "diagnostics"]) {
      assert.equal(
        settings.split(`id: "${id}"`).length - 1,
        1,
        `tab ${id} is declared once`,
      );
    }
    // Order is deliberate: the list, then the colours on it, then project
    // identity, then the report nobody changes anything from.
    const order = ["threads", "palette", "projects", "diagnostics"].map((id) =>
      settings.indexOf(`id: "${id}"`),
    );
    for (let i = 1; i < order.length; i += 1) {
      assert.ok(order[i - 1] < order[i], "tab order is deliberate");
    }
    // The strip is the registry's `Tabs`, not four buttons that happen to sit
    // together: Radix owns the roving focus and the aria links.
    assert.match(tabs, /from "@\/components\/ui\/tabs"/);
    assert.match(tabs, /<TabsList/);
    assert.match(tabs, /<TabsTrigger/);
    assert.match(tabs, /<TabsContent/);
    // Below sm the strip becomes a select rather than shrinking labels.
    assert.match(tabs, /<select/);
  });

  it("remembers which tab was open", () => {
    assert.match(settings, /localStorage\.getItem\(TAB_STORAGE_KEY\)/);
    assert.match(settings, /localStorage\.setItem\(TAB_STORAGE_KEY, tab\)/);
  });

  /**
   * The panels hold real controls, not a preview of controls that live
   * somewhere else. That was the defect the tabs were meant to fix: a section
   * that explained what the host form above it would do.
   */
  it("puts the controls themselves in the page, not a preview of them", () => {
    for (const control of ["<Choice", "<Toggle", "<PaletteEditor", "<Input"]) {
      assert.ok(settings.includes(control), `settings draws ${control}`);
    }
    assert.match(settings, /onChange=\{\(value\) => set\(/);
    // The run-on sentence that used to stand in for the row itself.
    assert.ok(!settings.includes("Current layout:"));
  });

  /**
   * Every form control is the registry's, not one written to look like it.
   *
   * `bb plugin new` pre-vendors button/input/label/checkbox/switch from the
   * same source bb's own settings page renders, so a plugin field and a host
   * field are the same component. This plugin was forked from a template that
   * predated that, and had hand-rolled its own — which is why its settings page
   * did not look like the rest of bb.
   */
  it("takes its form controls from the registry", () => {
    // The page itself imports the controls it draws; `Label` is reached
    // through `Field`, which is layout and lives in `control.tsx`.
    for (const [component, source] of [
      ["Button", "button"],
      ["Input", "input"],
    ] as const) {
      assert.ok(
        settings.includes(`from "@/components/ui/${source}"`),
        `${component} comes from ui/${source}`,
      );
    }
    assert.match(fieldSource, /from "@\/components\/ui\/label"/);
    // The hand-written switch is gone; the registry's replaced it.
    assert.match(switchSource, /CONTROL_HOVER_TRANSITION/);
    assert.match(switchSource, /onCheckedChange/);
  });

  it("keeps Compact as the only row layout", () => {
    const staleTerms = [
      ["row", "Density"].join(""),
      ["ROW", "_DENSITY"].join(""),
      ["Row", " density"].join(""),
      ["row", " density"].join(""),
      "Comfortable",
      ["choose row", " density"].join(""),
    ];
    for (const source of [server, preferences, settings, readme, appearance]) {
      for (const stale of staleTerms) {
        assert.ok(!source.includes(stale), "stale text is absent: " + stale);
      }
    }
    assert.ok(readme.includes("fixed Compact"));
    assert.ok(readme.includes("One line"));
    assert.ok(readme.includes("Two lines"));
  });

  it("documents the dependency between row layout and location details", () => {
    assert.ok(
      settings.includes(
        "Only applies when the branch or host is shown.",
      ),
    );
    assert.ok(
      readme.includes(
        "One line and Two lines only look different when a branch",
      ),
    );
    assert.ok(readme.includes("Search reveals every matching row"));
    assert.ok(
      readme.includes("Settings → Appearance → Sidebar → Nest (projects)"),
    );
    assert.ok(readme.includes("group -> project -> worktree -> thread"));
  });

  it("ships the calmer automatic project badge palette without changing hashing", () => {
    assert.ok(projectColors.includes('"#5B78A0"'));
    assert.ok(projectColors.includes('"#66739A"'));
    assert.ok(projectColors.includes("hash ^= projectId.charCodeAt(index)"));
    assert.ok(
      projectColors.includes("(hash >>> 0) % PROJECT_BADGE_PALETTE.length"),
    );
  });
});
