import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const treeRows = await read("components/inbox/tree-rows.tsx");
const projectNode = await read("components/inbox/project-node.tsx");
const server = await read("server.ts");

/**
 * Copying a path is the only reason these rows need the server at all: neither
 * the app's environment DTO nor its project DTO carries one. These pin the read
 * that supplies them and the places that offer it.
 */
describe("copying what a row points at", () => {
  it("reads the paths from the side that knows them", () => {
    assert.match(server, /listWorkspacePaths: \{/);
    assert.match(server, /environments: z\.record\(/);
    assert.match(server, /projects: z\.record\(/);
    assert.match(server, /async listWorkspacePaths\(\)/);
  });

  it("offers the path, the branch, and the environment id on a workspace row", () => {
    for (const label of ["Copy path", "Copy branch", "Copy environment ID"]) {
      assert.match(treeRows, new RegExp(`label: "${label}"`), label);
    }
    // Each one is disabled rather than wrong when its value is unknown.
    assert.match(
      treeRows,
      /label: "Copy path",\n\s+separatorBefore: true,\n\s+disabled: path === null,/,
    );
    assert.match(treeRows, /label: "Copy branch",\n\s+disabled: branch === null,/);
  });

  it("offers the project's own path on the project row", () => {
    assert.match(
      projectNode,
      /label: "Copy path",\n\s+disabled: projectPath === null,/,
    );
    assert.match(projectNode, /const projectPath = handlers\.paths\.projects/);
  });

  it("tells a checkout row from a worktree row by its icon", () => {
    // The project's own directory is where the work started; a worktree is one
    // branch of it, and the two should not look the same.
    assert.match(
      treeRows,
      /name=\{node\.ref\.kind === "project-checkout" \? "Folder"/,
    );
  });
});
