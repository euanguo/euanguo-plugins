// The server entry point wires storage, host reads, RPC handlers, scheduling,
// and agent tools. Domain rules stay in lib, and each RPC subject lives under
// server/rpc.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

// Prefer the platform global over `node:crypto`: bb bundles the server with a
// browser-ish resolver that does not shim built-in node modules, so a `node:`
// import is a build error. `crypto.randomUUID` is present in the bb server
// runtime and in every supported Node.
const randomUUID = (): string => crypto.randomUUID();
// Relative, not the `@/` alias the frontend uses: bb loads this file directly
// as a path source, so nothing rewrites tsconfig paths for it.
import {
  PROJECT_COLOR_MIGRATION,
  createProjectColorStore,
} from "./lib/project-color-store.ts";
import {
  PROJECT_ICON_MIGRATION,
  createProjectIconStore,
} from "./lib/project-icon-store.ts";
import {
  SCOPE_ICON_MIGRATION,
  createScopeIconStore,
} from "./lib/scope-icon-store.ts";
import { worktreeDirectoryContract } from "./host/contract.ts";
import {
  planWorktreeRemoval,
  removalSubmissionBlocker,
} from "./lib/worktree-removal.ts";
import {
  GROUP_ASSIGNMENT_MIGRATION,
  GROUP_MIGRATION,
  createGroupStore,
} from "./lib/group-store.ts";
import { MANUAL_ORDER_MIGRATION, createOrderStore } from "./lib/order-store.ts";
import type { OrderWrite } from "./lib/order-store.ts";
import {
  ORDER_REVISION_MIGRATION,
  ORDER_REVISION_SEED,
} from "./lib/order-store.ts";
import {
  VIEW_PREFERENCE_MIGRATION,
  createViewPreferenceStore,
} from "./lib/view-preference-store.ts";
import { nestMigrations } from "./lib/migrations.ts";
import {
  GROUP_CHANNEL,
  LIFECYCLE_CHANNEL,
  ORDER_CHANNEL,
  PROJECT_COLOR_CHANNEL,
  PROJECT_ICON_CHANNEL,
  VIEW_PREFERENCE_CHANNEL,
} from "./lib/realtime-channels.ts";
import { createRepoFactsCache, type WorkspaceProbe } from "./lib/repo-facts.ts";
import {
  AGENT_TOOL_SETTING_DESCRIPTORS,
  liveAgentToolFlags,
} from "./lib/agent/settings.ts";
import { AGENT_TOOL_FEATURES } from "./lib/agent/toolkit.ts";
import {
  SIDEBAR_INDEX_MIGRATION,
  createSidebarIndexCache,
} from "./lib/agent/index-cache.ts";
import { wireAgentTools } from "./lib/agent/wire.ts";
import type { AgentToolDeps, NestAgentActions } from "./lib/agent/actions.ts";

const migrations = [
  `CREATE TABLE IF NOT EXISTS thread_lifecycle (
     thread_id      TEXT PRIMARY KEY,
     settled_at     INTEGER,
     snoozed_until  INTEGER,
     snoozed_at     INTEGER
   )`,
  // bb's archive cascades to child threads and reports every id it took.
  // Without them, un-settling gives the parent back and leaves its children
  // archived for good.
  `ALTER TABLE thread_lifecycle ADD COLUMN archived_thread_ids TEXT`,
  PROJECT_COLOR_MIGRATION,
  GROUP_MIGRATION,
  GROUP_ASSIGNMENT_MIGRATION,
  `ALTER TABLE project_groups ADD COLUMN icon TEXT NOT NULL DEFAULT 'Layer'`,
  MANUAL_ORDER_MIGRATION,
  VIEW_PREFERENCE_MIGRATION,
  SCOPE_ICON_MIGRATION,
  PROJECT_ICON_MIGRATION,
  // Appended, never inserted: bb checks the journal by index, so a statement
  // added in the middle rewrites the history of every database that already
  // ran it.
  ORDER_REVISION_MIGRATION,
  SIDEBAR_INDEX_MIGRATION,
];

// The RPC surface lives in `server/contract.ts` — it is the whole file there,
// which is what lets a handler and the shape it promises be read together.
// Re-exported so this entry point's surface is what it always was.
export { nestRpcContract, worktreePlanWire } from "./server/contract.ts";
export type { StoredLifecycleRow } from "./server/lifecycle-store.ts";
import { createThreadReader } from "./server/thread-reader.ts";
import { createLifecycleService } from "./server/lifecycle-service.ts";
import { createBulkDeleteService } from "./server/bulk-delete-service.ts";
import {
  createWorkspaceService,
  WORKTREE_REMOVAL_TIMEOUT_MS,
} from "./server/workspace-service.ts";
import { createSidebarIndexService } from "./server/sidebar-index-service.ts";
import { compareCodepoints } from "./lib/codepoint.ts";
import { projectColorHandlers } from "./server/rpc/colors.ts";
import { projectIconHandlers } from "./server/rpc/icons.ts";
import { groupHandlers } from "./server/rpc/groups.ts";
import { appearanceHandlers } from "./server/rpc/appearance.ts";
import { createAppearanceStore } from "./lib/appearance-store.ts";
import { orderHandlers } from "./server/rpc/order.ts";
import { preferenceHandlers } from "./server/rpc/prefs.ts";
import { workspaceHandlers } from "./server/rpc/workspaces.ts";
import { projectHandlers } from "./server/rpc/projects.ts";
import { shelfHandlers } from "./server/rpc/shelf.ts";
import { readHandlers } from "./server/rpc/reads.ts";
import { pinnedHandlers } from "./server/rpc/pinned.ts";
import { bulkHandlers } from "./server/rpc/bulk.ts";
import { nestRpcContract } from "./server/contract.ts";

/** Channel the frontend re-reads on. */
// Re-exported so this entry point's surface is what it was. The declarations
// live in `lib/realtime-channels.ts` — see that file for why the frontend must
// not reach them through here.
export {
  GROUP_CHANNEL,
  LIFECYCLE_CHANNEL,
  ORDER_CHANNEL,
  PROJECT_COLOR_CHANNEL,
  PROJECT_ICON_CHANNEL,
  VIEW_PREFERENCE_CHANNEL,
};

/**
 * A `realpath` and a few small reads per directory, over a whole sidebar.
 *
 * Longer than the icon probe because it is one call for every workspace rather
 * than one call for one checkout, and still short enough that a machine which is
 * not going to answer does not hold the first frame.
 */
const WORKSPACE_FACTS_TIMEOUT_MS = 15_000;

export default function plugin(bb: BbPluginApi) {
  // The handle, not just the call: a probe is decided here, and the toggle has
  // to be readable at the moment it would run.
  /**
   * The descriptors the **server** reads.
   *
   * That is the whole rule for what stays here. An agent switch is read when
   * the tool gate decides whether to register a tool, and it is read on the
   * server, so it has to be a `bb.settings` descriptor. Nothing else qualifies:
   * a row layout or a colour is drawn by the frontend and by nothing here, so
   * those live in `appearance` — which is what let the settings page stop being
   * thirty-four host-drawn rows the plugin could not group, reorder or draw.
   */
  const settings = bb.settings.define({
    ...AGENT_TOOL_SETTING_DESCRIPTORS,
  });

  const appearance = createAppearanceStore(bb);

  const db = bb.storage.database();
  bb.storage.migrate(db, nestMigrations(db, migrations));
  // The counter's single row. `INSERT OR IGNORE` so a database that already has
  // it — every one after the first boot on this build — is left alone.
  db.prepare(ORDER_REVISION_SEED).run();
  const projectColors = createProjectColorStore(db);
  const projectIcons = createProjectIconStore(db);
  const groups = createGroupStore(db);
  const scopeIcons = createScopeIconStore(db);
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
   * What each machine last said about the directories it holds.
   *
   * The probe is the only place this plugin asks a machine something bb cannot
   * answer, and it is deliberately not fatal: a machine that does not reply
   * leaves the workspaces on it placed by their paths alone, which the tree
   * draws and the diagnostics say is unverified.
   */
  const probeWorkspaceFacts: WorkspaceProbe = async (hostId, paths) => {
    const answer = await worktreeHost.call(
      "resolveWorkspaceFacts",
      { paths: [...paths] },
      { hostId, timeoutMs: WORKSPACE_FACTS_TIMEOUT_MS },
    );
    return answer.facts.map((fact) => ({ ...fact, hostId }));
  };
  const repoFacts = createRepoFactsCache({ probe: probeWorkspaceFacts });

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
  });
  const {
    readWorkspaceDescriptors,
    refresh: refreshSidebarIndex,
  } = sidebarIndexService;

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
  const nestActions: NestAgentActions = {
    async assignProjectToGroup(projectId, groupId) {
      // Confirm the project exists before recording a membership for it, so a
      // deleted project cannot leave a member row pointing at nothing.
      await bb.sdk.projects.get({ projectId });
      const ok = groups.assign(projectId, groupId);
      if (ok) {
        bb.realtime.publish(GROUP_CHANNEL, {});
        void refreshSidebarIndex();
      }
      return ok;
    },
    async createGroup(name, icon) {
      try {
        const created = groups.create(`grp_${randomUUID()}`, name, icon);
        bb.realtime.publish(GROUP_CHANNEL, {});
        void refreshSidebarIndex();
        return created;
      } catch {
        return null;
      }
    },
    async renameGroup(groupId, name, icon) {
      // Renaming an id that is gone is not an error worth surfacing: the tree the
      // user was looking at is stale, and the publish refreshes it.
      const ok = groups.rename(groupId, name, icon) !== null;
      if (ok) {
        bb.realtime.publish(GROUP_CHANNEL, {});
        void refreshSidebarIndex();
      }
      return ok;
    },
    async setWorkspaceAlias(environmentId, alias) {
      // Routed through the environment area, which is where bb keeps a worktree's
      // display name. The publish is what makes every sidebar row for that
      // worktree pick the new name up.
      const environment = await bb.sdk.environments.update({
        environmentId,
        name: alias,
      });
      bb.realtime.publish(GROUP_CHANNEL, {});
      void refreshSidebarIndex();
      return environment.name;
    },
  };

  // The settings-backed switches the tool gate reads. Live by construction: the
  // gate is checked per call and the instruction provider per thread start, and
  // `registerTool` has no disposer, so a mutation is the only mechanism there is.
  const agentFlags = liveAgentToolFlags(settings);
  const agentDeps: AgentToolDeps = {
    index: () => sidebarIndex.read(),
    refreshIndex: () => refreshSidebarIndex(),
    actions: nestActions,
  };

  const lifecycleService = createLifecycleService({ bb, db });
  const {
    readAll,
    readOne,
    write,
    clear,
    archiveThread,
    unarchiveThreads,
    askToRetryUnarchive,
    archivedIdsFor,
  } = lifecycleService;

  const bulkDelete = createBulkDeleteService({
    bb,
    threads: threadReader,
  });

  const { surveyWorktree, removeWorktreeDirectory, projectSource } =
    workspaceService;

  const orderOutcome = (result: OrderWrite) => {
    if (result.ok) bb.realtime.publish(ORDER_CHANNEL, {});
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
  bb.rpc.register(nestRpcContract, {
    ...projectColorHandlers(bb, projectColors),
    ...projectIconHandlers({
      bb,
      projectIcons,
      worktreeHost,
      appearance,
      projectSource,
    }),
    ...groupHandlers({ bb, groups, scopeIcons, nestActions, orders }),
    ...appearanceHandlers({ bb, appearance }),
    ...orderHandlers({ bb, orders, groups, orderOutcome }),
    ...preferenceHandlers({ bb, viewPreferences }),
    ...workspaceHandlers({
      bb,
      readWorkspaceDescriptors,
      refreshSidebarIndex,
      repoFacts,
      surveyWorktree,
      removeWorktreeDirectory,
      planWorktreeRemoval,
      removalSubmissionBlocker,
    }),
    ...projectHandlers({
      bb,
      groups,
      orders,
      nestActions,
      refreshSidebarIndex,
    }),
    ...shelfHandlers({
      readAll,
      readOne,
      write,
      clear,
      archiveThread,
      unarchiveThreads,
      askToRetryUnarchive,
      archivedIdsFor,
    }),
    ...readHandlers({
      bb,
      readAll,
      threads: threadReader,
    }),
    ...pinnedHandlers({
      bb,
      listVisibleThreadRows: threadReader.listVisibleThreadRows,
      compareCodepoints,
    }),
    ...bulkHandlers({ bulkDelete }),
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
  const republishIfSettled = ({ thread }: { thread: { id: string } }) => {
    if (readOne(thread.id)?.settledAt == null) return;
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId: thread.id });
  };
  bb.events.on("thread.active", republishIfSettled);
  bb.events.on("thread.idle", republishIfSettled);
  bb.events.on("thread.failed", republishIfSettled);

  /**
   * Nest in front of agents: the map they can read, the four writes they may
   * make, and the summary every thread is told.
   *
   * Registered last because it is the one part of the plugin that is optional at
   * runtime: everything above is the sidebar, and this is a surface on top of it.
   */
  const agentTools = wireAgentTools({ bb, flags: agentFlags, deps: agentDeps });

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
   * not switched to Nest never opens it — and if the only thing that refreshed
   * the index were a sidebar read, every agent in that install would be told
   * nothing about the organization layer, for ever.
   *
   * Bounded and self-cancelling: it stops on the first answer, and a machine that
   * is truly gone leaves the index unread rather than wrong.
   */
  void sidebarIndexService.prime(5);

  /**
   * `bb nest status` — what an agent can reach right now, and why.
   *
   * The human half of the switches. A user who has just turned a write off wants
   * to see that it went off; a user wondering why an agent never files anything
   * wants to see it was never on. The switches are also readable in Settings, but
   * this is the one that answers "and what does that mean for the tools".
   */
  bb.cli.register({
    name: "nest",
    summary: "Inspect the Nest sidebar's agent tools and their switches",
    commands: [
      {
        name: "status",
        summary: "Show the agent tool switches and the tools they expose",
        usage: "bb nest status [--json]",
      },
    ],
    run(argv) {
      const enabled = agentTools.enabledToolNames();
      const features = AGENT_TOOL_FEATURES.map((feature) => ({
        feature,
        on: agentTools.isEnabled(feature),
      }));
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
              enabled: agentFlags.enabled,
              features: Object.fromEntries(features.map(({ feature, on }) => [feature, on])),
              tools: enabled,
            })
          : [
              ...features.map(({ feature, on }) => `${feature.padEnd(9)} ${on ? "on" : "off"}`),
              `tools (${enabled.length}): ${enabled.join(", ") || "(none)"}`,
              describeIndex(),
            ].join("\n"),
        stderr: "",
      };
    },
  });
}
