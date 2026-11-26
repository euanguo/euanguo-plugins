/**
 * The wire schemas that mirror a domain type, checked at run time.
 *
 * The binding itself is a compile-time gate: each schema in
 * `server/contract-schemas.ts` carries `satisfies z.ZodType<T>`, so a required
 * field added to one of those types fails `typecheck` until the schema learns
 * it. An optional field is not forced by that gate, so it has to be added to
 * the schema deliberately; the cases below cover the fields that matter on the
 * wire. What the gate also cannot catch is a schema that is *looser* than its
 * type — a required field that is nullable, or an enum that became a plain
 * string — so these cases parse one representative object and then reject a
 * missing field and a wrong type for every bound schema.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  featureMemberSchema,
  featureSchema,
  repositoryResultSchema,
} from "../lib/schemas/feature.ts";
import { appearancePatchSchema, appearanceSchema } from "../lib/schemas/settings.ts";
import {
  recoveryThreadRowSchema,
  settledThreadRowSchema,
  threadRowSchema,
} from "../lib/schemas/sidebar.ts";
import {
  batchRemoveWorktreesResultSchema,
  batchWorktreeSurveyItemSchema,
  repoFactsSchema,
  workspaceEnvironmentDescriptorSchema,
  workspaceRemovalOutcomeSchema,
  worktreeSurveySchema,
} from "../lib/schemas/workspace.ts";
import { APPEARANCE_DEFAULTS } from "../lib/domain/appearance.ts";

/**
 * The subset of zod's schema surface these cases need. Typing it here keeps the
 * table below free of the schema's inferred generics.
 */
interface SafeParsing {
  safeParse(value: unknown): { success: boolean; data?: unknown };
}

const FEATURE = {
  id: "feat_1",
  name: "Wire the schemas",
  slug: "wire-the-schemas",
  state: "active",
  position: 1,
  rootPath: "/Users/example/features/wire-the-schemas",
  hostId: "host_1",
};

const FEATURE_MEMBER = {
  featureId: "feat_1",
  directory: "acme-app",
  path: "/Users/example/features/wire-the-schemas/acme-app",
  repository: "acme-app",
  repositoryPath: "/Users/example/Code/acme-app",
  branch: "feat/wire-the-schemas",
  hostId: "host_1",
};

const REPOSITORY_RESULT = {
  projectId: "prj_1",
  repository: "acme-app",
  outcome: "created",
  path: "/Users/example/features/wire-the-schemas/acme-app",
  branch: "feat/wire-the-schemas",
  setup: ["npm install"],
  reason: null,
};

const WORKTREE_SURVEY = {
  path: "/Users/example/Code/sample-plugins",
  hostId: "host_1",
  branch: "feat/harbor-workspaces",
  bbOwned: true,
  gitWorktree: true,
  directoryExists: true,
  mainRepoPath: "/Users/example/Code/sample-plugins",
  changedFiles: 3,
  untrackedFiles: 1,
  aheadCommits: 2,
  baseRef: "origin/main",
  threads: 4,
  liveThreads: 1,
  openTerminals: 0,
};

const WORKSPACE_REMOVAL_OUTCOME = {
  ok: true,
  code: null,
  archivedThreads: true,
  environmentRemoved: true,
  directory: "removed",
  message: null,
};

const REPO_FACTS = {
  repos: [
    {
      key: "ws:host_1:/Users/example/Code/acme-app",
      kind: "git-remote",
      name: "acme-app",
      remoteUrl: "git@github.com:example/acme-app.git",
      rootPath: "/Users/example/Code/acme-app",
      hostIds: ["host_1"],
      projectIds: ["prj_1"],
      workspaces: [
        {
          key: "ws:host_1:/Users/example/Code/acme-app",
          hostId: "host_1",
          path: "/Users/example/Code/acme-app",
          rawPaths: ["/Users/example/Code/acme-app"],
          aliases: ["/private/Users/example/Code/acme-app"],
          environmentIds: ["env_1"],
          projectIds: ["prj_1"],
          repoKey: "ws:host_1:/Users/example/Code/acme-app",
          isMainWorktree: true,
          isLinkedWorktree: false,
          isNestedRepository: false,
          repositoryRoot: "/Users/example/Code/acme-app",
        },
      ],
      unseenWorktrees: [
        {
          hostId: "host_1",
          path: "/Users/example/Code/acme-app-2",
          branch: "feat/other",
          head: "0123456",
          detached: false,
          prunable: false,
        },
      ],
      diagnostics: [
        {
          code: "unseen-worktree",
          repoKey: "ws:host_1:/Users/example/Code/acme-app",
          subjects: ["/Users/example/Code/acme-app-2"],
          message: "The repository records a worktree bb has no environment for.",
        },
      ],
    },
  ],
  diagnostics: [],
  repoKeyByProject: { prj_1: "ws:host_1:/Users/example/Code/acme-app" },
  sourceRepoKeyByProject: { prj_1: "ws:host_1:/Users/example/Code/acme-app" },
  workspaceOwnership: {
    env_1: {
      environmentId: "env_1",
      claimedProjectId: "prj_1",
      ownerProjectId: "prj_1",
      workspaceKey: "ws:host_1:/Users/example/Code/acme-app",
      repoKey: "ws:host_1:/Users/example/Code/acme-app",
      kind: "project-checkout",
      confidence: "exact-source",
      conflict: false,
    },
  },
  unseenWorkspaces: {
    prj_1: [
      {
        projectId: "prj_1",
        repoKey: "ws:host_1:/Users/example/Code/acme-app",
        hostId: "host_1",
        path: "/Users/example/Code/acme-app-2",
        branch: "feat/other",
        detached: false,
      },
    ],
  },
  unavailableHostIds: [],
};

const THREAD_ROW = {
  id: "thr_1",
  projectId: "prj_1",
  title: "Wire the schemas",
  titleFallback: null,
  parentThreadId: null,
  sectionId: null,
  originKind: null,
  originPluginId: null,
  providerId: "provider_1",
  status: "idle",
  hasPendingInteraction: false,
  isPinned: false,
  activity: {
    workflows: 0,
    backgroundAgents: 0,
    backgroundCommands: 0,
    planMode: 0,
  },
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
  lastReadAt: null,
  latestAttentionAt: 1_700_000_001_000,
};

const RECOVERY_THREAD = {
  ...THREAD_ROW,
  environment: {
    id: "env_1",
    name: "sample-plugins",
    branchName: "feat/harbor-workspaces",
    providerId: "provider_1",
    workspaceDisplayKind: "managed-worktree",
  },
  host: { id: "host_1", name: "This machine" },
};

const SETTLED_THREAD = { ...THREAD_ROW, settledAt: 1_700_000_002_000 };

const WORKSPACE_DESCRIPTOR = {
  id: "env_1",
  projectId: "prj_1",
  hostId: "host_1",
  path: "/Users/example/Code/acme-app",
  isGitRepo: true,
  isWorktree: true,
  branchName: "feat/harbor-workspaces",
  name: "my-worktree",
  providerId: "provider_1",
  workspaceDisplayKind: "managed-worktree",
  managed: true,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
  providerInstanceKey: "git-worktree:env_1",
  dangling: false,
};

const BATCH_SURVEY_ITEM = {
  environmentId: "env_1",
  ok: true,
  survey: WORKTREE_SURVEY,
  plan: {
    threadCount: 4,
    liveThreadCount: 1,
    directory: {
      via: "git",
      warnings: [{ kind: "discard", text: "3 changed files will be lost" }],
      refusal: null,
    },
  },
  digest: "digest_1",
  dirty: true,
  blockedReason: "3 changed files",
  error: null,
};

const BATCH_REMOVE_RESULT = {
  items: [
    {
      environmentId: "env_1",
      status: "removed",
      outcome: WORKSPACE_REMOVAL_OUTCOME,
      reason: null,
    },
  ],
  removedCount: 1,
  skippedCount: 0,
  failedCount: 0,
};

interface BoundSchema {
  readonly name: string;
  readonly schema: SafeParsing;
  readonly valid: Record<string, unknown>;
  /** A field the domain type declares: leaving it out must fail. */
  readonly requiredField: string;
  /** One field replaced with a value of the wrong type. */
  readonly wrongType: Record<string, unknown>;
}

const BOUND_SCHEMAS: readonly BoundSchema[] = [
  {
    name: "featureSchema",
    schema: featureSchema,
    valid: FEATURE,
    requiredField: "slug",
    wrongType: { position: "first" },
  },
  {
    name: "featureMemberSchema",
    schema: featureMemberSchema,
    valid: FEATURE_MEMBER,
    requiredField: "branch",
    wrongType: { path: 42 },
  },
  {
    name: "repositoryResultSchema",
    schema: repositoryResultSchema,
    valid: REPOSITORY_RESULT,
    requiredField: "outcome",
    wrongType: { setup: "npm install" },
  },
  {
    name: "worktreeSurveySchema",
    schema: worktreeSurveySchema,
    valid: WORKTREE_SURVEY,
    requiredField: "gitWorktree",
    wrongType: { changedFiles: "3" },
  },
  {
    name: "workspaceRemovalOutcomeSchema",
    schema: workspaceRemovalOutcomeSchema,
    valid: WORKSPACE_REMOVAL_OUTCOME,
    requiredField: "directory",
    wrongType: { directory: "gone" },
  },
  {
    name: "repoFactsSchema",
    schema: repoFactsSchema,
    valid: REPO_FACTS,
    requiredField: "repoKeyByProject",
    wrongType: { unavailableHostIds: "host_1" },
  },
  {
    name: "threadRowSchema",
    schema: threadRowSchema,
    valid: THREAD_ROW,
    requiredField: "providerId",
    wrongType: { activity: { ...THREAD_ROW.activity, workflows: "0" } },
  },
  {
    name: "recoveryThreadRowSchema",
    schema: recoveryThreadRowSchema,
    valid: RECOVERY_THREAD,
    requiredField: "providerId",
    wrongType: { environment: { ...RECOVERY_THREAD.environment, id: 1 } },
  },
  {
    name: "settledThreadRowSchema",
    schema: settledThreadRowSchema,
    valid: SETTLED_THREAD,
    requiredField: "settledAt",
    wrongType: { settledAt: "now" },
  },
  {
    name: "workspaceEnvironmentDescriptorSchema",
    schema: workspaceEnvironmentDescriptorSchema,
    valid: WORKSPACE_DESCRIPTOR,
    requiredField: "isWorktree",
    wrongType: { managed: "yes" },
  },
  {
    name: "batchWorktreeSurveyItemSchema",
    schema: batchWorktreeSurveyItemSchema,
    valid: BATCH_SURVEY_ITEM,
    requiredField: "dirty",
    wrongType: { dirty: "yes" },
  },
  {
    name: "batchRemoveWorktreesResultSchema",
    schema: batchRemoveWorktreesResultSchema,
    valid: BATCH_REMOVE_RESULT,
    requiredField: "removedCount",
    wrongType: { removedCount: "1" },
  },
];

describe("wire schemas bound to their domain type", () => {
  for (const { name, schema, valid, requiredField, wrongType } of BOUND_SCHEMAS) {
    it(`parses a representative ${name}`, () => {
      const parsed = schema.safeParse(valid);
      assert.equal(parsed.success, true);
      // Nothing the domain sends is dropped: the parsed row is the input row.
      assert.deepEqual(parsed.data, valid);
    });

    it(`rejects a ${name} missing ${requiredField}`, () => {
      const value: Record<string, unknown> = structuredClone(valid);
      delete value[requiredField];
      assert.equal(schema.safeParse(value).success, false);
    });

    it(`rejects a ${name} with a wrong type`, () => {
      const value = { ...structuredClone(valid), ...wrongType };
      assert.equal(schema.safeParse(value).success, false);
    });
  }
});

describe("appearanceSchema", () => {
  it("parses complete and empty (default-filled) appearance:v2 records", () => {
    const full = appearanceSchema.safeParse(APPEARANCE_DEFAULTS);
    assert.equal(full.success, true);
    assert.deepEqual(full.data, APPEARANCE_DEFAULTS);

    const defaulted = appearanceSchema.safeParse({});
    assert.equal(defaulted.success, true);
    assert.deepEqual(defaulted.data, APPEARANCE_DEFAULTS);
  });

  it("rejects removed Custom palette, out-of-bounds pageSize, and control characters", () => {
    assert.equal(
      appearanceSchema.partial().safeParse({ palettePreset: "Custom" }).success,
      false,
    );
    assert.equal(
      appearanceSchema.partial().safeParse({ pageSize: 0 }).success,
      false,
    );
    assert.equal(
      appearanceSchema.partial().safeParse({ pageSize: 101 }).success,
      false,
    );
    assert.equal(
      appearanceSchema.partial().safeParse({ pageSize: 12.5 }).success,
      false,
    );
    assert.equal(
      appearanceSchema.partial().safeParse({ featureBranchTemplate: "   " })
        .success,
      false,
    );
    assert.equal(
      appearanceSchema
        .partial()
        .safeParse({ featureDefaultBase: "main\nfoo" }).success,
      false,
    );
    assert.equal(
      appearanceSchema
        .partial()
        .safeParse({
          featureRowShowRepoCount: false,
          featureRowShowDisclosure: false,
        }).success,
      true,
    );
    assert.equal(
      appearanceSchema.partial().safeParse({ featureRowShowHub: "no" }).success,
      false,
    );
  });

  it("keeps only the explicitly provided keys in an appearance patch", () => {
    assert.deepEqual(
      appearancePatchSchema.parse({ featureRowShowRepoCount: false }),
      { featureRowShowRepoCount: false },
    );
    assert.deepEqual(
      appearancePatchSchema.parse({ featureRowShowHub: false }),
      { featureRowShowHub: false },
    );
    assert.equal(
      appearancePatchSchema.safeParse({ featureRowShowHub: "no" }).success,
      false,
    );
  });
});
