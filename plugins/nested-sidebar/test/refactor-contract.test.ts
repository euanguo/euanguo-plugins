import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFile(new URL("../" + relative, import.meta.url), "utf8");

const [server, settings, preferences, readme, projectColors] =
  await Promise.all([
    read("server.ts"),
    read("components/settings/nest-settings.tsx"),
    read("lib/preferences.ts"),
    read("README.md"),
    read("lib/project-colors.ts"),
  ]);

describe("Nest refactor contract", () => {
  it("keeps the settings information architecture explicit", () => {
    for (const group of ["appearance", "threads", "projects", "advanced"]) {
      const marker = "id=\"" + group + "\"";
      assert.equal(
        settings.split(marker).length - 1,
        1,
        "settings group " + group + " is declared once",
      );
    }
    assert.equal(settings.split("data-nest-settings-group={id}").length - 1, 1);

    for (const label of [
      "Appearance",
      "Thread list",
      "Projects and workspaces",
      "Advanced behavior",
      "Compact rows",
      "Current layout:",
    ]) {
      assert.ok(settings.includes(label), "settings includes " + label);
    }
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
    for (const source of [server, preferences, settings, readme]) {
      for (const stale of staleTerms) {
        assert.ok(!source.includes(stale), "stale text is absent: " + stale);
      }
    }
    assert.ok(settings.includes("Nest always uses Compact rows."));
    assert.ok(readme.includes("fixed Compact"));
    assert.ok(readme.includes("One line"));
    assert.ok(readme.includes("Two lines"));
  });

  it("documents the dependency between row layout and location details", () => {
    assert.ok(
      server.includes(
        "Only applies when the thread branch or host is shown. One line puts it beside the title; Two lines puts it below the title.",
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
