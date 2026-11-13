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
  recoveryThreadRowSchema,
  repositoryResultSchema,
  repoFactsSchema,
  settledThreadRowSchema,
  threadRowSchema,
  workspaceRemovalOutcomeSchema,
  worktreeSurveySchema,
} from "../server/contract-schemas.ts";

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
  rootPath: "/Users/wyatt/features/wire-the-schemas",
  hostId: "host_1",
};

const FEATURE_MEMBER = {
  featureId: "feat_1",
  directory: "tea-app",
  path: "/Users/wyatt/features/wire-the-schemas/tea-app",
  repository: "tea-app",
  repositoryPath: "/Users/wyatt/Code/tea-app",
  branch: "feat/wire-the-schemas",
  hostId: "host_1",
};

const REPOSITORY_RESULT = {
  projectId: "prj_1",
  repository: "tea-app",
  outcome: "created",
  path: "/Users/wyatt/features/wire-the-schemas/tea-app",
  branch: "feat/wire-the-schemas",
  setup: ["npm install"],
  reason: null,
};

const WORKTREE_SURVEY = {
  path: "/Users/wyatt/Code/euanguo-plugins",
  hostId: "host_1",
  branch: "feat/nest-workspaces",
  bbOwned: true,
  gitWorktree: true,
  directoryExists: true,
  mainRepoPath: "/Users/wyatt/Code/euanguo-plugins",
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
  blocker: null,
  archivedThreads: true,
  environmentRemoved: true,
  directory: "removed",
  message: null,
};

const REPO_FACTS = {
  repos: [
    {
      key: "ws:host_1:/Users/wyatt/Code/tea-app",
      kind: "git-remote",
      name: "tea-app",
      remoteUrl: "git@github.com:euanguo/tea-app.git",
      rootPath: "/Users/wyatt/Code/tea-app",
      hostIds: ["host_1"],
      projectIds: ["prj_1"],
      workspaces: [
        {
          key: "ws:host_1:/Users/wyatt/Code/tea-app",
          hostId: "host_1",
          path: "/Users/wyatt/Code/tea-app",
          rawPaths: ["/Users/wyatt/Code/tea-app"],
          aliases: ["/private/Users/wyatt/Code/tea-app"],
          environmentIds: ["env_1"],
          projectIds: ["prj_1"],
          repoKey: "ws:host_1:/Users/wyatt/Code/tea-app",
          isMainWorktree: true,
          isLinkedWorktree: false,
          isNestedRepository: false,
          repositoryRoot: "/Users/wyatt/Code/tea-app",
        },
      ],
      unseenWorktrees: [
        {
          hostId: "host_1",
          path: "/Users/wyatt/Code/tea-app-2",
          branch: "feat/other",
          head: "0123456",
          detached: false,
          prunable: false,
        },
      ],
      diagnostics: [
        {
          code: "unseen-worktree",
          repoKey: "ws:host_1:/Users/wyatt/Code/tea-app",
          subjects: ["/Users/wyatt/Code/tea-app-2"],
          message: "The repository records a worktree bb has no environment for.",
        },
      ],
    },
  ],
  diagnostics: [],
  repoKeyByProject: { prj_1: "ws:host_1:/Users/wyatt/Code/tea-app" },
  sourceRepoKeyByProject: { prj_1: "ws:host_1:/Users/wyatt/Code/tea-app" },
  workspaceOwnership: {
    env_1: {
      environmentId: "env_1",
      claimedProjectId: "prj_1",
      ownerProjectId: "prj_1",
      workspaceKey: "ws:host_1:/Users/wyatt/Code/tea-app",
      repoKey: "ws:host_1:/Users/wyatt/Code/tea-app",
      kind: "project-checkout",
      confidence: "exact-source",
      conflict: false,
    },
  },
  unseenWorkspaces: {
    prj_1: [
      {
        projectId: "prj_1",
        repoKey: "ws:host_1:/Users/wyatt/Code/tea-app",
        hostId: "host_1",
        path: "/Users/wyatt/Code/tea-app-2",
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
    name: "euanguo-plugins",
    branchName: "feat/nest-workspaces",
    providerId: "provider_1",
    workspaceDisplayKind: "managed-worktree",
  },
  host: { id: "host_1", name: "This machine" },
};

const SETTLED_THREAD = { ...THREAD_ROW, settledAt: 1_700_000_002_000 };

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
