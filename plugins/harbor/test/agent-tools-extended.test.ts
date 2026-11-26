import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { z } from "zod";

import type { AgentToolDeps, HarborAgentActions } from "../lib/agent/actions.ts";
import { EMPTY_BRIEF } from "../lib/domain/feature-meta.ts";
import type { Feature, FeatureMember } from "../lib/domain/features.ts";
import {
  featureInstructions,
  registerFeatureTools,
  type FeatureAgentPort,
} from "../lib/agent/tools-features.ts";
import { registerFeatureCockpitTools } from "../lib/agent/tools-features-cockpit.ts";
import { registerWriteTools } from "../lib/agent/tools-write.ts";
import { createAgentToolRegistry } from "../lib/agent/toolkit.ts";

interface Registration {
  name: string;
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  execute: (params: unknown, context: { threadId: string; projectId: string }) => Promise<string>;
}

function registryWith(register: (registry: ReturnType<typeof createAgentToolRegistry>) => void) {
  const registrations: Registration[] = [];
  const registry = createAgentToolRegistry({
    bb: {
      agents: {
        registerTool(registration: Registration) {
          registrations.push(registration);
        },
      },
    } as never,
    getTier: () => "full",
  });
  register(registry);
  const tool = (name: string): Registration => {
    const found = registrations.find((registration) => registration.name === name);
    assert.ok(found, `${name} is registered`);
    return found;
  };
  return { tool, registrations };
}

const CONTEXT = { threadId: "thr_1", projectId: "proj_1" };

function actionsWith(overrides: Partial<HarborAgentActions> = {}): {
  deps: AgentToolDeps;
  calls: { name: string; args: unknown[] }[];
} {
  const calls: { name: string; args: unknown[] }[] = [];
  const record = <T,>(name: string, answer: T) => async (...args: unknown[]): Promise<T> => {
    calls.push({ name, args });
    return answer;
  };
  const actions: HarborAgentActions = {
    deleteThreads:
      overrides.deleteThreads ??
      record("delete-threads", {
        preview: {
          token: "tok",
          expiresAt: 0,
          included: [],
          skipped: [],
          rootCount: 0,
          childCount: 0,
          totalThreadCount: 0,
        },
        result: { deleted: [], skipped: [], failed: [] },
      }),
    removeProject: overrides.removeProject ?? record("remove-project", true),
    deleteGroup: overrides.deleteGroup ?? record("delete-group", true),
    removeWorkspace:
      overrides.removeWorkspace ??
      record("remove-workspace", {
        ok: true,
        code: null,
        archivedThreads: true,
        environmentRemoved: true,
        directory: "removed",
        message: null,
      }),
    spawnThread: overrides.spawnThread ?? record("spawn", "thr_new"),
    renameProject: overrides.renameProject ?? record("rename-project", "New"),
    settleThread: overrides.settleThread ?? record("settle", { ok: true, message: null }),
    snoozeThread: overrides.snoozeThread ?? record("snooze", { ok: true, message: null }),
    setThreadPinned: overrides.setThreadPinned ?? record("pin", true),
    renameThread: overrides.renameThread ?? record("rename-thread", true),
    assignProjectToGroup: overrides.assignProjectToGroup ?? record("assign", true),
    createGroup: overrides.createGroup ?? record("create-group", null),
    renameGroup: overrides.renameGroup ?? record("rename-group", true),
    setWorkspaceAlias: overrides.setWorkspaceAlias ?? record("alias", null),
  };
  return { deps: { index: () => null, refreshIndex: async () => undefined, actions }, calls };
}

describe("thread tidying actions via harbor_sidebar_organize", () => {
  it("settles a batch and reports a per-thread refusal", async () => {
    const { deps } = actionsWith({
      settleThread: async (threadId) =>
        threadId === "thr_b"
          ? { ok: false, message: "bb refused." }
          : { ok: true, message: null },
    });
    const { tool } = registryWith((registry) => registerWriteTools(registry, deps));
    const text = await tool("harbor_sidebar_organize").execute(
      { action: "thread_settle", thread_ids: ["thr_a", "thr_b"], settled: true },
      CONTEXT,
    );
    assert.match(text, /thr_a: done/);
    assert.match(text, /thr_b: bb refused\./);
  });

  it("brings settled threads back with settled false", async () => {
    const { deps, calls } = actionsWith();
    const { tool } = registryWith((registry) => registerWriteTools(registry, deps));
    await tool("harbor_sidebar_organize").execute(
      { action: "thread_settle", thread_ids: ["thr_a"], settled: false },
      CONTEXT,
    );
    assert.deepEqual(calls[0], { name: "settle", args: ["thr_a", false] });
  });

  it("reads an ISO time and refuses one in the past without calling bb", async () => {
    const { deps, calls } = actionsWith();
    const { tool } = registryWith((registry) => registerWriteTools(registry, deps));
    const organize = tool("harbor_sidebar_organize");
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await organize.execute(
      { action: "thread_snooze", thread_ids: ["thr_a"], until: future },
      CONTEXT,
    );
    assert.equal(calls[0]?.name, "snooze");
    assert.equal(calls[0]?.args[1], Date.parse(future));

    calls.length = 0;
    const past = await organize.execute(
      { action: "thread_snooze", thread_ids: ["thr_a"], until: "2020-01-01T00:00:00Z" },
      CONTEXT,
    );
    assert.match(past, /in the past/);
    assert.equal(calls.length, 0);

    const nonsense = await organize.execute(
      { action: "thread_snooze", thread_ids: ["thr_a"], until: "tomorrow-ish" },
      CONTEXT,
    );
    assert.match(nonsense, /Could not read/);
    assert.equal(calls.length, 0);
  });

  it("passes null through as unsnooze", async () => {
    const { deps, calls } = actionsWith();
    const { tool } = registryWith((registry) => registerWriteTools(registry, deps));
    await tool("harbor_sidebar_organize").execute(
      { action: "thread_snooze", thread_ids: ["thr_a"], until: null },
      CONTEXT,
    );
    assert.deepEqual(calls[0], { name: "snooze", args: ["thr_a", null] });
  });

  it("pins a batch, defaults to caller thread, and trims titles", async () => {
    const { deps: refusedDeps } = actionsWith({
      setThreadPinned: async (threadId) => threadId !== "thr_b",
    });
    const refusedTool = registryWith((registry) =>
      registerWriteTools(registry, refusedDeps),
    ).tool("harbor_sidebar_organize");

    const text = await refusedTool.execute(
      { action: "thread_pin", thread_ids: ["thr_a", "thr_b"], pinned: true },
      CONTEXT,
    );
    assert.match(text, /thr_a: done/);
    assert.match(text, /thr_b: bb refused\./);

    const { deps, calls } = actionsWith();
    const organize = registryWith((registry) =>
      registerWriteTools(registry, deps),
    ).tool("harbor_sidebar_organize");
    await organize.execute({ action: "thread_pin", pinned: true }, CONTEXT);
    await organize.execute({ action: "thread_rename", title: "  Renamed self  " }, CONTEXT);
    assert.deepEqual(calls, [
      { name: "pin", args: ["thr_1", true] },
      { name: "rename-thread", args: ["thr_1", "Renamed self"] },
    ]);
  });
});

const FEATURE: Feature = {
  id: "f_ai",
  name: "AI",
  slug: "ai",
  state: "active",
  position: 0,
  rootPath: "/home/u/HarborFeatures/ai",
  hostId: "host_1",
};
const MEMBER: FeatureMember = {
  featureId: "f_ai",
  directory: "acme-web",
  path: "/home/u/HarborFeatures/ai/acme-web",
  repository: "acme-web",
  repositoryPath: "/code/acme-web",
  branch: "feat/ai",
  hostId: "host_1",
};

function portWith(overrides: Partial<FeatureAgentPort> = {}): {
  port: FeatureAgentPort;
  calls: { name: string; args: unknown[] }[];
} {
  const calls: { name: string; args: unknown[] }[] = [];
  const port: FeatureAgentPort = {
    locate: () => ({ feature: FEATURE, members: [MEMBER], inRoot: true }),
    features: () => [FEATURE],
    membersOf: () => [MEMBER],
    refLinks: () => [],
    threadPath: async () => FEATURE.rootPath,
    threadEnvironmentId: async () => "env_1",
    projects: async () => [{ id: "prj_api", name: "acme-api" }],
    refresh: async () => undefined,
    create: async (input) => {
      calls.push({ name: "create", args: [input.name ?? "(draft)", input.repositories, input.role ?? "worktree"] });
      return {
        feature: {
          ...FEATURE,
          name: input.name && input.name.trim().length > 0 ? input.name : "Draft · amber-anchor",
        },
        repositories: input.repositories.map((repo) => ({
          repository: repo,
          outcome: "created" as const,
          path: `/home/u/HarborFeatures/ai/${repo}`,
          branch: input.role === "ref" ? null : "feat/ai",
          role: input.role ?? "worktree",
          setup: [],
          reason: null,
        })),
      };
    },
    addRepositories: async () => [],
    rename: async (featureId, name) => {
      calls.push({ name: "rename", args: [featureId, name] });
      return true;
    },
    renameMemberBranch: async (input) => {
      calls.push({ name: "rename-branch", args: [input.featureId, input.directory, input.branch] });
      return { ok: true, reason: null };
    },
    upgradeReferenceRepo: async (input) => {
      calls.push({
        name: "upgrade-ref",
        args: [input.featureId, input.directory, input.branch ?? null, input.baseBranch ?? null],
      });
      return {
        repository: input.directory,
        outcome: "created",
        path: `/home/u/HarborFeatures/ai/${input.directory}`,
        branch: input.branch ?? "feat/ai",
        role: "worktree",
        setup: [],
        reason: null,
      };
    },
    reopen: async (featureId) => {
      calls.push({ name: "reopen", args: [featureId] });
    },
    adopt: async (environmentId, featureId) => {
      calls.push({ name: "adopt", args: [environmentId, featureId] });
      return true;
    },
    deleteFeature: async (input) => {
      calls.push({ name: "delete-feature", args: [input.featureId] });
      return { removedWorktrees: 0, leftovers: [], removedFolder: true };
    },
    removeRepository: async (input) => {
      calls.push({ name: "remove-repo", args: [input.featureId, input.directory] });
      return { removed: true };
    },
    meta: () => ({ brief: EMPTY_BRIEF, refs: [], decisions: [] }),
    setBrief: async (featureId, input) => {
      calls.push({ name: "set-brief", args: [featureId, input] });
      return { ...input, updatedAt: 1 };
    },
    addDecision: async (input) => {
      calls.push({ name: "add-decision", args: [input.featureId, input.title] });
      return {
        id: "d_1",
        featureId: input.featureId,
        seq: 1,
        title: input.title,
        choice: input.choice,
        rationale: input.rationale,
        alternativesRejected: input.alternatives,
        impact: input.impact,
        status: "draft",
        author: "agent",
        threadId: input.threadId,
        supersedes: input.supersedes,
        supersededBy: null,
        createdAt: 0,
      };
    },
    addRef: async (input) => {
      calls.push({ name: "add-ref", args: [input.featureId, input.url] });
      return {
        id: "r_1",
        featureId: input.featureId,
        kind: input.kind ?? "link",
        refId: input.refId ?? null,
        url: input.url ?? null,
        title: input.title ?? input.url ?? "link",
        createdAt: 0,
      };
    },
    park: async (input) => {
      calls.push({
        name: "park",
        args: [input.featureId, input.reason, input.wakeAt, input.wakeOnActivity],
      });
      return {
        ...FEATURE,
        state: "parked",
        parkedAt: 1000,
        parkedReason: input.reason ?? null,
        parkedNote: input.note ?? null,
        wakeAt: input.wakeAt ?? null,
        wakeOnActivity: input.wakeOnActivity ?? false,
      };
    },
    unpark: async (featureId) => {
      calls.push({ name: "unpark", args: [featureId] });
      return { ...FEATURE, state: "active" };
    },
    promote: async (input) => {
      calls.push({
        name: "promote",
        args: [input.environmentId, input.name, input.additionalRepositories?.length ?? 0],
      });
      return {
        feature: { ...FEATURE, name: input.name },
        adoptedEnvironmentId: input.environmentId,
        repositories: [
          {
            repository: "acme-api",
            outcome: "created",
            path: "/home/u/HarborFeatures/ai/acme-api",
            branch: "feat/ai",
            role: "worktree",
            setup: [],
            reason: null,
          },
        ],
      };
    },
    addReferenceRepo: async (input) => {
      calls.push({ name: "add-ref-repo", args: [input.featureId, input.projectId] });
      return {
        repository: "acme-api",
        outcome: "created",
        path: "/home/u/HarborFeatures/ai/acme-api",
        branch: null,
        role: "ref",
        setup: [],
        reason: null,
      };
    },
    getFeatureGitStatus: async (featureId) => {
      calls.push({ name: "git-status", args: [featureId] });
      return {
        featureId,
        additions: 12,
        deletions: 3,
        dirtyRepoCount: 1,
        behindRepoCount: 0,
        unpushedRepoCount: 1,
        repos: [
          {
            directory: "acme-web",
            repository: "acme-web",
            role: "worktree",
            path: MEMBER.path,
            branch: "feat/ai",
            upstream: "origin/feat/ai",
            exists: true,
            stagedFiles: 1,
            unstagedFiles: 1,
            untrackedFiles: 0,
            changedFiles: 2,
            additions: 12,
            deletions: 3,
            aheadCommits: 1,
            behindCommits: 0,
            clean: false,
            lastCommitSubject: "feat: initial work",
            submodules: [{ path: "vendor/sdk", name: "sdk", dirty: false, commit: "abc1234" }],
          },
        ],
      };
    },
    ...overrides,
  };
  return { port, calls };
}

describe("consolidated feature lifecycle tools", () => {
  it("renames, reopens, adopts, and gates delete behind acknowledged", async () => {
    const { port, calls } = portWith();
    const { tool } = registryWith((registry) => registerFeatureCockpitTools(registry, port));
    const lifecycle = tool("harbor_feature_lifecycle");

    const renamed = await lifecycle.execute(
      { action: "rename", name: " AI 助手 " },
      CONTEXT,
    );
    assert.match(renamed, /AI 助手/);
    assert.deepEqual(calls[0], { name: "rename", args: ["f_ai", "AI 助手"] });

    await lifecycle.execute({ action: "reopen", feature_id: "f_done" }, CONTEXT);
    assert.deepEqual(calls[1], { name: "reopen", args: ["f_done"] });

    await lifecycle.execute({ action: "adopt", environment_id: "env_x" }, CONTEXT);
    await lifecycle.execute(
      { action: "adopt", environment_id: "env_x", feature_id: null },
      CONTEXT,
    );
    assert.deepEqual(calls.slice(2), [
      { name: "adopt", args: ["env_x", "f_ai"] },
      { name: "adopt", args: ["env_x", null] },
    ]);

    const previewDel = await lifecycle.execute(
      { action: "delete", feature_id: "f_ai", acknowledged: false },
      CONTEXT,
    );
    assert.match(previewDel, /acknowledged true/);
    assert.equal(calls.length, 4);

    await lifecycle.execute(
      { action: "delete", feature_id: "f_ai", acknowledged: true },
      CONTEXT,
    );
    assert.deepEqual(calls[4], { name: "delete-feature", args: ["f_ai"] });
  });
});

describe("feature brief and meta tools", () => {
  it("reads the requirement and every decision via harbor_feature_brief", async () => {
    const { port, calls } = portWith({
      meta: () => ({
        brief: {
          ...EMPTY_BRIEF,
          goal: "Ship it",
          acceptance: "It works",
          openQuestions: ["Which region?"],
        },
        refs: [
          {
            id: "r_1",
            featureId: "f_ai",
            kind: "ticket",
            refId: "1020",
            url: "https://issues.example.com/1",
            title: "Story",
            createdAt: 1,
          },
        ],
        decisions: [
          {
            id: "d_1",
            featureId: "f_ai",
            seq: 1,
            title: "Keep the old endpoint",
            choice: "For one release",
            rationale: "Callers need time",
            alternativesRejected: ["Remove it now"],
            impact: "",
            status: "draft",
            author: "agent",
            threadId: "thr_1",
            supersedes: null,
            supersededBy: null,
            createdAt: 1,
          },
        ],
      }),
    });
    const { tool } = registryWith((registry) => registerFeatureTools(registry, port));
    const text = await tool("harbor_feature_brief").execute({}, CONTEXT);
    assert.match(text, /Goal: Ship it/u);
    assert.match(text, /Acceptance: It works/u);
    assert.match(text, /Which region\?/u);
    assert.match(text, /#1 \[draft, agent\] Keep the old endpoint/u);
    assert.deepEqual(calls, []);
  });

  it("records decisions and reference links via harbor_feature_meta", async () => {
    const { port, calls } = portWith();
    const { tool } = registryWith((registry) => registerFeatureTools(registry, port));
    const meta = tool("harbor_feature_meta");

    const decisionText = await meta.execute(
      {
        action: "decide",
        title: "Keep the old endpoint",
        choice: "For one release",
        rationale: "Callers need time",
        alternatives: ["Remove it now"],
        impact: "",
        supersedes: 2,
      },
      CONTEXT,
    );
    assert.match(decisionText, /draft #1/u);
    assert.match(decisionText, /overturns #2/u);

    const refText = await meta.execute(
      {
        action: "link",
        kind: "ticket",
        url: "https://issues.example.com/1",
        ref_id: "1020",
        title: "Billing story",
      },
      CONTEXT,
    );
    assert.match(refText, /ticket/u);
    assert.match(refText, /Billing story/u);
    assert.deepEqual(calls, [
      { name: "add-decision", args: ["f_ai", "Keep the old endpoint"] },
      { name: "add-ref", args: ["f_ai", "https://issues.example.com/1"] },
    ]);
  });
});

describe("feature cockpit, repos, and workspace instructions", () => {
  it("parks with a future ISO timer, refuses past dates, and unparks cleanly", async () => {
    const { port, calls } = portWith();
    const { tool } = registryWith((registry) => registerFeatureCockpitTools(registry, port));
    const lifecycle = tool("harbor_feature_lifecycle");
    const future = new Date(Date.now() + 3_600_000).toISOString();

    const ok = await lifecycle.execute(
      {
        action: "park",
        reason: "waiting-qa",
        note: "Wait for QA deploy",
        wake_at: future,
        wake_on_activity: true,
      },
      CONTEXT,
    );
    assert.match(ok, /Parked "AI"/u);
    assert.equal(calls[0]?.name, "park");

    const past = await lifecycle.execute(
      { action: "park", wake_at: "2020-01-01T00:00:00Z" },
      CONTEXT,
    );
    assert.match(past, /in the past/u);

    const woken = await lifecycle.execute({ action: "unpark" }, CONTEXT);
    assert.match(woken, /active again/u);
    assert.equal(calls[1]?.name, "unpark");
  });

  it("reports git status, attaches read-only refs via harbor_feature_repos, and promotes worktrees", async () => {
    const { port, calls } = portWith();
    const { tool } = registryWith((registry) => {
      registerFeatureTools(registry, port);
      registerFeatureCockpitTools(registry, port);
    });

    const status = await tool("harbor_feature_git_status").execute({}, CONTEXT);
    assert.match(status, /\+12\/-3/u);
    assert.match(status, /acme-web\/ \[worktree\] on feat\/ai \(ahead 1, behind 0\)/u);
    assert.match(status, /submodules: sdk/u);

    const refOut = await tool("harbor_feature_repos").execute(
      { action: "add", role: "ref", repositories: ["acme-api"] },
      CONTEXT,
    );
    assert.match(refOut, /read-only reference/u);

    const promoted = await tool("harbor_feature_lifecycle").execute(
      {
        action: "promote",
        name: "Checkout Flow",
        repositories: ["acme-api"],
        base_branch: "main",
      },
      CONTEXT,
    );
    assert.match(promoted, /Promoted workspace to feature "Checkout Flow"/u);
    assert.match(promoted, /kept environment env_1/u);
    assert.equal(calls.at(-1)?.name, "promote");
  });

  it("renders <workspace_folders> XML with readonly attribute for ref members", () => {
    const rendered = featureInstructions({
      feature: { ...FEATURE, name: 'API & "Web" <Sync>' },
      members: [
        MEMBER,
        {
          ...MEMBER,
          directory: "acme-contracts",
          path: "/home/u/HarborFeatures/ai/acme-contracts",
          repository: "acme-contracts",
          branch: null,
          role: "ref",
        },
      ],
      inRoot: true,
    });
    assert.match(rendered, /<workspace_folders>/u);
    assert.match(rendered, /role="root"/u);
    assert.match(rendered, /role="worktree".*directory="acme-web"/u);
    assert.match(rendered, /role="ref" readonly="true".*directory="acme-contracts"/u);
    assert.match(rendered, /name="API &amp; &quot;Web&quot; &lt;Sync&gt;"/u);
  });

  it("gates harbor_feature_repos removal behind acknowledged confirmation", async () => {
    const { port, calls } = portWith();
    const { tool } = registryWith((registry) => registerFeatureTools(registry, port));
    const reposTool = tool("harbor_feature_repos");

    const preview = await reposTool.execute(
      { action: "remove", folder: "acme-web", force: false },
      CONTEXT,
    );
    assert.match(preview, /acknowledged true/u);
    assert.equal(calls.length, 0);

    const confirmed = await reposTool.execute(
      { action: "remove", folder: "acme-web", force: false, acknowledged: true },
      CONTEXT,
    );
    assert.match(confirmed, /Removed acme-web\//u);
    assert.deepEqual(calls[0], { name: "remove-repo", args: ["f_ai", "acme-web"] });
  });

  it("updates brief via harbor_feature_meta and renames or upgrades repos via harbor_feature_repos", async () => {
    const refMember: FeatureMember = {
      ...MEMBER,
      directory: "acme-api",
      repository: "acme-api",
      path: "/home/u/HarborFeatures/ai/acme-api",
      branch: null,
      role: "ref",
    };
    const { port, calls } = portWith({
      membersOf: () => [MEMBER, refMember],
      meta: () => ({
        brief: { ...EMPTY_BRIEF, nonGoals: "Keep existing notes" },
        refs: [],
        decisions: [],
      }),
    });
    const { tool } = registryWith((registry) => registerFeatureTools(registry, port));

    const briefRes = await tool("harbor_feature_meta").execute(
      { action: "brief", goal: "Unify notification pipeline", acceptance: "E2E passes" },
      CONTEXT,
    );
    assert.match(briefRes, /Updated feature brief \(goal, acceptance\)/u);
    assert.deepEqual(calls[0], {
      name: "set-brief",
      args: [
        "f_ai",
        {
          goal: "Unify notification pipeline",
          nonGoals: "Keep existing notes",
          acceptance: "E2E passes",
          notes: "",
          openQuestions: [],
          blockers: [],
        },
      ],
    });

    const renamed = await tool("harbor_feature_repos").execute(
      { action: "rename_branch", folder: "acme-web", branch: "feat/notify-v2" },
      CONTEXT,
    );
    assert.match(renamed, /Renamed branch in acme-web\/ to "feat\/notify-v2"/u);

    const upgraded = await tool("harbor_feature_repos").execute(
      { action: "upgrade_ref", folder: "acme-api", branch: "feat/notify-api" },
      CONTEXT,
    );
    assert.match(upgraded, /acme-api: added .* on feat\/notify-api/u);
    assert.deepEqual(
      calls.slice(1).map((c) => c.name),
      ["rename-branch", "upgrade-ref"],
    );
  });

  it("supports draft creation without name and coordinated update_info in harbor_feature_lifecycle", async () => {
    const refMember: FeatureMember = {
      ...MEMBER,
      directory: "acme-api",
      repository: "acme-api",
      path: "/home/u/HarborFeatures/ai/acme-api",
      branch: null,
      role: "ref",
    };
    const { port, calls } = portWith({
      membersOf: () => [MEMBER, refMember],
    });
    const { tool } = registryWith((registry) => registerFeatureCockpitTools(registry, port));
    const lifecycle = tool("harbor_feature_lifecycle");

    const draft = await lifecycle.execute(
      { action: "create", repositories: ["acme-api"], role: "ref" },
      CONTEXT,
    );
    assert.match(draft, /Draft · amber-anchor/u);
    assert.deepEqual(calls[0], { name: "create", args: ["(draft)", ["prj_api"], "ref"] });

    calls.length = 0;
    const updated = await lifecycle.execute(
      {
        action: "update_info",
        name: "Order Notify V2",
        goal: "Replace webhook polling",
        ref_url: "https://issues.example.com/202",
        ref_title: "PRD 202",
        branch: "feat/order-notify-v2",
        initialize_refs: true,
      },
      CONTEXT,
    );
    assert.match(updated, /Feature renamed: "AI" -> "Order Notify V2"/u);
    assert.match(updated, /Requirement brief updated \(goal\)/u);
    assert.match(updated, /Linked link: "PRD 202"/u);
    assert.match(updated, /acme-web\/: branch renamed to feat\/order-notify-v2/u);
    assert.match(updated, /acme-api: added .* on feat\/order-notify-v2/u);
    assert.deepEqual(
      calls.map((c) => c.name),
      ["rename", "set-brief", "add-ref", "rename-branch", "upgrade-ref"],
    );
  });

  it("includes draft & update_info guidance in featureInstructions under full access", () => {
    const rendered = featureInstructions(
      {
        feature: { ...FEATURE, name: "Draft · calm-cove" },
        members: [
          {
            ...MEMBER,
            directory: "acme-web",
            branch: null,
            role: "ref",
          },
        ],
        inRoot: true,
      },
      { tier: "full" },
    );
    assert.match(rendered, /Draft\/discussion mode:/u);
    assert.match(rendered, /harbor_feature_lifecycle\(action='update_info'\)/u);
  });
});
