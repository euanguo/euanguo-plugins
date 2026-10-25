import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GROUPS_SNAPSHOT_CODEC,
  ORDER_SNAPSHOT_CODEC,
  VIEW_PREFERENCES_SNAPSHOT_CODEC,
  WORKSPACE_PATHS_SNAPSHOT_CODEC,
  type GroupsSnapshot,
  type OrderSnapshot,
  type ViewPreferencesSnapshot,
} from "../lib/store-persistence.ts";
import type { WorkspacePaths } from "../lib/workspace.ts";

const groupsValue: GroupsSnapshot = {
  groups: [
    { id: "g1", name: "Work", icon: "LayerIcon", position: 0 },
    { id: "g2", name: "Personal", icon: "Target02Icon", position: 1 },
  ],
  assignment: { proj_a: "g1", proj_b: "g2" },
  icons: { all: "EyeIcon", ungrouped: "FolderTreeIcon" },
};

const orderValue: OrderSnapshot = {
  projects: { __all__: ["proj_a"], g1: ["proj_b"] },
  families: { proj_a: ["thr_1", "thr_2"] },
  workspaces: { proj_a: ["workspace:host:proj:/src"] },
};

const viewPreferencesValue: ViewPreferencesSnapshot = {
  projectSort: "name-asc",
  threadSort: "updated-desc",
  worktreeSort: "threads-desc",
  organizationMode: "machine",
};

const workspacePathsValue: WorkspacePaths = {
  environments: {
    env_1: {
      id: "env_1",
      projectId: "proj_a",
      hostId: "host_1",
      path: "/src/app",
      isGitRepo: true,
      isWorktree: false,
      branchName: "main",
      name: null,
      providerId: null,
      workspaceDisplayKind: null,
    },
  },
  projects: {
    proj_a: { projectId: "proj_a", sourcePath: "/src/app", sourceHostId: "host_1" },
  },
};

/** Encode, then hand the string straight back to the decoder. */
function roundTrip<T>(codec: { encode(value: T): string; decode(stored: string): T | null }, value: T): T | null {
  return codec.decode(codec.encode(value));
}

/** A stored payload built from a known-good value, with a field replaced. */
function corrupt(value: unknown, patch: Record<string, unknown>): string {
  return JSON.stringify({ ...(value as Record<string, unknown>), ...patch });
}

describe("groups snapshot codec", () => {
  it("round trips a full record", () => {
    assert.deepEqual(roundTrip(GROUPS_SNAPSHOT_CODEC, groupsValue), groupsValue);
  });

  it("keeps an empty arrangement, which is a value and not a miss", () => {
    const empty: GroupsSnapshot = {
      groups: [],
      assignment: {},
      icons: { all: "EyeIcon", ungrouped: "FolderTreeIcon" },
    };
    assert.deepEqual(roundTrip(GROUPS_SNAPSHOT_CODEC, empty), empty);
  });

  it("upgrades an icon written under its legacy name", () => {
    const decoded = GROUPS_SNAPSHOT_CODEC.decode(
      corrupt(groupsValue, {
        groups: [{ id: "g1", name: "Work", icon: "Layer", position: 0 }],
        assignment: {},
      }),
    );
    assert.equal(decoded?.groups[0].icon, "LayerIcon");
  });

  it("rejects a group whose icon is not one this build draws", () => {
    assert.equal(
      GROUPS_SNAPSHOT_CODEC.decode(
        corrupt(groupsValue, {
          groups: [{ id: "g1", name: "Work", icon: "NopeIcon", position: 0 }],
        }),
      ),
      null,
    );
  });

  it("rejects a group with a blank name", () => {
    assert.equal(
      GROUPS_SNAPSHOT_CODEC.decode(
        corrupt(groupsValue, {
          groups: [{ id: "g1", name: "   ", icon: "LayerIcon", position: 0 }],
        }),
      ),
      null,
    );
  });

  it("rejects a non-finite position", () => {
    assert.equal(
      GROUPS_SNAPSHOT_CODEC.decode(
        corrupt(groupsValue, {
          groups: [{ id: "g1", name: "Work", icon: "LayerIcon", position: null }],
        }),
      ),
      null,
    );
  });

  it("rejects more groups than the store can hold", () => {
    const tooMany = Array.from({ length: 101 }, (_value, index) => ({
      id: "g" + index,
      name: "Group",
      icon: "LayerIcon",
      position: index,
    }));
    assert.equal(
      GROUPS_SNAPSHOT_CODEC.decode(corrupt(groupsValue, { groups: tooMany })),
      null,
    );
  });

  it("rejects an assignment naming a group id that cannot exist", () => {
    assert.equal(
      GROUPS_SNAPSHOT_CODEC.decode(
        corrupt(groupsValue, { assignment: { proj_a: "" } }),
      ),
      null,
    );
  });

  it("rejects the reserved key, which a rebuild cannot hold", () => {
    assert.equal(
      GROUPS_SNAPSHOT_CODEC.decode(
        corrupt(groupsValue, { assignment: { ["__proto__"]: "g1" } }),
      ),
      null,
    );
  });

  it("rejects a record missing one of the strip's icons", () => {
    assert.equal(
      GROUPS_SNAPSHOT_CODEC.decode(
        corrupt(groupsValue, { icons: { all: "EyeIcon" } }),
      ),
      null,
    );
  });
});

describe("order snapshot codec", () => {
  it("round trips a full record", () => {
    assert.deepEqual(roundTrip(ORDER_SNAPSHOT_CODEC, orderValue), orderValue);
  });

  it("keeps an empty arrangement, which is a value and not a miss", () => {
    const empty: OrderSnapshot = { projects: {}, families: {}, workspaces: {} };
    assert.deepEqual(roundTrip(ORDER_SNAPSHOT_CODEC, empty), empty);
  });

  it("hands back copies rather than the parsed arrays", () => {
    const decoded = roundTrip(ORDER_SNAPSHOT_CODEC, orderValue);
    assert.notEqual(decoded?.families.proj_a, orderValue.families.proj_a);
  });

  it("rejects a list holding the same id twice", () => {
    assert.equal(
      ORDER_SNAPSHOT_CODEC.decode(
        corrupt(orderValue, { families: { proj_a: ["thr_1", "thr_1"] } }),
      ),
      null,
    );
  });

  it("rejects a scope key that is not a usable id", () => {
    assert.equal(
      ORDER_SNAPSHOT_CODEC.decode(
        corrupt(orderValue, { projects: { "": ["proj_a"] } }),
      ),
      null,
    );
  });

  it("rejects the reserved key, which a rebuild cannot hold", () => {
    assert.equal(
      ORDER_SNAPSHOT_CODEC.decode(
        corrupt(orderValue, { projects: { ["__proto__"]: ["proj_a"] } }),
      ),
      null,
    );
  });

  it("rejects a list that is not an array", () => {
    assert.equal(
      ORDER_SNAPSHOT_CODEC.decode(
        corrupt(orderValue, { families: { proj_a: "thr_1" } }),
      ),
      null,
    );
  });
});

describe("view preferences snapshot codec", () => {
  it("round trips", () => {
    assert.deepEqual(
      roundTrip(VIEW_PREFERENCES_SNAPSHOT_CODEC, viewPreferencesValue),
      viewPreferencesValue,
    );
  });

  it("rejects a sort mode this build does not know", () => {
    assert.equal(
      VIEW_PREFERENCES_SNAPSHOT_CODEC.decode(
        JSON.stringify({ projectSort: "manual", threadSort: "vibes" }),
      ),
      null,
    );
  });

  it("rejects a record missing a field", () => {
    assert.equal(
      VIEW_PREFERENCES_SNAPSHOT_CODEC.decode(
        JSON.stringify({ projectSort: "manual" }),
      ),
      null,
    );
  });

  // A snapshot written before the worktree lens existed. Strict on purpose:
  // the pair below is one frame of warm paint, and the read that replaces it
  // lands immediately, so a record this build cannot fully use is not worth
  // guessing at.
  it("rejects a record from before the worktree lens", () => {
    assert.equal(
      VIEW_PREFERENCES_SNAPSHOT_CODEC.decode(
        JSON.stringify({ projectSort: "name-asc", threadSort: "manual" }),
      ),
      null,
    );
  });

  // The same rule for the field after it: strict, for the same reason.
  it("rejects a record from before the organization mode", () => {
    assert.equal(
      VIEW_PREFERENCES_SNAPSHOT_CODEC.decode(
        JSON.stringify({
          projectSort: "name-asc",
          threadSort: "manual",
          worktreeSort: "manual",
        }),
      ),
      null,
    );
  });

  it("rejects an organization mode this build does not know", () => {
    assert.equal(
      VIEW_PREFERENCES_SNAPSHOT_CODEC.decode(
        JSON.stringify({
          projectSort: "name-asc",
          threadSort: "manual",
          worktreeSort: "manual",
          organizationMode: "by-vibes",
        }),
      ),
      null,
    );
  });
});

describe("workspace paths snapshot codec", () => {
  it("round trips", () => {
    assert.deepEqual(
      roundTrip(WORKSPACE_PATHS_SNAPSHOT_CODEC, workspacePathsValue),
      workspacePathsValue,
    );
  });

  it("keeps an empty map, which is a value and not a miss", () => {
    const empty: WorkspacePaths = { environments: {}, projects: {} };
    assert.deepEqual(roundTrip(WORKSPACE_PATHS_SNAPSHOT_CODEC, empty), empty);
  });

  it("keeps a legitimately absent path as null", () => {
    const decoded = WORKSPACE_PATHS_SNAPSHOT_CODEC.decode(
      corrupt(workspacePathsValue, {
        environments: {
          env_1: {
            ...workspacePathsValue.environments.env_1,
            path: null,
            branchName: null,
          },
        },
      }),
    );
    assert.equal(decoded?.environments.env_1.path, null);
    assert.equal(decoded?.environments.env_1.branchName, null);
  });

  it("drops a field this build does not know", () => {
    const decoded = WORKSPACE_PATHS_SNAPSHOT_CODEC.decode(
      corrupt(workspacePathsValue, {
        environments: {
          env_1: {
            ...workspacePathsValue.environments.env_1,
            futureField: "surprise",
          },
        },
      }),
    );
    assert.deepEqual(Object.keys(decoded!.environments.env_1).sort(), [
      "branchName",
      "hostId",
      "id",
      "isGitRepo",
      "isWorktree",
      "name",
      "path",
      "projectId",
      "providerId",
      "workspaceDisplayKind",
    ]);
  });

  it("rejects an entry whose key disagrees with its own id", () => {
    assert.equal(
      WORKSPACE_PATHS_SNAPSHOT_CODEC.decode(
        corrupt(workspacePathsValue, {
          environments: {
            env_other: workspacePathsValue.environments.env_1,
          },
        }),
      ),
      null,
    );
  });

  it("rejects a path that is a number, which would throw in the classifier", () => {
    assert.equal(
      WORKSPACE_PATHS_SNAPSHOT_CODEC.decode(
        corrupt(workspacePathsValue, {
          environments: {
            env_1: { ...workspacePathsValue.environments.env_1, path: 7 },
          },
        }),
      ),
      null,
    );
  });

  it("rejects a boolean that is not one", () => {
    assert.equal(
      WORKSPACE_PATHS_SNAPSHOT_CODEC.decode(
        corrupt(workspacePathsValue, {
          environments: {
            env_1: { ...workspacePathsValue.environments.env_1, isGitRepo: "yes" },
          },
        }),
      ),
      null,
    );
  });

  it("rejects a display kind this build does not know", () => {
    assert.equal(
      WORKSPACE_PATHS_SNAPSHOT_CODEC.decode(
        corrupt(workspacePathsValue, {
          environments: {
            env_1: {
              ...workspacePathsValue.environments.env_1,
              workspaceDisplayKind: "managed",
            },
          },
        }),
      ),
      null,
    );
  });

  it("rejects the reserved key, which a rebuild cannot hold", () => {
    assert.equal(
      WORKSPACE_PATHS_SNAPSHOT_CODEC.decode(
        corrupt(workspacePathsValue, {
          environments: {
            ["__proto__"]: workspacePathsValue.environments.env_1,
          },
        }),
      ),
      null,
    );
  });

  it("rejects a project entry with no project id", () => {
    assert.equal(
      WORKSPACE_PATHS_SNAPSHOT_CODEC.decode(
        corrupt(workspacePathsValue, {
          projects: { proj_a: { projectId: "", sourcePath: null, sourceHostId: null } },
        }),
      ),
      null,
    );
  });
});

describe("every codec, given junk", () => {
  const codecs = [
    GROUPS_SNAPSHOT_CODEC,
    ORDER_SNAPSHOT_CODEC,
    VIEW_PREFERENCES_SNAPSHOT_CODEC,
    WORKSPACE_PATHS_SNAPSHOT_CODEC,
  ];
  const junk = [
    "",
    "null",
    "undefined",
    "0",
    '"a string"',
    "[]",
    "[1,2,3]",
    "true",
    "{}",
    '{"groups":"nope"}',
    '{"__proto__":{"polluted":true}}',
    '{"groups":[{"id":"g1"}]}',
    "{\u0000:1}",
    "x".repeat(64),
  ];

  it("answers null instead of throwing", () => {
    for (const codec of codecs) {
      for (const stored of junk) {
        assert.equal(codec.decode(stored), null, stored);
      }
    }
  });

  it("does not pollute a prototype through a decoded record", () => {
    for (const codec of codecs) {
      codec.decode('{"__proto__":{"polluted":true},"groups":[],"assignment":{},"icons":{},"projects":{},"families":{},"workspaces":{},"environments":{}}');
    }
    assert.equal(
      ({} as { polluted?: boolean }).polluted,
      undefined,
    );
  });
});

