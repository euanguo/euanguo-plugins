import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
const inbox = await readFile(
  new URL("../components/inbox/thread-inbox.tsx", import.meta.url),
  "utf8",
);

describe("unregistered worktree visibility", () => {
  it("declares the setting as off by default", () => {
    assert.match(server, /showUnregisteredWorktrees: \{/);
    assert.match(server, /Projects · Show unregistered worktrees/);
    assert.match(
      server,
      /showUnregisteredWorktrees: \{[\s\S]*?default: false,/,
    );
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
