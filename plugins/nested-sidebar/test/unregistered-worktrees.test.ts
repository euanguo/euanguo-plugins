import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { readInboxModules } from "./_sources.ts";

const appearance = await readFile(
  new URL("../lib/appearance.ts", import.meta.url),
  "utf8",
);
const settings = await readFile(
  new URL("../components/settings/nest-settings.tsx", import.meta.url),
  "utf8",
);
const inbox = await readInboxModules();

describe("unregistered worktree visibility", () => {
  it("declares the setting as off by default", () => {
    // An appearance setting now, not a descriptor: nothing on the server reads
    // it, so it lives in the record the settings page draws and writes.
    assert.match(appearance, /showUnregisteredWorktrees: false,/);
    assert.match(settings, /values\.showUnregisteredWorktrees/);
  });

  it("draws the repository rows only after the user enables the setting", () => {
    assert.match(
      inbox,
      /workspaceOwnership === undefined \|\|\s*!preferences\.showUnregisteredWorktrees/,
    );
    assert.match(
      inbox,
      /:\s*repoFacts\.unseenWorkspaces/,
    );
  });
});
