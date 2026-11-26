import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_SCOPE_KEY,
  UNGROUPED_SCOPE_KEY,
  VIEW_STATE_STORAGE_KEY,
  decodeViewState,
  defaultViewState,
  machineSectionCollapseKey,
  readViewState,
  resolveGroupScope,
  withId,
  foldWorkspaceExpansion,
  workspaceExpansionKeys,
  writeViewState,
  type ViewStateStorage,
} from "../lib/ui/view-state.ts";

function storage(initial: string | null): ViewStateStorage & {
  value: string | null;
} {
  const holder = {
    value: initial,
    getItem() {
      return holder.value;
    },
    setItem(_key: string, next: string) {
      holder.value = next;
    },
  };
  return holder;
}

describe("view state persistence", () => {
  it("falls back to the default view for missing, v1, or corrupt storage", () => {
    assert.deepEqual(decodeViewState(null), defaultViewState());
    assert.deepEqual(decodeViewState("not json"), defaultViewState());
    assert.deepEqual(decodeViewState('{"version":1,"scope":"grp_a"}'), defaultViewState());
    assert.deepEqual(decodeViewState('{"version":2}'), defaultViewState());
    assert.deepEqual(
      decodeViewState('{"version":2,"collapsedProjects":"nope"}'),
      defaultViewState(),
    );
  });

  it("round-trips the whole v2 view through storage", () => {
    const store = storage(null);
    const longWorkspaceKey = `workspace:host:${"w".repeat(320)}`;
    const written = {
      ...defaultViewState(),
      surface: "features" as const,
      scope: "grp_a",
      filter: "working" as const,
      featureFilter: "needs-you" as const,
      collapsedGroups: [UNGROUPED_SCOPE_KEY],
      collapsedProjects: ["proj_1"],
      expandedWorkspaces: ["env_1", longWorkspaceKey],
      expandedFamilies: ["thr_1"],
      expandedPersonalProjects: ["proj_personal"],
      expandedInactiveProjects: ["proj_inactive"],
      parkedFeaturesOpen: true,
      snoozedOpen: true,
    };
    assert.equal(writeViewState(written, store), true);
    assert.equal(store.value !== null, true);
    assert.deepEqual(readViewState(store), written);
    assert.equal(
      store.value?.includes("version") ?? false,
      true,
    );
  });

  it("uses one key so a partial write cannot mix two sessions", () => {
    const store = storage(null);
    writeViewState({ ...defaultViewState(), scope: "grp_b" }, store);
    assert.equal(typeof VIEW_STATE_STORAGE_KEY, "string");
    assert.deepEqual(readViewState(store).collapsedProjects, []);
  });

  it("lets a collapse win over a contradictory expansion", () => {
    const decoded = decodeViewState(
      JSON.stringify({
        version: 2,
        expandedFamilies: ["thr_1", "thr_2"],
        collapsedFamilies: ["thr_1"],
      }),
    );
    assert.deepEqual(decoded.collapsedFamilies, ["thr_1"]);
    assert.deepEqual(decoded.expandedFamilies, ["thr_2"]);
  });

  it("ignores an unknown filter rather than dropping the whole record", () => {
    const decoded = decodeViewState(
      JSON.stringify({
        version: 2,
        filter: "bogus",
        featureFilter: "bogus",
        collapsedProjects: ["p"],
      }),
    );
    assert.equal(decoded.filter, "all");
    assert.equal(decoded.featureFilter, "all");
    assert.deepEqual(decoded.collapsedProjects, ["p"]);
  });
});

describe("withId", () => {
  it("adds and removes without disturbing the rest of the order", () => {
    assert.deepEqual(withId(["a", "b"], "c", true), ["a", "b", "c"]);
    assert.deepEqual(withId(["a", "b", "c"], "b", false), ["a", "c"]);
  });

  it("is a no-op when the list already agrees", () => {
    const ids = ["a", "b"];
    assert.deepEqual(withId(ids, "a", true), ids);
    assert.deepEqual(withId(ids, "z", false), ids);
  });

  it("rejects an unusable id", () => {
    assert.deepEqual(withId(["a"], "", true), ["a"]);
    assert.deepEqual(withId(["a"], "bad\u0000id", true), ["a"]);
  });
});

describe("resolveGroupScope", () => {
  const groups = new Set(["grp_a"]);

  it("restores a stored group the user still has", () => {
    assert.deepEqual(resolveGroupScope("grp_a", groups), {
      kind: "group",
      groupId: "grp_a",
    });
  });

  it("degrades a deleted group to All rather than an empty tree", () => {
    assert.deepEqual(resolveGroupScope("grp_gone", groups), { kind: "all" });
  });

  it("treats All and Ungrouped as their own destinations", () => {
    assert.deepEqual(resolveGroupScope(ALL_SCOPE_KEY, groups), { kind: "all" });
    assert.deepEqual(resolveGroupScope(UNGROUPED_SCOPE_KEY, groups), {
      kind: "ungrouped",
    });
  });

  it("reads explicit surface without cross-contaminating scope", () => {
    const decoded = decodeViewState(
      JSON.stringify({
        version: 2,
        surface: "features",
        scope: UNGROUPED_SCOPE_KEY,
      }),
    );
    assert.equal(decoded.surface, "features");
    assert.equal(decoded.scope, UNGROUPED_SCOPE_KEY);
    assert.deepEqual(resolveGroupScope(decoded.scope, groups), {
      kind: "ungrouped",
    });
  });
});

describe("view-state v2 defaults and machine keys", () => {
  it("defaults parkedFeaturesOpen false and expandedInactiveProjects empty", () => {
    const defaults = defaultViewState();
    assert.equal(defaults.surface, "projects");
    assert.equal(defaults.featureFilter, "all");
    assert.equal(defaults.parkedFeaturesOpen, false);
    assert.deepEqual(defaults.expandedInactiveProjects, []);
  });

  it("drops a list it cannot trust without resetting the rest of the view", () => {
    const state = decodeViewState(
      JSON.stringify({
        version: 2,
        scope: "grp_a",
        expandedInactiveProjects: ["ok", 7],
      }),
    );
    assert.deepEqual(state.expandedInactiveProjects, []);
    assert.equal(state.scope, "grp_a");
  });

  it("namespaces machine section collapse keys away from user groups", () => {
    assert.equal(machineSectionCollapseKey("host_1"), "machine:host_1");
    assert.notEqual(
      machineSectionCollapseKey(null),
      UNGROUPED_SCOPE_KEY,
    );
  });
});

/**
 * Folding a worktree has to clear every key the row answers to. Workspaces were
 * identified by environment id before they were identified by path, and the
 * read keeps answering to both — so a row expanded under the old key stayed
 * expanded for good, a disclosure that no longer responded to a click.
 */
describe("workspaceExpansionKeys", () => {
  it("names the row's own key and every id it answers to", () => {
    assert.deepEqual(
      workspaceExpansionKeys({
        key: "workspace:host:proj:/work/tree",
        environmentIds: ["env_one", "env_two"],
      }),
      ["workspace:host:proj:/work/tree", "env_one", "env_two"],
    );
  });

  it("still names the key when the row has no ids, which is the no-workspace bucket", () => {
    assert.deepEqual(
      workspaceExpansionKeys({ key: "__no_workspace__", environmentIds: [] }),
      ["__no_workspace__"],
    );
  });
});

describe("foldWorkspaceExpansion", () => {
  const keys = ["workspace:host:proj:/tree", "env_old"];

  it("unfolds under the current key and clears the ones it used to answer to", () => {
    assert.deepEqual(foldWorkspaceExpansion(["env_old"], keys, keys[0], true), [
      keys[0],
    ]);
  });

  it("folds away every key, which is the case a single write used to miss", () => {
    assert.deepEqual(
      foldWorkspaceExpansion([keys[0], "env_old"], keys, keys[0], false),
      [],
    );
  });

  it("leaves other rows alone", () => {
    assert.deepEqual(
      foldWorkspaceExpansion(["env_other", "env_old"], keys, keys[0], false),
      ["env_other"],
    );
  });
});
