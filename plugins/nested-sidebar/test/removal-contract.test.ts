import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const dialog = await read("components/inbox/remove-worktree-dialog.tsx");
const treeRows = await read("components/inbox/tree-rows.tsx");
const server = await read("server.ts");

/**
 * The removal is the one destructive thing this sidebar offers, so these pin the
 * properties that keep it safe rather than the copy: the directory step starts
 * off, nothing can submit while the ask is half-met, and the server decides
 * again for itself instead of trusting what the dialog sent.
 */
describe("removing a worktree", () => {
  it("offers it from the worktree row, and only where there is an environment", () => {
    assert.match(treeRows, /label: "Remove worktree…",/);
    assert.match(treeRows, /disabled: !canRemove,/);
    assert.match(treeRows, /<RemoveWorktreeDialog/);
  });

  it("starts with the directory staying put", () => {
    assert.match(
      dialog,
      /const \[deleteDirectory, setDeleteDirectory\] = useState\(false\)/,
    );
  });

  it("cannot submit until the one box is ticked", () => {
    assert.match(dialog, /removalSubmissionBlocker\(plan\.plan, \{/);
    assert.match(
      dialog,
      /disabled=\{busy \|\| blocker !== null \|\| leftBehind !== null\}/,
    );
    assert.match(dialog, /I understand this cannot be undone/);
  });

  it("asks for a box rather than the directory's name", () => {
    // Typing a path is long enough that it gets pasted without being read; the
    // gate is the acknowledgement, and the counts sit right above it.
    assert.doesNotMatch(dialog, /to confirm/);
    assert.doesNotMatch(dialog, /typedName/);
  });

  it("re-reads the workspace and re-checks the ask on the server", () => {
    // Trusting the client's `acknowledged` flag would make the whole gate a
    // suggestion; the survey is taken again inside the handler.
    assert.match(
      server,
      /const survey = await surveyWorktree\(environmentId\);\n\s*const plan = planWorktreeRemoval\(survey\);\n\s*const blocker = removalSubmissionBlocker\(plan, \{/,
    );
  });

  it("archives before releasing, and stops if bb will not release", () => {
    const archiveAt = server.indexOf(
      "await bb.sdk.environments.archiveThreads({ environmentId })",
    );
    const deleteAt = server.indexOf(
      "await bb.sdk.environments.delete({ environmentId })",
    );
    assert.notEqual(archiveAt, -1);
    assert.notEqual(deleteAt, -1);
    assert.ok(archiveAt < deleteAt, "threads are archived first");
    // The catch returns before the directory is touched, so a refused release
    // cannot become a deleted directory.
    const between = server.slice(deleteAt, server.indexOf("const removal = await removeWorktreeDirectory"));
    assert.match(between, /directory: "kept" as const/);
  });

  it("removes the directory through git where git owns the record", () => {
    assert.match(server, /worktreeHost\.call\(\s*"removeWorktree"/);
    assert.match(server, /await bb\.sdk\.files\.remove\(/);
    // The host call happens before the plain delete, and only git's own refusal
    // may fall through to it.
    const gitAt = server.indexOf('"removeWorktree",');
    const plainAt = server.indexOf("await bb.sdk.files.remove(");
    assert.ok(gitAt !== -1 && plainAt !== -1 && gitAt < plainAt);
  });
});
