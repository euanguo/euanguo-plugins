import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readdir } from "node:fs/promises";

import { removeFeatureDirectory } from "../host/feature-worktree.ts";

async function featureDir(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "harbor-feature-"));
  const dir = join(root, "feat_x");
  await mkdir(dir);
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body, "utf8");
  }
  return dir;
}

describe("removing a feature directory", () => {
  it("takes back a directory holding only the plugin's own files", async () => {
    const dir = await featureDir({
      ".harbor-feature.json": "{}",
      "AGENTS.md": "# feature",
      "CLAUDE.md": "@AGENTS.md\n",
    });
    const result = await removeFeatureDirectory(dir);
    assert.equal(result.status, "removed");
    await assert.rejects(readdir(dir));
  });

  it("keeps a directory that still holds a worktree", async () => {
    const dir = await featureDir({
      ".harbor-feature.json": "{}",
      "AGENTS.md": "# feature",
    });
    await mkdir(join(dir, "acme-web"));
    const result = await removeFeatureDirectory(dir);
    assert.equal(result.status, "kept");
    if (result.status !== "kept") return;
    assert.match(result.reason ?? "", /Harbor did not write/u);
  });

  it("keeps a directory with a file the user added", async () => {
    const dir = await featureDir({
      ".harbor-feature.json": "{}",
      "AGENTS.md": "# feature",
      "notes.md": "mine",
    });
    const result = await removeFeatureDirectory(dir);
    assert.equal(result.status, "kept");
  });

  it("reports a missing directory instead of throwing", async () => {
    const result = await removeFeatureDirectory("/nonexistent/harbor/dir");
    assert.equal(result.status, "kept");
  });
});
