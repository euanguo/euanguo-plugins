import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  environmentWorkspaceKey,
  normalizeWorkspacePath,
  physicalWorkspaceKey,
} from "../lib/domain/workspace-key.ts";

const HOST = "host_1";

describe("the physical workspace key", () => {
  it("keys one directory by host and path, however it was spelled", () => {
    const key = physicalWorkspaceKey(HOST, "/work/tree");
    assert.equal(physicalWorkspaceKey(HOST, "/work/tree/"), key);
    assert.equal(physicalWorkspaceKey(HOST, "/work//tree///"), key);
    assert.equal(physicalWorkspaceKey(HOST, "\\work\\tree"), key);
  });

  it("keeps two machines' copies of one path apart", () => {
    assert.notEqual(
      physicalWorkspaceKey(HOST, "/work/tree"),
      physicalWorkspaceKey("host_2", "/work/tree"),
    );
  });

  it("shares the one path normalization with the rest of the plugin", () => {
    assert.equal(normalizeWorkspacePath("/a//b///c/"), "/a/b/c");
    assert.equal(normalizeWorkspacePath("C:\\a\\b"), "C:/a/b");
    assert.equal(normalizeWorkspacePath("/"), "/");
    assert.equal(normalizeWorkspacePath("   "), null);
  });

  it("keeps the realPath spelling an alias, never a second primary", () => {
    // bb recorded the symlink; the disk resolves to another directory.
    const primary = physicalWorkspaceKey(HOST, "/link/tree");
    const realPath = physicalWorkspaceKey(HOST, "/real/tree");
    assert.notEqual(primary, realPath);
    // Only the recorded path is a primary. The index attaches the realPath key
    // to that row as a legacy alias (`workspace-index.test.ts` proves the row
    // count stays one); the factory never merges the two spellings itself.
    assert.equal(
      physicalWorkspaceKey(HOST, "/link/tree/"),
      primary,
      "the recorded path stays one key",
    );
  });
});

describe("the environment fallback key", () => {
  it("names a record with no path by its id", () => {
    assert.equal(environmentWorkspaceKey("env_a"), "environment:env_a");
    assert.notEqual(environmentWorkspaceKey("env_a"), environmentWorkspaceKey("env_b"));
  });
});
