import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  keyboardWorkspaceMove,
  moveProjectWorkspace,
  orderWorkspaces,
} from "../lib/workspace-order.ts";
import type { WorkspaceRef } from "../lib/workspace.ts";
import type { WorktreeSortMode } from "../lib/sort-modes.ts";
import { statusKindRank } from "../lib/rollup.ts";
import type { WorkspaceSortFacts } from "../lib/workspace-order.ts";

const ref = (
  key: string,
  kind: WorkspaceRef["kind"],
  label: string,
): WorkspaceRef => ({
  kind,
  key,
  label,
  alias: null,
  branch: kind === "git-worktree" ? label : null,
  environmentId: key,
  environmentIds: [key],
  path: "/repo/" + key,
  hostId: "host_fixture",
  diagnostic: null,
});

const checkout = ref("env_checkout", "project-checkout", "feat/ultimate-version");
const alpha = ref("env_alpha", "git-worktree", "alpha");
const beta = ref("env_beta", "git-worktree", "beta");
const gamma = ref("env_gamma", "git-worktree", "gamma");

const keysOf = (workspaces: readonly { ref: WorkspaceRef }[]) =>
  workspaces.map((workspace) => workspace.ref.key);

/** The rows a project draws, as the tree hands them over: refs in a list. */
const rows = (...refs: readonly WorkspaceRef[]) => refs.map((ref) => ({ ref }));

describe("moveProjectWorkspace", () => {
  const keys = ["env_alpha", "env_beta", "env_gamma"];

  it("drops a worktree before or after the row it landed on", () => {
    const before = moveProjectWorkspace({
      projectId: "proj",
      sourceProjectId: "proj",
      targetProjectId: "proj",
      keys,
      sourceKey: "env_gamma",
      targetKey: "env_alpha",
      position: "before",
    });
    assert.deepEqual(before, { ok: true, keys: ["env_gamma", "env_alpha", "env_beta"] });

    const after = moveProjectWorkspace({
      projectId: "proj",
      sourceProjectId: "proj",
      targetProjectId: "proj",
      keys,
      sourceKey: "env_alpha",
      targetKey: "env_gamma",
      position: "after",
    });
    assert.deepEqual(after, { ok: true, keys: ["env_beta", "env_gamma", "env_alpha"] });
  });

  it("refuses a move between two projects", () => {
    assert.deepEqual(
      moveProjectWorkspace({
        projectId: "proj",
        sourceProjectId: "other",
        targetProjectId: "proj",
        keys,
        sourceKey: "env_alpha",
        targetKey: "env_beta",
        position: "before",
      }),
      { ok: false, reason: "cross-project" },
    );
  });

  it("refuses a row dropped on itself, or on one it cannot see", () => {
    const same = moveProjectWorkspace({
      projectId: "proj",
      sourceProjectId: "proj",
      targetProjectId: "proj",
      keys,
      sourceKey: "env_alpha",
      targetKey: "env_alpha",
      position: "after",
    });
    assert.equal(same.ok, false);

    const missing = moveProjectWorkspace({
      projectId: "proj",
      sourceProjectId: "proj",
      targetProjectId: "proj",
      keys,
      sourceKey: "env_alpha",
      targetKey: "env_nowhere",
      position: "after",
    });
    assert.deepEqual(missing, { ok: false, reason: "missing-workspace" });
  });

  it("refuses a list that is not a permutation of valid keys", () => {
    const duplicated = moveProjectWorkspace({
      projectId: "proj",
      sourceProjectId: "proj",
      targetProjectId: "proj",
      keys: ["env_alpha", "env_alpha"],
      sourceKey: "env_alpha",
      targetKey: "env_beta",
      position: "after",
    });
    assert.deepEqual(duplicated, { ok: false, reason: "invalid-id" });
  });
});

describe("keyboardWorkspaceMove", () => {
  const keys = ["env_alpha", "env_beta", "env_gamma"];

  it("steps one row, in both directions", () => {
    const up = keyboardWorkspaceMove("proj", keys, "env_beta", -1);
    assert.deepEqual(up, { ok: true, keys: ["env_beta", "env_alpha", "env_gamma"] });
    const down = keyboardWorkspaceMove("proj", keys, "env_beta", 1);
    assert.deepEqual(down, { ok: true, keys: ["env_alpha", "env_gamma", "env_beta"] });
  });

  it("stops at the ends rather than wrapping", () => {
    assert.deepEqual(keyboardWorkspaceMove("proj", keys, "env_alpha", -1), {
      ok: false,
      reason: "missing-workspace",
    });
    assert.deepEqual(keyboardWorkspaceMove("proj", keys, "env_gamma", 1), {
      ok: false,
      reason: "missing-workspace",
    });
  });
});

describe("orderWorkspaces", () => {
  it("leads with the checkout whatever the stored order says", () => {
    const ordered = orderWorkspaces(
      rows(alpha, beta, checkout),
      ["env_beta", "env_alpha", "env_checkout"],
    );
    assert.deepEqual(keysOf(ordered), [
      "env_checkout",
      "env_beta",
      "env_alpha",
    ]);
  });

  it("keeps the stored arrangement for the worktrees", () => {
    const ordered = orderWorkspaces(
      rows(alpha, beta, gamma, checkout),
      ["env_gamma", "env_alpha", "env_beta"],
    );
    assert.deepEqual(keysOf(ordered), [
      "env_checkout",
      "env_gamma",
      "env_alpha",
      "env_beta",
    ]);
  });

  it("puts a worktree nobody arranged after the ones that were", () => {
    // A worktree created since, on this machine or another one, lands by label
    // at the end rather than at the top of an arrangement it was never in.
    const ordered = orderWorkspaces(rows(alpha, beta, gamma, checkout), [
      "env_beta",
    ]);
    assert.deepEqual(keysOf(ordered), [
      "env_checkout",
      "env_beta",
      "env_alpha",
      "env_gamma",
    ]);
  });

  it("falls back to labels when there is no arrangement at all", () => {
    assert.deepEqual(
      keysOf(orderWorkspaces(rows(beta, gamma, alpha, checkout), undefined)), [
        "env_checkout",
        "env_alpha",
        "env_beta",
        "env_gamma",
      ],
    );
    // A stored list that is not a valid order is no order.
    assert.deepEqual(
      keysOf(
        orderWorkspaces(rows(beta, alpha, checkout), ["env_beta", "env_beta"]),
      ),
      ["env_checkout", "env_alpha", "env_beta"],
    );
  });
});

/**
 * A lens as the tree hands it over: the mode, plus a reader for the numbers of
 * each row. Stubbed here on purpose — the ranking is what is under test, and the
 * real reader only maps a row's families and rollup onto these three numbers.
 */
const lens = (
  mode: Exclude<WorktreeSortMode, "manual">,
  facts: Readonly<Record<string, Partial<WorkspaceSortFacts>>>,
) => ({
  mode,
  facts: (workspace: { readonly ref: WorkspaceRef }): WorkspaceSortFacts => ({
    updatedAt: 0,
    families: 0,
    statusRank: 0,
    ...(facts[workspace.ref.key] ?? {}),
  }),
});

describe("orderWorkspaces under a lens", () => {
  // The checkout is deliberately the worst row on every dimension, so a lens
  // that ranked it would put it last.
  const facts = {
    env_checkout: {
      updatedAt: 1,
      families: 0,
      statusRank: statusKindRank("inactive"),
    },
    env_alpha: { updatedAt: 3, families: 1, statusRank: statusKindRank("working") },
    env_beta: { updatedAt: 2, families: 5, statusRank: statusKindRank("failed") },
    env_gamma: { updatedAt: 9, families: 2, statusRank: statusKindRank("stale") },
  };
  const arranged = ["env_alpha", "env_beta", "env_gamma"];
  const lensed = (mode: Exclude<WorktreeSortMode, "manual">) =>
    keysOf(
      orderWorkspaces(rows(alpha, beta, gamma, checkout), arranged, lens(mode, facts)),
    );

  it("leads with the checkout under every mode", () => {
    for (const mode of ["name-asc", "updated-desc", "threads-desc", "status"] as const) {
      assert.equal(lensed(mode)[0], "env_checkout", mode);
    }
  });

  it("ranks the worktrees by name, not by the arrangement", () => {
    // The arrangement says alpha, beta, gamma; the labels say the same, so the
    // rows are reversed here to prove the arrangement is not being read.
    const ordered = keysOf(
      orderWorkspaces(rows(gamma, beta, alpha, checkout), arranged, lens("name-asc", facts)),
    );
    assert.deepEqual(ordered, ["env_checkout", "env_alpha", "env_beta", "env_gamma"]);
  });

  it("ranks by the latest thread in each worktree", () => {
    assert.deepEqual(lensed("updated-desc"), [
      "env_checkout",
      "env_gamma",
      "env_alpha",
      "env_beta",
    ]);
  });

  it("ranks by how many threads live in each worktree", () => {
    assert.deepEqual(lensed("threads-desc"), [
      "env_checkout",
      "env_beta",
      "env_gamma",
      "env_alpha",
    ]);
  });

  it("ranks by the worst status in each worktree", () => {
    // failed, then working, then stale — the same ladder the dots fold with.
    assert.deepEqual(lensed("status"), [
      "env_checkout",
      "env_beta",
      "env_alpha",
      "env_gamma",
    ]);
  });

  it("breaks a status tie with activity, then with the label", () => {
    const tied = {
      env_alpha: { updatedAt: 5, statusRank: statusKindRank("working") },
      env_beta: { updatedAt: 7, statusRank: statusKindRank("working") },
      env_gamma: { updatedAt: 7, statusRank: statusKindRank("working") },
    };
    assert.deepEqual(
      keysOf(
        orderWorkspaces(rows(gamma, alpha, beta, checkout), undefined, lens("status", tied)),
      ),
      ["env_checkout", "env_beta", "env_gamma", "env_alpha"],
    );
  });

  it("keeps a row a lens cannot rank in a stable place", () => {
    // Two rows with nothing to separate them still come out in label order
    // rather than in whatever order the input array happened to hold.
    const flat = {
      env_alpha: { updatedAt: 4, families: 1, statusRank: 0 },
      env_beta: { updatedAt: 4, families: 1, statusRank: 0 },
    };
    assert.deepEqual(
      keysOf(
        orderWorkspaces(rows(beta, alpha, checkout), undefined, lens("updated-desc", flat)),
      ),
      ["env_checkout", "env_alpha", "env_beta"],
    );
  });
});
