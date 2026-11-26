// The server entry point wires storage, host reads, RPC handlers, scheduling,
// and agent tools. Domain rules stay in lib, and each RPC subject lives under
// server/rpc.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

// Relative, not the `@/` alias the frontend uses: bb loads this file directly
// as a path source, so nothing rewrites tsconfig paths for it.
import {
  PROJECT_COLOR_MIGRATION,
  createProjectColorStore,
} from "./lib/stores/project-color-store.ts";
import {
  PROJECT_ICON_MIGRATION,
  createProjectIconStore,
} from "./lib/stores/project-icon-store.ts";
import {
  MAX_FACTS_PATHS,
  worktreeDirectoryContract,
} from "./host/contract.ts";
import {
  GROUP_ASSIGNMENT_MIGRATION,
  GROUP_MIGRATION,
  createGroupStore,
} from "./lib/stores/group-store.ts";
import { MANUAL_ORDER_MIGRATION, createOrderStore } from "./lib/stores/order-store.ts";
import type { OrderWrite } from "./lib/stores/order-store.ts";
import {
  ORDER_REVISION_MIGRATION,
  ORDER_REVISION_SEED,
} from "./lib/stores/order-store.ts";
import {
  VIEW_PREFERENCE_MIGRATION,
  createViewPreferenceStore,
} from "./lib/stores/view-preference-store.ts";
import { migrateFromNestDatabase } from "./lib/stores/nest-migration.ts";
import {
  LIFECYCLE_CHANNEL,
  ORDER_CHANNEL,
} from "./lib/realtime-channels.ts";
import { createRepoFactsCache, type WorkspaceProbe } from "./lib/stores/repo-facts.ts";
import { createAgentAccessStore } from "./lib/stores/agent-access-store.ts";
import {
  SIDEBAR_INDEX_MIGRATION,
  createSidebarIndexCache,
} from "./lib/agent/index-cache.ts";
import { wireAgentTools } from "./lib/agent/wire.ts";
import type { AgentToolDeps } from "./lib/agent/actions.ts";

const SCOPE_ICON_MIGRATION = `CREATE TABLE IF NOT EXISTS scope_icons (
  scope_key  TEXT PRIMARY KEY,
  icon       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

const migrations = [
  // bb's archive cascades to child threads and reports every id it took,
  // stored alongside the row so un-settling restores children too.
  `CREATE TABLE IF NOT EXISTS thread_lifecycle (
     thread_id           TEXT PRIMARY KEY,
     settled_at          INTEGER,
     snoozed_until       INTEGER,
     snoozed_at          INTEGER,
     archived_thread_ids TEXT
   )`,
  PROJECT_COLOR_MIGRATION,
  GROUP_MIGRATION,
  GROUP_ASSIGNMENT_MIGRATION,
  MANUAL_ORDER_MIGRATION,
  VIEW_PREFERENCE_MIGRATION,
  SCOPE_ICON_MIGRATION,
  PROJECT_ICON_MIGRATION,
  ORDER_REVISION_MIGRATION,
  SIDEBAR_INDEX_MIGRATION,
  ...FEATURE_REPOSITORY_MIGRATIONS,
];

// The RPC surface lives in `server/contract.ts` — it is the whole file there,
// which is what lets a handler and the shape it promises be read together.
import { createThreadReader } from "./server/thread-reader.ts";
import { createLifecycleService } from "./server/lifecycle-service.ts";
import { createHarborAgentActions } from "./server/agent-actions.ts";
import { createBulkDeleteService } from "./server/bulk-delete-service.ts";
import { createWorktreeRemovalService } from "./server/worktree-removal-service.ts";
import { createProjectService } from "./server/project-service.ts";
import {
  createWorkspaceService,
  WORKTREE_REMOVAL_TIMEOUT_MS,
} from "./server/workspace-service.ts";
import { createSidebarIndexService } from "./server/sidebar-index-service.ts";
import { FEATURE_REPOSITORY_MIGRATIONS } from "./lib/stores/feature-repository.ts";
import { wireFeatures } from "./server/feature/wiring.ts";
import { createAppearanceStore } from "./lib/stores/appearance-store.ts";
import { settingsHandlers } from "./server/rpc/settings.ts";
import { sidebarHandlers } from "./server/rpc/sidebar.ts";
import { workspaceHandlers } from "./server/rpc/workspaces.ts";
import { harborRpcContract } from "./server/contract.ts";

/**
 * A `realpath` and a few small reads per directory, over a whole sidebar.
 *
 * Longer than the icon probe because it is one call for every workspace rather
 * than one call for one checkout, and still short enough that a machine which is
 * not going to answer does not hold the first frame.
 */
const WORKSPACE_FACTS_TIMEOUT_MS = 15_000;

export default function plugin(bb: BbPluginApi) {
  const agentAccess = createAgentAccessStore(bb);
  const appearance = createAppearanceStore(bb);

  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);
  // The counter's single row. `INSERT OR IGNORE` so a database that already has
  // it — every one after the first boot on this build — is left alone.
  db.prepare(ORDER_REVISION_SEED).run();
  migrateFromNestDatabase(db, {
    log: (message) => bb.log.info(message),
  });
  const projectColors = createProjectColorStore(db);
  const projectIcons = createProjectIconStore(db);
  const groups = createGroupStore(db);
  const orders = createOrderStore(db);
  const viewPreferences = createViewPreferenceStore(db);
  const threadReader = createThreadReader(bb);
  const worktreeHost = bb.hosts.experimental_client({
    contract: worktreeDirectoryContract,
  });
  const workspaceService = createWorkspaceService({
    bb,
    removeViaGit: (args) =>
      worktreeHost.call(
        "removeWorktree",
        { path: args.path, mainRepoPath: args.mainRepoPath },
        {
          hostId: args.hostId,
          timeoutMs: WORKTREE_REMOVAL_TIMEOUT_MS,
        },
      ),
  });

  /**
   * The one worktree-removal implementation, shared by the RPC and the agent
   * tools so both survey twice and follow the same archive-before-delete order.
   */
  const worktreeRemoval = createWorktreeRemovalService({
    bb,
    surveyWorktree: workspaceService.surveyWorktree,
    removeWorktreeDirectory: workspaceService.removeWorktreeDirectory,
    invalidateFacts: () => repoFacts.invalidate(),
  });

  /**
   * What each machine last said about the directories it holds.
   *
   * The probe is the only place this plugin asks a machine something bb cannot
   * answer, and it is deliberately not fatal: a machine that does not reply
   * leaves the workspaces on it placed by their paths alone, which the tree
   * draws and the diagnostics say is unverified.
   */
  const probeWorkspaceFacts: WorkspaceProbe = async (hostId, paths) => {
    const facts = [];
    for (let start = 0; start < paths.length; start += MAX_FACTS_PATHS) {
      const chunk = paths.slice(start, start + MAX_FACTS_PATHS);
      const answer = await worktreeHost.call(
        "resolveWorkspaceFacts",
        { paths: chunk },
        { hostId, timeoutMs: WORKSPACE_FACTS_TIMEOUT_MS },
      );
      for (const fact of answer.facts) {
        facts.push({ ...fact, hostId });
      }
    }
    return facts;
  };
  const repoFacts = createRepoFactsCache({ probe: probeWorkspaceFacts });

  /**
   * The four writes an agent and the sidebar's own menus share.
   *
   * One seam rather than two implementations of "file this project under that
   * group". Two would be two places for the publish to be forgotten, and the
   * symptom is the one thing a user will not forgive — a click that appears to do
   * nothing, or a list that changes without being asked.
   *
   * `createGroup` answers null where the store throws, because a tool has to say
   * what happened and the sidebar's own dialog already has a message for it.
   */
  const lifecycleService = createLifecycleService({ bb, db });
  const {
    readAll,
    readOne,
    clear,
    settleThread,
    unsettleThread,
    snoozeThread,
  } = lifecycleService;

  const { projectSource } = workspaceService;
  const featureWiring = wireFeatures({ db, bb, worktreeHost, projectSource, lifecycle: lifecycleService });

  /**
   * The sidebar's own state, written down where a synchronous callback can read it.
   *
   * `bb.agents.contributeInstructions` and `bb.agents.configure` both run on the
   * thread-start path and both must be synchronous, and both need things that
   * only come back from an await. This is the answer: refreshed by every read the
   * server already performs, and by a prime at load so the first thread of a
   * session is not told nothing.
   */
  const sidebarIndex = createSidebarIndexCache(db);
  const sidebarIndexService = createSidebarIndexService({
    bb,
    groups,
    repoFacts,
    index: sidebarIndex,
    featureStore: featureWiring.store,
    featureMembers: () => featureWiring.service.snapshot().members,
  });
  const {
    readWorkspaceDescriptors,
    refresh: refreshSidebarIndex,
  } = sidebarIndexService;

  const bulkDelete = createBulkDeleteService({
    bb,
    threads: threadReader,
  });

  /**
   * Project and group writes share one service, so a click and an agent tool
   * cannot disagree about publishing or refreshing the materialized index.
   */
  const projectService = createProjectService({
    bb,
    groups,
    orders,
    refreshIndex: refreshSidebarIndex,
  });

  const harborAgentActions = createHarborAgentActions({
    bb,
    projects: projectService,
    lifecycle: lifecycleService,
    bulkDelete,
    removal: worktreeRemoval,
    refreshIndex: refreshSidebarIndex,
  });

  const agentDeps: AgentToolDeps = {
    index: () => sidebarIndex.read(),
    refreshIndex: () => refreshSidebarIndex(),
    actions: harborAgentActions,
  };

  const orderOutcome = (result: OrderWrite) => {
    if (result.ok) bb.realtime.publish(ORDER_CHANNEL, {});
    if (result.ok) bb.rpc?.experimental_invalidate?.(["order"]);
    return {
      ok: result.ok,
      stale: !result.ok && result.reason === "stale",
      revision: result.revision,
    };
  };

  /**
   * The environment and project records both workspace-level reads describe.
   *
   * One mapper, because the two reads are about the same two tables: a second
   * copy would be a second place for a field to be forgotten, and a workspace
   * classified from a field that is always undefined is drawn wrong rather than
   * not drawn.
   */
  bb.rpc.register(harborRpcContract, {
    ...settingsHandlers({
      bb,
      appearance,
      viewPreferences,
      agentAccess,
      projectColors,
      projectIcons,
      worktreeHost,
      projectSource,
    }),
    ...sidebarHandlers({
      bb,
      groups,
      projects: projectService,
      orders,
      orderOutcome,
      readAll,
      settleThread,
      unsettleThread,
      snoozeThread,
      threads: threadReader,
      listVisibleThreadRows: () => threadReader.listVisibleThreadRows(),
      bulkDelete,
    }),
    ...workspaceHandlers({
      bb,
      projects: projectService,
      harborAgentActions,
      readWorkspaceDescriptors,
      refreshSidebarIndex,
      removal: worktreeRemoval,
    }),
    ...featureWiring.handlers,
  });

  // A deleted thread must not leave a row behind that would park a future
  // thread reusing the id, and stale rows accumulate otherwise.
  bb.events.on("thread.deleted", ({ thread }) => {
    clear(thread.id);
  });

  /**
   * The settled shelf's heartbeat.
   *
   * An archived thread is invisible to the host's sidebar view, so no host
   * update can tell the frontend that a settled thread started working or
   * finished a turn. Without this the un-settle rule — new attention brings a
   * thread back — would never fire again for anything on the shelf. A publish
   * only asks the frontend to re-read; the decision stays where it was.
   */
  const onThreadActivity = ({ thread }: { thread: { id: string } }) => {
    void featureWiring.service.handleThreadActivity(thread.id);
    if (readOne(thread.id)?.settledAt == null) return;
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId: thread.id });
  };
  bb.events.on("thread.active", onThreadActivity);
  bb.events.on("thread.idle", onThreadActivity);
  bb.events.on("thread.failed", onThreadActivity);
  bb.onDispose(() => featureWiring.service.dispose());

  /**
   * Harbor in front of agents: the map they can read, the four writes they may
   * make, and the summary every thread is told.
   *
   * Registered last because it is the one part of the plugin that is optional at
   * runtime: everything above is the sidebar, and this is a surface on top of it.
   */
  const agentTools = wireAgentTools({
    bb,
    getTier: () => agentAccess.current(),
    deps: agentDeps,
    features: featureWiring.agentPort,
    spawn: featureWiring.spawnPort,
  });

  /**
   * Prime the index so the first thread of a session is told about the sidebar
   * rather than about the fact that nothing has been read yet.
   *
   * Deliberately not awaited: it is a round trip to every machine holding a
   * workspace, and the plugin's own load should not wait on one. Until it lands,
   * the instruction provider contributes a sentence saying so, and the map tool
   * says the same thing — both true, neither wrong.
   */
  /**
   * Prime the index, and keep trying until a machine answers.
   *
   * The retry is not belt-and-braces, it is the difference between the feature
   * working and not. bb's own sidebar list stays the default, so a user who has
   * not switched to Harbor never opens it — and if the only thing that refreshed
   * the index were a sidebar read, every agent in that install would be told
   * nothing about the organization layer, for ever.
   *
   * Bounded and self-cancelling: it stops on the first answer, and a machine that
   * is truly gone leaves the index unread rather than wrong.
   */
  void sidebarIndexService.prime(5);

  /**
   * `bb harbor status` — what an agent can reach right now, and why.
   */
  bb.cli.register({
    name: "harbor",
    summary: "Inspect Harbor's agent access tier and exposed tools",
    commands: [
      {
        name: "status",
        summary: "Show the active agent access tier and the tools it exposes",
        usage: "bb harbor status [--json]",
      },
    ],
    run(argv) {
      const tier = agentAccess.current();
      const enabled = agentTools.enabledToolNames();
      const index = sidebarIndex.read();
      const describeIndex = (): string =>
        index === null
          ? "index: not read yet"
          : `index: ${index.projects.length} projects, ${index.groups.length} groups, ` +
            `${index.repoFacts.repos.length} repositories, ` +
            `${index.repoFacts.diagnostics.length} findings`;
      return {
        exitCode: 0,
        stdout: argv.includes("--json")
          ? JSON.stringify({
              tier,
              tools: enabled,
            })
          : [
              `access: ${tier}`,
              `tools (${enabled.length}): ${enabled.join(", ") || "(none)"}`,
              describeIndex(),
            ].join("\n"),
        stderr: "",
      };
    },
  });
}
