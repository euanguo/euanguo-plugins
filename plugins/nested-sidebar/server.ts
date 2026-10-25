// bb-plugin-nested-sidebar backend — the settled / snoozed store.
//
// This state lives in the plugin's own SQLite database, never on bb's thread.
// Putting it on the thread would mean a schema change, a wire change, and a
// HOST_DAEMON_PROTOCOL_VERSION bump for something only this sidebar
// understands. Here, uninstalling the plugin removes this database with it —
// see `lib/warm-start.ts` for the browser-side copy of the same rows, which is
// the one part it does not take.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

// Prefer the platform global over `node:crypto`: bb bundles the server with a
// browser-ish resolver that does not shim built-in node modules, so a `node:`
// import is a build error. `crypto.randomUUID` is present in the bb server
// runtime and in every supported Node.
const randomUUID = (): string => crypto.randomUUID();
// Relative, not the `@/` alias the frontend uses: bb loads this file directly
// as a path source, so nothing rewrites tsconfig paths for it.
import { parseArchivedThreadIds } from "./lib/lifecycle.ts";
import { isWithinSettledWindow } from "./lib/settled-threads.ts";
import {
  createBulkDeleteCoordinator,
  MAX_BULK_DELETE_ROOTS,
  MAX_BULK_DELETE_THREADS,
  type BulkDeleteFamilySnapshot,
  type BulkDeleteThreadSnapshot,
} from "./lib/bulk-delete.ts";
import {
  CHILD_EXPANSION_OPTIONS,
  CUSTOM_COLOR_DEFAULTS,
  PALETTE_PRESET_OPTIONS,
  DEFAULT_ROW_DETAILS,
  ROW_DETAIL_OPTIONS,
  ROW_LAYOUT_OPTIONS,
  STATUS_DISPLAY_OPTIONS,
  WORKTREE_LABEL_OPTIONS,
} from "./lib/preferences.ts";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
} from "./lib/paging.ts";
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
import {
  SCOPE_ICON_SCOPES,
} from "./lib/group-scope-icons.ts";
import { worktreeDirectoryContract } from "./host/contract.ts";
import {
  planWorktreeRemoval,
  removalSubmissionBlocker,
  type WorktreeRemovalPlan,
  type WorktreeSurvey,
} from "./lib/worktree-removal.ts";
import {
  GROUP_ASSIGNMENT_MIGRATION,
  GROUP_MIGRATION,
  createGroupStore,
} from "./lib/group-store.ts";
import {
  DEFAULT_GROUP_ICON,
  MAX_GROUPS,
  MAX_GROUP_NAME_LENGTH,
  validGroupIcon,
} from "./lib/groups.ts";
import {
  MAX_ORDER_ID_LENGTH,
  MAX_ORDER_ITEMS,
  MAX_ORDER_SCOPES,
  UNGROUPED_ORDER_SCOPE,
} from "./lib/manual-order.ts";
import { MANUAL_ORDER_MIGRATION, createOrderStore } from "./lib/order-store.ts";
import type { OrderWrite } from "./lib/order-store.ts";
import {
  ORDER_REVISION_MIGRATION,
  ORDER_REVISION_SEED,
} from "./lib/order-store.ts";
import {
  PROJECT_SORT_MODES,
  THREAD_SORT_MODES,
  WORKTREE_SORT_MODES,
} from "./lib/sort-modes.ts";
import { ORGANIZATION_MODES } from "./lib/organization.ts";
import {
  UNARCHIVE_RETRY_RENDERER_ID,
  UNARCHIVE_RETRY_TIMEOUT_MS,
  unarchiveRetryApproved,
  unarchiveRetryPayload,
} from "./lib/unarchive-retry.ts";
import {
  VIEW_PREFERENCE_MIGRATION,
  createViewPreferenceStore,
} from "./lib/view-preference-store.ts";
import { nestMigrations } from "./lib/migrations.ts";
import {
  MAX_PROJECT_COLOR_ROWS,
  MAX_PROJECT_ID_LENGTH,
} from "./lib/project-colors.ts";
import {
  MAX_PROJECT_ICON_ROWS,
  PROJECT_ICON_SOURCES,
  canonicalProjectIcon,
  type ProjectIcon,
} from "./lib/project-icons.ts";
import {
  GROUP_CHANNEL,
  LIFECYCLE_CHANNEL,
  ORDER_CHANNEL,
  PROJECT_COLOR_CHANNEL,
  PROJECT_ICON_CHANNEL,
  VIEW_PREFERENCE_CHANNEL,
} from "./lib/realtime-channels.ts";
import { createRepoFactsCache, type WorkspaceProbe } from "./lib/repo-facts.ts";
import { inferRepos } from "./lib/repo-identity.ts";
import { inferWorkspaceOwnership } from "./lib/workspace-ownership.ts";
import { workspaceDisplayKindOf } from "./lib/workspace.ts";
import {
  AGENT_TOOL_SETTING_DESCRIPTORS,
  liveAgentToolFlags,
} from "./lib/agent/settings.ts";
import { AGENT_TOOL_FEATURES } from "./lib/agent/toolkit.ts";
import {
  SIDEBAR_INDEX_MIGRATION,
  createSidebarIndexCache,
  type SidebarIndex,
} from "./lib/agent/index-cache.ts";
import { wireAgentTools } from "./lib/agent/wire.ts";
import type { AgentToolDeps, NestAgentActions } from "./lib/agent/actions.ts";

const groupIconSchema = z.string().refine(validGroupIcon, {
  message: "Unknown group icon.",
});

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

export interface StoredLifecycleRow {
  threadId: string;
  settledAt: number | null;
  snoozedUntil: number | null;
  snoozedAt: number | null;
  /** Every id the settle's archive took, this thread's own included. */
  archivedThreadIds: string[];
}

interface LifecycleDbRow {
  thread_id: string;
  settled_at: number | null;
  snoozed_until: number | null;
  snoozed_at: number | null;
  archived_thread_ids: string | null;
}

interface AuthoritativeThreadRow {
  id: string;
  projectId: string;
  title: string | null;
  titleFallback: string | null;
  parentThreadId: string | null;
  status: "active" | "error" | "idle" | "pending" | "starting" | "stopping";
  hasPendingInteraction: boolean;
  pinnedAt: number | null;
  lastReadAt: number | null;
  latestAttentionAt: number;
  deletedAt: number | null;
  activity: {
    activeWorkflowCount: number;
    activeBackgroundAgentCount: number;
    activeBackgroundCommandCount: number;
    activePlanModeCount: number;
    activeGoalCount: number;
  };
  runtime: {
      displayStatus:
        | "active"
        | "error"
        | "host-reconnecting"
        | "idle"
        | "pending"
        | "provisioning"
        | "starting"
        | "stopping"
        | "waiting-for-host";
  };
}

/**
 * The fields the recovery read needs from `bb.sdk.threads.list`.
 *
 * A deliberate subset, the way `AuthoritativeThreadRow` is: the SDK read is the
 * source and this is the shape the backend promises to hand on, so a field bb
 * stops returning is a compile error here rather than an `undefined` on the
 * wire. Unlike the bulk-delete subset this one carries the environment, the
 * host, and the origin, because a recovery row has to draw a workspace level.
 */
interface RecoverySdkThreadRow {
  id: string;
  projectId: string;
  title: string | null;
  titleFallback: string | null;
  parentThreadId: string | null;
  sectionId: string | null;
  originKind: "fork" | null;
  originPluginId: string | null;
  providerId: string;
  status: "active" | "error" | "idle" | "pending" | "starting" | "stopping";
  hasPendingInteraction: boolean;
  pinnedAt: number | null;
  /**
   * bb's own ordering key for a pinned thread, compared as a string by codepoint
   * — which is why it is a string and not a number. Null for a thread pinned
   * before the key existed, and for every unpinned thread.
   */
  pinSortKey: string | null;
  /** When bb archived this thread. Null while it is live. */
  archivedAt: number | null;
  deletedAt: number | null;
  /**
   * Read by the bulk-delete preview and by nothing else here. It is on this
   * interface so the one paged read can serve every caller: a second read with a
   * narrower type would be a second place for the paging to be wrong.
   */
  runtime: {
    displayStatus:
      | "active"
      | "error"
      | "host-reconnecting"
      | "idle"
      | "pending"
      | "provisioning"
      | "starting"
      | "stopping"
      | "waiting-for-host";
  };
  visibility: "hidden" | "visible";
  environmentId: string | null;
  environmentName: string | null;
  environmentBranchName: string | null;
  environmentProviderId: string | null;
  environmentHostId: string | null;
  environmentWorkspaceDisplayKind:
    | "managed-worktree"
    | "unmanaged-worktree"
    | "other";
  lastReadAt: number | null;
  latestAttentionAt: number;
  createdAt: number;
  updatedAt: number;
  activity: {
    activeWorkflowCount: number;
    activeBackgroundAgentCount: number;
    activeBackgroundCommandCount: number;
    activePlanModeCount: number;
    activeGoalCount: number;
  };
}

/**
 * Three-way compare by codepoint, which is how bb orders its pin sort keys.
 *
 * Not `localeCompare`: the keys are opaque and the host compares them as byte
 * strings, so a locale-aware compare would order them differently on a machine
 * whose locale disagrees with the host's — which is the drift this exists to
 * avoid.
 */
function compareCodepoints(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

// The RPC surface lives in `server/contract.ts` — it is the whole file there,
// which is what lets a handler and the shape it promises be read together.
// Re-exported so this entry point's surface is what it always was.
export { nestRpcContract, worktreePlanWire } from "./server/contract.ts";
import { nestRpcContract } from "./server/contract.ts";
import { worktreePlanWire } from "./server/contract.ts";

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
 * A thread that is using its workspace right now. `idle` is deliberately absent:
 * bb refuses to release an environment while a thread is still there at all, and
 * that refusal is what the removal reports — this set is only for saying "one of
 * them is running" in the dialog.
 */
const LIVE_THREAD_STATUSES: ReadonlySet<string> = new Set([
  "starting",
  "active",
  "stopping",
]);

/** One page big enough for every workspace a sidebar would draw. */
const WORKSPACE_PATH_LIMIT = 500;

/** Deleting a large working copy is slow; the dialog waits, so allow for it. */
const WORKTREE_REMOVAL_TIMEOUT_MS = 120_000;

/** A handful of stats and small reads inside one checkout. */
const PROJECT_ICON_DETECT_TIMEOUT_MS = 10_000;

/**
 * A `realpath` and a few small reads per directory, over a whole sidebar.
 *
 * Longer than the icon probe because it is one call for every workspace rather
 * than one call for one checkout, and still short enough that a machine which is
 * not going to answer does not hold the first frame.
 */
const WORKSPACE_FACTS_TIMEOUT_MS = 15_000;

/**
 * How long a stored miss is believed.
 *
 * A miss is worth storing — it is what keeps every mount from re-walking the
 * same hundred paths — but it is a claim about a checkout that keeps changing,
 * and the one way it goes wrong is the favicon added after the probe. A week
 * is the compromise: no mount pays for a re-probe, and the icon still turns up
 * on its own.
 */
const PROJECT_ICON_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A terminal that has not exited, so the directory is still open in a shell. */
const OPEN_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "running",
  "starting",
  "disconnected",
]);
export default function plugin(bb: BbPluginApi) {
  // The handle, not just the call: a probe is decided here, and the toggle has
  // to be readable at the moment it would run.
  const settings = bb.settings.define({
    palettePreset: {
      type: "select",
      label: "Appearance · Palette preset",
      description:
        "Appearance · Default follows the theme; High contrast and Colorblind-friendly are ready-made palettes; Custom enables the color fields below.",
      options: [...PALETTE_PRESET_OPTIONS],
      default: "Default",
    },
    workingColor: colorSetting("Custom · Working", CUSTOM_COLOR_DEFAULTS.working),
    workflowColor: colorSetting(
      "Custom · Workflow",
      CUSTOM_COLOR_DEFAULTS.workflow,
    ),
    agentColor: colorSetting("Custom · Agent", CUSTOM_COLOR_DEFAULTS.agent),
    commandColor: colorSetting(
      "Custom · Command",
      CUSTOM_COLOR_DEFAULTS.command,
    ),
    planColor: colorSetting("Custom · Plan", CUSTOM_COLOR_DEFAULTS.plan),
    goalColor: colorSetting("Custom · Goal", CUSTOM_COLOR_DEFAULTS.goal),
    waitingColor: colorSetting(
      "Custom · Stalled / waiting",
      CUSTOM_COLOR_DEFAULTS.waiting,
    ),
    unreadColor: colorSetting(
      "Custom · Waiting to read",
      CUSTOM_COLOR_DEFAULTS.unread,
    ),
    errorColor: colorSetting("Custom · Error", CUSTOM_COLOR_DEFAULTS.error),
    idleColor: colorSetting(
      "Custom · Inactive",
      CUSTOM_COLOR_DEFAULTS.inactive,
    ),
    staleColor: colorSetting("Custom · Stale", CUSTOM_COLOR_DEFAULTS.stale),
    prReviewColor: colorSetting(
      "Custom · PR review",
      CUSTOM_COLOR_DEFAULTS.prReview,
    ),
    prChecksColor: colorSetting(
      "Custom · PR checks",
      CUSTOM_COLOR_DEFAULTS.prChecks,
    ),
    prReadyColor: colorSetting(
      "Custom · PR ready",
      CUSTOM_COLOR_DEFAULTS.prReady,
    ),
    prMergedColor: colorSetting(
      "Custom · PR merged",
      CUSTOM_COLOR_DEFAULTS.prMerged,
    ),
    prDraftColor: colorSetting(
      "Custom · PR draft",
      CUSTOM_COLOR_DEFAULTS.prDraft,
    ),
    prBlockedColor: colorSetting(
      "Custom · PR blocked",
      CUSTOM_COLOR_DEFAULTS.prBlocked,
    ),
    prClosedColor: colorSetting(
      "Custom · PR closed",
      CUSTOM_COLOR_DEFAULTS.prClosed,
    ),
    rowLayout: {
      type: "select",
      label: "Thread list · Row layout",
      description:
        "Only applies when the thread branch or host is shown. One line puts it beside the title; Two lines puts it below the title.",
      options: [...ROW_LAYOUT_OPTIONS],
      default: "Two lines",
    },
    rowDetails: {
      type: "select",
      label: "Thread list · Details",
      description:
        "Where a row's non-essential fields live. In the row keeps them all on the row; In the row, no branch keeps the provider, the age, the controls and the status but leaves out the branch and the machine, which the worktree row above already names; On hover moves branch, provider, PR, age, and child count into the row's hover card.",
      options: [...ROW_DETAIL_OPTIONS],
      default: DEFAULT_ROW_DETAILS,
    },
    worktreeLabel: {
      type: "select",
      label: "Thread list · Worktree label",
      description:
        "Alias over branch stacks the two lines; the other options keep the row on one line. A half a worktree does not have falls back to the other.",
      options: [...WORKTREE_LABEL_OPTIONS],
      default: "Alias over branch",
    },
    statusDisplay: {
      type: "select",
      label: "Thread list · Status marker",
      description:
        "A dot is quieter and narrower; the status icon keeps a distinct shape per state.",
      options: [...STATUS_DISPLAY_OPTIONS],
      default: "Dot",
    },
    defaultChildExpansion: {
      type: "select",
      label: "Thread list · Default child expansion",
      description: "Search still reveals matching child threads.",
      options: [...CHILD_EXPANSION_OPTIONS],
      default: "Expanded",
    },
    pageSize: {
      type: "number",
      label: "Thread list · Rows per page",
      description: `How many rows a thread list or the settled shelf draws, and how many each Load more adds (${MIN_PAGE_SIZE}–${MAX_PAGE_SIZE}). A search draws every match.`,
      default: DEFAULT_PAGE_SIZE,
    },
    showProviderIcons: {
      type: "boolean",
      label: "Thread list · Show provider icons",
      default: true,
    },
    showPullRequestMetadata: {
      type: "boolean",
      label: "Thread list · Show parent PR metadata",
      default: true,
    },
    showRelativeTime: {
      type: "boolean",
      label: "Thread list · Show relative time",
      default: true,
    },
    showChildCount: {
      type: "boolean",
      label: "Thread list · Show child thread count",
      description: "The disclosure beside a thread that has agents.",
      default: true,
    },
    showThreadLocation: {
      type: "boolean",
      label: "Thread list · Show branch or host",
      default: true,
    },
    autoProjectIcons: {
      type: "boolean",
      label: "Projects · Detect project icons",
      description:
        "Look for a favicon, logo, or app icon in a project's checkout and use it as the project's badge. Only conventional locations are read, on the machine that owns the checkout, and nothing is written there.",
      default: true,
    },
    workspaceOwnership: {
      type: "select",
      label: "Projects · Workspace ownership",
      description:
        "Filesystem follows each project's source path and Git facts: the checkout and its worktrees stay together even when an environment record claims another project. bb claims preserves bb's stored project assignment.",
      default: "Filesystem",
      options: ["Filesystem", "bb claims"],
    },
    showUnregisteredWorktrees: {
      type: "boolean",
      label: "Projects · Show unregistered worktrees",
      description:
        "Draw worktrees that exist in a repository but have no bb environment yet. Off by default; turning it on makes those rows available to adopt with +.",
      default: false,
    },
    groupByRepository: {
      type: "boolean",
      label: "Projects · Group by repository",
      description:
        "Draw one repository as one row. Nest asks each machine for the `.git` its workspaces share, and groups by that instead of by bb's project records — so the worktrees of one repository stay together even when bb holds them as several projects. Off, the list is exactly bb's own.",
      default: false,
    },
    // The agent switches, defined in `lib/agent/settings.ts` beside the tools
    // they gate, so a tool cannot be added without a way to turn it off.
    ...AGENT_TOOL_SETTING_DESCRIPTORS,
  });

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
  const worktreeHost = bb.hosts.experimental_client({
    contract: worktreeDirectoryContract,
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

  const readAll = (): StoredLifecycleRow[] =>
    (
      db
        .prepare(
          `SELECT thread_id, settled_at, snoozed_until, snoozed_at,
                  archived_thread_ids
             FROM thread_lifecycle`,
        )
        .all() as LifecycleDbRow[]
    ).map((row) => ({
      threadId: row.thread_id,
      settledAt: row.settled_at,
      snoozedUntil: row.snoozed_until,
      snoozedAt: row.snoozed_at,
      archivedThreadIds: parseArchivedThreadIds(row.archived_thread_ids),
    }));

  const readOne = (threadId: string): StoredLifecycleRow | undefined => {
    const row = db
      .prepare(
        `SELECT thread_id, settled_at, snoozed_until, snoozed_at,
                archived_thread_ids
           FROM thread_lifecycle
          WHERE thread_id = ?`,
      )
      .get(threadId) as LifecycleDbRow | undefined;
    if (row === undefined) return undefined;
    return {
      threadId: row.thread_id,
      settledAt: row.settled_at,
      snoozedUntil: row.snoozed_until,
      snoozedAt: row.snoozed_at,
      archivedThreadIds: parseArchivedThreadIds(row.archived_thread_ids),
    };
  };

  const write = (row: StoredLifecycleRow): void => {
    db.prepare(
      `INSERT INTO thread_lifecycle
         (thread_id, settled_at, snoozed_until, snoozed_at, archived_thread_ids)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         settled_at = excluded.settled_at,
         snoozed_until = excluded.snoozed_until,
         snoozed_at = excluded.snoozed_at,
         archived_thread_ids = excluded.archived_thread_ids`,
    ).run(
      row.threadId,
      row.settledAt,
      row.snoozedUntil,
      row.snoozedAt,
      row.archivedThreadIds.length === 0
        ? null
        : JSON.stringify(row.archivedThreadIds),
    );
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId: row.threadId });
  };

  const clear = (threadId: string): void => {
    db.prepare(`DELETE FROM thread_lifecycle WHERE thread_id = ?`).run(
      threadId,
    );
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId });
  };

  /**
   * bb's own archive, kept in step with the settled shelf.
   *
   * "Settled" and "archived" are the same statement — this work is done — so
   * saying it in one place and not the other leaves the built-in sidebar, the
   * archived filter, and worktree reuse disagreeing with the shelf.
   *
   * Returns every id bb took, which for a thread with children is more than
   * the one asked for. An empty array means the archive did not happen.
   */
  const archiveThread = async (threadId: string): Promise<string[]> => {
    try {
      const result = await bb.sdk.threads.archive({ threadId });
      const ids = result.archivedThreadIds ?? [];
      return ids.includes(threadId) ? ids : [...ids, threadId];
    } catch (error) {
      // Archiving reaches the thread's host, which can be offline. The flag is
      // read — `visibleInboxThreads` drops an archived thread — but the row
      // outranks it, so a failure here costs the archive and nothing else: the
      // flag stays false, the row still shelves the thread, and it sits where
      // the user put it.
      bb.log.warn(`archive failed for thread ${threadId}: ${String(error)}`);
      return [];
    }
  };

  /** The mirror: every id the settle took, given back one by one. */
  const unarchiveThreads = async (
    threadIds: readonly string[],
  ): Promise<string | null> => {
    let failure: string | null = null;
    for (const threadId of threadIds) {
      try {
        await bb.sdk.threads.unarchive({ threadId });
      } catch (error) {
        // One child that cannot be reached must not strand the rest, and the
        // parent is the id that matters most — it is the one on the shelf.
        // This direction is not the benign one `archiveThread` describes: the
        // callers clear or rewrite the row whatever happens here, so a parent
        // that stays archived is a thread nothing here still calls settled,
        // and it leaves the sidebar until bb unarchives it.
        //
        // The failure is returned rather than only logged, because a log line
        // is not a user-facing answer to "where did my thread go".
        bb.log.warn(`unarchive failed for thread ${threadId}: ${String(error)}`);
        failure ??=
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : String(error);
      }
    }
    return failure;
  };

  /**
   * Ask the user whether to try the unarchive again.
   *
   * The question is the whole point of this path. Without it the failure is
   * invisible: the row is cleared, the thread is still archived, and the only
   * clue is a row that is not there. `bb.ui.requestInput` blocks until the app
   * answers, and the plugin's own `pendingInteraction` slot renders it.
   */
  const askToRetryUnarchive = async (
    threadId: string,
    message: string,
  ): Promise<boolean> => {
    try {
      const payload = unarchiveRetryPayload({ threadId, message });
      const result = await bb.ui.requestInput({
        threadId,
        rendererId: UNARCHIVE_RETRY_RENDERER_ID,
        title: "Could not bring this thread back",
        // A fresh literal rather than the interface: `JsonValue` wants an index
        // signature and an interface does not carry one.
        payload: { threadId: payload.threadId, message: payload.message },
        timeoutMs: UNARCHIVE_RETRY_TIMEOUT_MS,
      });
      return unarchiveRetryApproved(result);
    } catch (error) {
      // A prompt that could not be raised is not a reason to fail the RPC: the
      // thread is where it was, and bb's archived view still holds it.
      bb.log.warn(`could not ask about the unarchive: ${String(error)}`);
      return false;
    }
  };

  /**
   * Every id a settle archived, or the thread's own id when the row predates
   * the cascade column. The fallback is exactly the old behaviour.
   */
  const archivedIdsFor = (threadId: string): string[] => {
    const stored = readOne(threadId)?.archivedThreadIds ?? [];
    return stored.length === 0 ? [threadId] : stored;
  };

  /** One page is already generous; the loop is for the account that isn't. */
  const ARCHIVED_PAGE_SIZE = 200;
  const ARCHIVED_PAGE_LIMIT = 50;

  const listArchivedThreads = async () => {
    const collected = [];
    for (let page = 0; page < ARCHIVED_PAGE_LIMIT; page++) {
      const rows = await bb.sdk.threads.list({
        archived: true,
        limit: ARCHIVED_PAGE_SIZE,
        offset: page * ARCHIVED_PAGE_SIZE,
      });
      collected.push(...rows);
      if (rows.length < ARCHIVED_PAGE_SIZE) break;
    }
    return collected;
  };

  const BULK_PAGE_SIZE = 200;
  const BULK_PAGE_LIMIT = 25;

  const listThreadRows = async (filters: {
    archived: boolean;
    projectId?: string;
    parentThreadId?: string;
  }): Promise<RecoverySdkThreadRow[]> => {
    const collected: RecoverySdkThreadRow[] = [];
    for (let page = 0; page < BULK_PAGE_LIMIT; page++) {
      const rows = await bb.sdk.threads.list({
        ...filters,
        includeHidden: true,
        limit: BULK_PAGE_SIZE,
        offset: page * BULK_PAGE_SIZE,
      });
      collected.push(...rows);
      if (rows.length < BULK_PAGE_SIZE) return collected;
    }
    throw new RangeError("Thread list is too large to validate safely.");
  };

  const listBothArchiveStates = async (filters: {
    projectId?: string;
    parentThreadId?: string;
  }): Promise<RecoverySdkThreadRow[]> => {
    const [active, archived] = await Promise.all([
      listThreadRows({ ...filters, archived: false }),
      listThreadRows({ ...filters, archived: true }),
    ]);
    const byId = new Map<string, RecoverySdkThreadRow>();
    for (const thread of [...active, ...archived]) byId.set(thread.id, thread);
    return [...byId.values()];
  };

  /**
   * Every live, visible thread, paged.
   *
   * `includeHidden` is deliberately not passed, and the result is filtered on
   * `visibility` anyway: the host's sidebar view draws visible threads, so a
   * recovery that resurrected hidden ones would show the user rows bb is
   * keeping out of the sidebar on purpose.
   *
   * The page-full test reads the *unfiltered* page, which is what makes the
   * loop terminate on the source's page size rather than on how many of those
   * rows happened to be visible.
   */
  const listVisibleThreadRows = async (): Promise<RecoverySdkThreadRow[]> => {
    const collected: RecoverySdkThreadRow[] = [];
    for (let page = 0; page < BULK_PAGE_LIMIT; page++) {
      const rows: RecoverySdkThreadRow[] = await bb.sdk.threads.list({
        archived: false,
        limit: BULK_PAGE_SIZE,
        offset: page * BULK_PAGE_SIZE,
      });
      collected.push(...rows.filter((row) => row.visibility === "visible"));
      if (rows.length < BULK_PAGE_SIZE) return collected;
    }
    throw new RangeError("Thread list is too large to read safely.");
  };

  const toBulkSnapshot = (
    thread: AuthoritativeThreadRow,
  ): BulkDeleteThreadSnapshot => ({
    id: thread.id,
    title:
      thread.title?.trim() ||
      thread.titleFallback?.trim() ||
      "Untitled thread",
    parentThreadId: thread.parentThreadId,
    status: thread.runtime.displayStatus,
    hasPendingInteraction: thread.hasPendingInteraction,
    isPinned: thread.pinnedAt !== null,
    isUnread: thread.latestAttentionAt > (thread.lastReadAt ?? 0),
    activity: {
      workflows: thread.activity.activeWorkflowCount,
      backgroundAgents: thread.activity.activeBackgroundAgentCount,
      backgroundCommands: thread.activity.activeBackgroundCommandCount,
      planMode: thread.activity.activePlanModeCount,
      goals: thread.activity.activeGoalCount,
    },
  });

  const readBulkFamily = async (
    rootId: string,
  ): Promise<BulkDeleteFamilySnapshot | null> => {
    let detail;
    try {
      detail = await bb.sdk.threads.get({ threadId: rootId });
    } catch {
      return null;
    }
    if (detail.deletedAt !== null) return null;

    const projectRows = await listBothArchiveStates({
      projectId: detail.projectId,
    });
    const root = projectRows.find((thread) => thread.id === rootId);
    if (root === undefined || root.deletedAt !== null) return null;

    const descendants: AuthoritativeThreadRow[] = [];
    const visited = new Set([rootId]);
    const parents = [rootId];
    while (parents.length > 0) {
      const parentThreadId = parents.shift();
      if (parentThreadId === undefined) break;
      const children = await listBothArchiveStates({ parentThreadId });
      for (const child of children) {
        if (child.deletedAt !== null || visited.has(child.id)) continue;
        visited.add(child.id);
        descendants.push(child);
        parents.push(child.id);
        if (descendants.length > MAX_BULK_DELETE_THREADS) {
          throw new RangeError(
            `A selected family exceeds ${MAX_BULK_DELETE_THREADS} threads.`,
          );
        }
      }
    }

    // childSummary is the deletion service's own count. If our paged walk
    // found fewer rows, fail closed instead of presenting a smaller cascade.
    const summary = await bb.sdk.threads.childSummary({ threadId: rootId });
    if (summary.nonDeletedChildCount > descendants.length) {
      throw new Error("Could not enumerate every child thread safely.");
    }

    return {
      root: toBulkSnapshot(root),
      descendants: descendants.map(toBulkSnapshot),
    };
  };

  const bulkDelete = createBulkDeleteCoordinator({
    readFamily: readBulkFamily,
    async deleteRoot(threadId, childThreadsConfirmed) {
      await bb.sdk.threads.delete({ threadId, childThreadsConfirmed });
    },
    now: () => Date.now(),
    createToken: () => randomUUID(),
    reportFailure(threadId, error) {
      bb.log.warn(`bulk delete failed for thread ${threadId}: ${String(error)}`);
    },
  });

  /** The workspace half of a status read, or null when there is nothing to read. */
  const readWorktreeStatus = async (
    environmentId: string,
    baseRef: string | null,
  ) => {
    const read = async (mergeBaseBranch: string | null) => {
      const status = await bb.sdk.environments.status({
        environmentId,
        ...(mergeBaseBranch === null ? {} : { mergeBaseBranch }),
      });
      return status.outcome === "available" ? status.workspace : null;
    };
    if (baseRef === null) return await read(null);
    try {
      return await read(baseRef);
    } catch {
      // A ref this checkout does not have is not a reason to fail the whole
      // inspection: the counts that need it are simply left at zero.
      return await read(null);
    }
  };

  /**
   * Everything the removal dialog has to say about one workspace.
   *
   * Read from bb rather than from the tree: the tree is narrowed by search, by
   * the selected group, and by what is collapsed, so its counts are not the
   * counts a removal would act on.
   */
  const surveyWorktree = async (
    environmentId: string,
  ): Promise<WorktreeSurvey> => {
    const environment = await bb.sdk.environments.get({ environmentId });
    const path = environment.path ?? "";
    // The status call wants one exact ref: the merge-base override first, then
    // the branch the environment came from, then the remote's default. Without
    // one there is no "commits not on the base" to count, which is honest —
    // bb cannot know either.
    const baseRef =
      environment.mergeBaseBranch ??
      environment.baseBranch ??
      (environment.defaultBranch === null
        ? null
        : `origin/${environment.defaultBranch}`);
    const status = await readWorktreeStatus(environmentId, baseRef);
    const [threads, terminals, project] = await Promise.all([
      bb.sdk.threads.list({
        environmentId,
        archived: false,
        includeHidden: true,
      }),
      bb.sdk.terminals.list({
        scope: { kind: "environment", environmentId },
      }),
      bb.sdk.projects.get({ projectId: environment.projectId }),
    ]);
    const source =
      project.sources.find((candidate) => candidate.isDefault) ??
      project.sources[0];
    const existence =
      path.length === 0
        ? {}
        : (
            await bb.sdk.hosts.pathsExist({
              hostId: environment.hostId,
              paths: [path],
            })
          ).existence;
    const files = status?.workingTree.files ?? [];

    return {
      path,
      hostId: environment.hostId,
      branch: environment.branchName,
      bbOwned: environment.managed,
      gitWorktree: environment.isWorktree,
      directoryExists: path.length > 0 && existence[path] === true,
      mainRepoPath: source?.path ?? null,
      changedFiles: files.filter((file) => file.status !== "??").length,
      untrackedFiles: files.filter((file) => file.status === "??").length,
      aheadCommits: status?.mergeBase?.aheadCount ?? 0,
      baseRef: status?.mergeBase?.mergeBaseBranch ?? null,
      threads: threads.length,
      liveThreads: threads.filter((thread) =>
        LIVE_THREAD_STATUSES.has(thread.status),
      ).length,
      openTerminals: terminals.sessions.filter((session) =>
        OPEN_TERMINAL_STATUSES.has(session.status),
      ).length,
    };
  };

  /**
   * Take the directory off disk.
   *
   * `git worktree remove` where the repository is known, because git keeps a
   * record of the worktree inside it and takes that away too. Where git is not
   * the answer — an unregistered directory, or a machine without git — a plain
   * recursive delete, with git's reason carried back so the dialog can say what
   * it could not clean up rather than implying it did.
   */
  const removeWorktreeDirectory = async (args: {
    path: string;
    hostId: string;
    mainRepoPath: string | null;
  }): Promise<{ directory: "removed" | "failed"; message: string | null }> => {
    let note: string | null = null;
    try {
      if (args.mainRepoPath !== null) {
        const attempt = await worktreeHost.call(
          "removeWorktree",
          { path: args.path, mainRepoPath: args.mainRepoPath },
          { hostId: args.hostId, timeoutMs: WORKTREE_REMOVAL_TIMEOUT_MS },
        );
        if (attempt.status === "removed") {
          return { directory: "removed", message: null };
        }
        if (attempt.status === "failed") {
          return { directory: "failed", message: attempt.message };
        }
        note = attempt.reason;
      }
      await bb.sdk.files.remove({
        hostId: args.hostId,
        path: args.path,
        recursive: true,
      });
      return { directory: "removed", message: note };
    } catch (error) {
      return {
        directory: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };

  /**
   * The checkout a project is configured against, and the machine holding it.
   *
   * `null` is the personal project and any project whose source bb cannot name.
   * Those have no checkout to read, so they keep the letter badge — and they
   * are why every icon answer is allowed to be "nothing".
   */
  const projectSource = async (
    projectId: string,
  ): Promise<{ path: string; hostId: string } | null> => {
    const project = await bb.sdk.projects.get({ projectId });
    const source =
      project.sources.find((candidate) => candidate.isDefault) ??
      project.sources[0];
    const path = source?.path ?? null;
    const hostId = source?.hostId ?? null;
    if (path === null || hostId === null) return null;
    return { path, hostId };
  };

/**
 * One SDK thread row as the wire carries it.
 *
 * Shared by the recovery read and the project-archive read: both hand the
 * frontend the same fields, and the difference between them — whether the row is
 * live — is the frontend's to state, not the wire's. A second mapper would be a
 * second place for a field to be forgotten.
 */
const toThreadWireRow = (
  thread: RecoverySdkThreadRow,
  hostNameById: ReadonlyMap<string, string>,
) => {
  const hostId = thread.environmentHostId;
  const hostName = hostId === null ? undefined : hostNameById.get(hostId);
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    titleFallback: thread.titleFallback,
    parentThreadId: thread.parentThreadId,
    sectionId: thread.sectionId,
    originKind: thread.originKind,
    originPluginId: thread.originPluginId,
    providerId: thread.providerId,
    status: thread.status,
    hasPendingInteraction: thread.hasPendingInteraction,
    isPinned: thread.pinnedAt !== null,
    activity: {
      workflows: thread.activity.activeWorkflowCount,
      backgroundAgents: thread.activity.activeBackgroundAgentCount,
      backgroundCommands: thread.activity.activeBackgroundCommandCount,
      planMode: thread.activity.activePlanModeCount,
      goals: thread.activity.activeGoalCount,
    },
    environment:
      thread.environmentId === null
        ? null
        : {
            id: thread.environmentId,
            name: thread.environmentName,
            branchName: thread.environmentBranchName,
            providerId: thread.environmentProviderId,
            workspaceDisplayKind: thread.environmentWorkspaceDisplayKind,
          },
    // A row with no worktree still runs on a machine and names it in the
    // branch's place. A host bb no longer knows resolves to null: the row keeps
    // its branch and drops the machine rather than naming one it cannot look up.
    host:
      hostId === null || hostName === undefined
        ? null
        : { id: hostId, name: hostName },
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastReadAt: thread.lastReadAt,
    latestAttentionAt: thread.latestAttentionAt,
  };
};

/**
 * The machine names a plugin can see, keyed by host id.
 *
 * `PluginSidebarThread.host.name` is the only place a host name is resolved for
 * a plugin, and it only arrives on the frontend — so the backend asks bb's host
 * list instead, which is the same directory the frontend's names came from.
 */
const hostNamesById = async (): Promise<Map<string, string>> => {
  const hosts = await bb.sdk.hosts.list();
  return new Map(hosts.map((host) => [host.id, host.name]));
};

/**
 * Shape an order write for the wire, and publish when it landed.
   *
   * A stale refusal does not publish: nothing changed, so telling every client to
   * re-read would be a round trip per refused drag.
   */
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
  const readWorkspaceDescriptors = async () => {
    const [environments, projects] = await Promise.all([
      bb.sdk.environments.list({ limit: WORKSPACE_PATH_LIMIT }),
      bb.sdk.projects.list({}),
    ]);
    const environmentDescriptors: Record<string, {
      id: string;
      projectId: string;
      hostId: string;
      path: string | null;
      isGitRepo: boolean;
      isWorktree: boolean;
      branchName: string | null;
      name: string | null;
      providerId: string | null;
      workspaceDisplayKind: "managed-worktree" | "unmanaged-worktree" | "other" | null;
    }> = {};
    for (const environment of environments) {
      environmentDescriptors[environment.id] = {
        id: environment.id,
        projectId: environment.projectId,
        hostId: environment.hostId,
        path: environment.path,
        isGitRepo: environment.isGitRepo,
        isWorktree: environment.isWorktree,
        branchName: environment.branchName,
        name: environment.name,
        providerId: environment.environmentProviderId,
        workspaceDisplayKind: workspaceDisplayKindOf(environment),
      };
    }
    const projectDescriptors: Record<string, {
      projectId: string;
      sourcePath: string | null;
      sourceHostId: string | null;
    }> = {};
    for (const project of projects) {
      const source =
        project.sources.find((candidate) => candidate.isDefault) ??
        project.sources[0];
      projectDescriptors[project.id] = {
        projectId: project.id,
        sourcePath: source?.path ?? null,
        sourceHostId: source?.hostId ?? null,
      };
    }
    return { environments: environmentDescriptors, projects: projectDescriptors };
  };

  /**
   * Recompute everything the sidebar is drawn from, and write it down for the
   * callbacks that cannot wait.
   *
   * This is the same read `listRepoFacts` serves, kept in one place so the
   * materialized index cannot drift from what the tool returns: an agent reading
   * the map and a thread being told about it must be looking at one answer, not
   * two that were computed a second apart.
   *
   * A failure leaves the previous index standing. The tree has its own reads and
   * does not depend on this; all that is lost is the summary an agent gets, and a
   * stale summary is better than none — the tools still answer from the same
   * store, and the version stamp is what stops a shape change being misread.
   */
  const refreshSidebarIndex = async (): Promise<SidebarIndex | null> => {
    try {
      const { environments, projects } = await readWorkspaceDescriptors();
      const targets = [
        ...Object.values(environments).flatMap((environment) =>
          environment.path === null
            ? []
            : [{ hostId: environment.hostId, path: environment.path }],
        ),
        ...Object.values(projects).flatMap((project) =>
          project.sourcePath === null || project.sourceHostId === null
            ? []
            : [{ hostId: project.sourceHostId, path: project.sourcePath }],
        ),
      ];
      const { facts, unavailableHostIds } = await repoFacts.read(targets);
      // A probe that answered nothing at all is a machine that is not connected
      // yet, which is the ordinary state for the first second after a load. This
      // was measured, not guessed: priming at load produced an index saying ten
      // repositories and twelve findings, where the same read a moment later said
      // nine and two, because every workspace had fallen back to being keyed by
      // its own path.
      //
      // So it is not written down. "Not read yet" is an incomplete answer, and
      // this would be a wrong one — an agent told that one repository is ten
      // would act on it. A *partial* answer is kept, because a machine that is
      // genuinely offline is a real state the panel reports and the caller can
      // see in `unavailableHostIds`.
      if (targets.length > 0 && facts.length === 0) return sidebarIndex.read();
      const inferred = inferRepos({
        environments: Object.values(environments),
        projects: new Map(Object.entries(projects)),
        facts,
      });
      const ownership = inferWorkspaceOwnership({
        environments: Object.values(environments),
        repos: inferred.repos,
        sourceByProject: inferred.sourceByProject,
        sourceRepoKeyByProject: inferred.sourceRepoKeyByProject,
      });
      const ownershipDiagnostics = ownership.diagnostics.map((diagnostic) => {
        const environmentId = diagnostic.environments[0];
        const ownershipRow =
          environmentId === undefined
            ? undefined
            : ownership.byEnvironmentId[environmentId];
        return {
          code: diagnostic.code,
          repoKey: ownershipRow?.repoKey ?? "",
          subjects: [...diagnostic.environments, ...diagnostic.projects],
          message: diagnostic.message,
        };
      });
      const list = await bb.sdk.projects.list({});
      const index: SidebarIndex = {
        projects: list.map((project) => ({ id: project.id, name: project.name })),
        groups: groups.list(),
        assignment: groups.assignments(),
        repoFacts: {
          repos: inferred.repos,
          diagnostics: [...inferred.diagnostics, ...ownershipDiagnostics],
          repoKeyByProject: Object.fromEntries(inferred.repoKeyByProject),
          sourceRepoKeyByProject: Object.fromEntries(
            inferred.sourceRepoKeyByProject,
          ),
          workspaceOwnership: ownership.byEnvironmentId,
          unseenWorkspaces: ownership.unseenByProject,
          unavailableHostIds,
        },
        environments,
        projectSources: projects,
        updatedAt: Date.now(),
      };
      sidebarIndex.write(index);
      return index;
    } catch (error) {
      bb.log.warn(
        `could not refresh the sidebar index: ${error instanceof Error ? error.message : String(error)}`,
      );
      return sidebarIndex.read();
    }
  };

  bb.rpc.register(nestRpcContract, {
    async listProjectColors() {
      return { colors: projectColors.list() };
    },
    async setProjectColor({ projectId, color }) {
      await bb.sdk.projects.get({ projectId });
      const stored = projectColors.set(projectId, color);
      bb.realtime.publish(PROJECT_COLOR_CHANNEL, { projectId });
      return stored;
    },
    async resetProjectColor({ projectId }) {
      await bb.sdk.projects.get({ projectId });
      const reset = projectColors.reset(projectId);
      bb.realtime.publish(PROJECT_COLOR_CHANNEL, { projectId });
      return { projectId, reset };
    },
    async listProjectIcons() {
      const projects = await bb.sdk.projects.list({});
      const sources = new Map<
        string,
        { path: string | null; hostId: string | null }
      >();
      for (const project of projects) {
        const source =
          project.sources.find((candidate) => candidate.isDefault) ??
          project.sources[0];
        sources.set(project.id, {
          path: source?.path ?? null,
          hostId: source?.hostId ?? null,
        });
      }
      const now = Date.now();
      const icons: Array<{ projectId: string; icon: ProjectIcon | null }> = [];
      for (const row of projectIcons.list()) {
        const current = sources.get(row.projectId);
        // A project bb no longer has, or one that now points at a different
        // checkout: the row describes something this project is not.
        if (current === undefined) continue;
        if (
          current.path !== row.sourcePath ||
          current.hostId !== row.sourceHostId
        ) {
          continue;
        }
        // An aged miss is left out rather than returned, which is what puts
        // that project back in front of the detector.
        if (row.icon === null && now - row.updatedAt >= PROJECT_ICON_MISS_TTL_MS) {
          continue;
        }
        icons.push({ projectId: row.projectId, icon: row.icon });
        if (icons.length === MAX_PROJECT_ICON_ROWS) break;
      }
      return { icons };
    },
    async detectProjectIcon({ projectId }) {
      const source = await projectSource(projectId);
      const cached = projectIcons.get(projectId);
      const cachedMatches =
        cached !== undefined &&
        source !== null &&
        cached.sourcePath === source.path &&
        cached.sourceHostId === source.hostId;
      // A stored answer that still describes this checkout is the answer, even
      // with detection switched off — turning the toggle back on must not cost
      // a probe it already paid for.
      if (cachedMatches) return { projectId, icon: cached.icon };

      // Off means off: no probe, nothing stored, and the row keeps its letter.
      const values = await settings.get();
      if (values.autoProjectIcons !== true || source === null) {
        return { projectId, icon: null };
      }

      const attempt = await worktreeHost
        .call(
          "detectProjectIcon",
          { path: source.path },
          { hostId: source.hostId, timeoutMs: PROJECT_ICON_DETECT_TIMEOUT_MS },
        )
        // An unreachable machine is not a checkout without an icon. Storing it
        // as one would hide the project's icon for a week for a reason that had
        // nothing to do with the project.
        .catch(() => ({ status: "failed" as const, message: "unreachable" }));

      if (attempt.status === "none") {
        const stored = projectIcons.set({
          projectId,
          icon: null,
          sourcePath: source.path,
          sourceHostId: source.hostId,
        });
        bb.realtime.publish(PROJECT_ICON_CHANNEL, { projectId });
        return { projectId, icon: stored.icon };
      }
      if (attempt.status === "failed") return { projectId, icon: null };

      const icon = canonicalProjectIcon({
        src: attempt.src,
        label: attempt.label,
        source: attempt.source,
      });
      if (icon === null) return { projectId, icon: null };
      const stored = projectIcons.set({
        projectId,
        icon,
        sourcePath: source.path,
        sourceHostId: source.hostId,
      });
      bb.realtime.publish(PROJECT_ICON_CHANNEL, { projectId });
      return { projectId, icon: stored.icon };
    },
    async listGroups() {
      return {
        groups: groups.list(),
        assignment: groups.assignments(),
        icons: scopeIcons.list(),
      };
    },
    async setScopeIcon({ scope, icon }) {
      const ok = scopeIcons.set(scope, icon);
      if (ok) bb.realtime.publish(GROUP_CHANNEL, {});
      return { ok };
    },
    async listWorkspacePaths() {
      return readWorkspaceDescriptors();
    },
    /**
     * The physical axis: which repository each workspace really belongs to.
     *
     * Every path bb knows about is probed on the machine that owns it, so a
     * worktree another tool created is found rather than assumed absent. The
     * project's own source is probed too, because "is this workspace in the
     * repository this project points at" is the question that separates a
     * worktree from a mistake.
     */
    async listRepoFacts() {
      // The same read that feeds the materialized index, so the map an agent
      // reads and the summary a thread is told are one answer rather than two
      // computed a second apart. It also means a sidebar load refreshes what the
      // agent callbacks will see.
      const index = await refreshSidebarIndex();
      if (index === null) {
        return {
          repos: [],
          diagnostics: [],
          repoKeyByProject: {},
          sourceRepoKeyByProject: {},
          workspaceOwnership: {},
          unseenWorkspaces: {},
          unavailableHostIds: [],
        };
      }
      return {
        repos: index.repoFacts.repos,
        diagnostics: index.repoFacts.diagnostics,
        repoKeyByProject: index.repoFacts.repoKeyByProject,
        sourceRepoKeyByProject: index.repoFacts.sourceRepoKeyByProject,
        workspaceOwnership: index.repoFacts.workspaceOwnership,
        unseenWorkspaces: index.repoFacts.unseenWorkspaces,
        unavailableHostIds: [...index.repoFacts.unavailableHostIds],
      };
    },
    async inspectWorktree({ environmentId }) {
      const survey = await surveyWorktree(environmentId);
      return { survey, plan: worktreePlanWire(planWorktreeRemoval(survey)) };
    },
    async removeWorktree({ environmentId, deleteDirectory, acknowledged }) {
      // Survey again rather than trusting the dialog's copy: the workspace can
      // have changed since it was opened, and the acknowledgements the client
      // sends are only meaningful against what bb can see now.
      const survey = await surveyWorktree(environmentId);
      const plan = planWorktreeRemoval(survey);
      const blocker = removalSubmissionBlocker(plan, {
        deleteDirectory,
        acknowledged,
      });
      if (blocker !== null) {
        return {
          ok: false,
          blocker,
          archivedThreads: false,
          environmentRemoved: false,
          directory: "kept" as const,
          message: null,
        };
      }

      // The reversible half first, and in this order: archiving is what lets bb
      // release the environment, and an environment bb refuses to release must
      // stop the whole thing before anything on disk is touched.
      await bb.sdk.environments.archiveThreads({ environmentId });

      let environmentRemoved = false;
      try {
        await bb.sdk.environments.delete({ environmentId });
        environmentRemoved = true;
        // The workspace list changed, and the repository's own record may have
        // too. What is held about this machine is a picture of the state before
        // the change, so it goes; the sidebar re-reads on its own, because the
        // environments it is holding just changed shape.
        repoFacts.invalidate();
      } catch (error) {
        return {
          ok: false,
          blocker: null,
          archivedThreads: true,
          environmentRemoved: false,
          directory: "kept" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      }

      if (!deleteDirectory) {
        return {
          ok: true,
          blocker: null,
          archivedThreads: true,
          environmentRemoved,
          directory: "kept" as const,
          message: null,
        };
      }

      const removal = await removeWorktreeDirectory({
        path: survey.path,
        hostId: survey.hostId,
        mainRepoPath: plan.directory.via === "git" ? survey.mainRepoPath : null,
      });
      return {
        ok: true,
        blocker: null,
        archivedThreads: true,
        environmentRemoved,
        directory: removal.directory,
        message: removal.message,
      };
    },
    async createGroup({ name, icon }) {
      const created = await nestActions.createGroup(name, icon);
      // The store's refusal, rethrown as the RPC's: the contract answers with a
      // group rather than with null, and the dialog already has a message for a
      // throw. The text is the store's own, kept in one place.
      if (created === null) throw new Error("Invalid group name.");
      return created;
    },
    async renameGroup({ groupId, name, icon }) {
      return { ok: await nestActions.renameGroup(groupId, name, icon) };
    },
    async deleteGroup({ groupId }) {
      const ok = groups.remove(groupId);
      if (ok) {
        // The group's project order dies with it; its projects fall back to
        // Ungrouped and are ordered there from scratch.
        orders.removeGroup(groupId);
        bb.realtime.publish(GROUP_CHANNEL, {});
        bb.realtime.publish(ORDER_CHANNEL, {});
      }
      return { ok };
    },
    async assignProjectToGroup({ projectId, groupId }) {
      return { ok: await nestActions.assignProjectToGroup(projectId, groupId) };
    },
    async reorderGroups({ groupIds }) {
      // Only ids that already exist are honoured; the store rewrites positions
      // from the array index, so unknown ids must not shift real ones.
      const known = new Set(groups.list().map((group) => group.id));
      if (!groupIds.every((id) => known.has(id))) return { ok: false };
      const ok = groups.reorder(groupIds);
      if (ok) bb.realtime.publish(GROUP_CHANNEL, {});
      return { ok };
    },
    async listManualOrder() {
      return { ...orders.list(), revision: orders.revision() };
    },
    async reorderProjects({ groupId, projectIds, baseRevision }) {
      // A project order is scoped to a group; the ungrouped bucket is a real
      // scope, but a group id that no longer exists would write a row nothing
      // reads, so it is rejected rather than stored.
      if (groupId !== UNGROUPED_ORDER_SCOPE) {
        const known = new Set(groups.list().map((group) => group.id));
        if (!known.has(groupId)) {
          return { ok: false, stale: false, revision: orders.revision() };
        }
      }
      return orderOutcome(
        orders.setProjectOrder(groupId, projectIds, baseRevision),
      );
    },
    async reorderFamilies({ projectId, rootIds, baseRevision }) {
      return orderOutcome(
        orders.setFamilyOrder(projectId, rootIds, baseRevision),
      );
    },
    async reorderWorkspaces({ projectId, workspaceKeys, baseRevision }) {
      return orderOutcome(
        orders.setWorkspaceOrder(projectId, workspaceKeys, baseRevision),
      );
    },
    async seedManualOrder({ projectIds, families }) {
      const ok = orders.seed({ projectIds, families }, groups.assignments());
      if (ok) bb.realtime.publish(ORDER_CHANNEL, {});
      return { ok };
    },
    async getViewPreferences() {
      return viewPreferences.get();
    },
    async setViewPreferences(patch) {
      const next = viewPreferences.set(patch);
      bb.realtime.publish(VIEW_PREFERENCE_CHANNEL, {});
      return next;
    },
    async renameProject({ projectId, name }) {
      const project = await bb.sdk.projects.update({ projectId, name });
      return { name: project.name };
    },
    async renameEnvironment({ environmentId, name }) {
      return { name: await nestActions.setWorkspaceAlias(environmentId, name) };
    },
    async removeProject({ projectId, expectedName }) {
      // Re-read before deleting: the dialog confirmed against a name, and a
      // project renamed in the meantime is not the one the user agreed to.
      const project = await bb.sdk.projects.get({ projectId });
      if (project.name !== expectedName) return { ok: false };
      await bb.sdk.projects.delete({ projectId });
      // A deleted project must not leave a member row pointing at nothing.
      groups.assign(projectId, null);
      orders.removeProject(projectId);
      bb.realtime.publish(GROUP_CHANNEL, {});
      return { ok: true };
    },
    async spawnThread({ request }) {
      const projectId = request.projectId;
      if (typeof projectId !== "string" || projectId.trim().length === 0) {
        throw new Error("A project is required to create a thread.");
      }
      const environment = request.environment;
      if (
        typeof environment === "object" &&
        environment !== null &&
        "type" in environment &&
        environment.type === "reuse" &&
        "environmentId" in environment &&
        typeof environment.environmentId === "string"
      ) {
        const index = await refreshSidebarIndex();
        const ownerProjectId =
          index?.repoFacts.workspaceOwnership[environment.environmentId]
            ?.ownerProjectId ?? null;
        if (ownerProjectId !== null && ownerProjectId !== projectId) {
          throw new Error(
            `This workspace belongs to ${ownerProjectId}, not ${projectId}. ` +
              "Choose the owning project or another workspace.",
          );
        }
      }
      // SAFETY: `request` is the composer's own new-thread request, forwarded
      // verbatim. The contract declares it as an open record on purpose — the
      // composer owns that shape and this plugin does not restate it — so the
      // two types cannot be compared structurally. The host validates every
      // field it reads (`threads.spawn` drops a `providerId`/`model` it does
      // not accept), and the one field this handler needs, `projectId`, is
      // checked immediately above.
      //
      // Two deliberate rewrites, both about the project's remembered execution
      // defaults. A user picks a model here and expects the next `+` to start
      // from it; without these it silently does not.
      //
      // 1. `origin: "app"`. The server writes `project_execution_defaults`
      //    only when the create's origin is `app`
      //    (`shouldRememberProjectExecutionDefaults`), so a `plugin` spawn
      //    never records anything. Measured: a thread created through this
      //    dialog left the project's defaults at `null`, and the next `+` came
      //    back to the product default. The cost is `originPluginId`, which
      //    nothing in this plugin reads.
      // 2. Every execution field the user touched is marked `explicit`. The
      //    composer reports per-field provenance, and the server drops a value
      //    whose field is absent from it (`resolveRequestedCreateExecutionValue`)
      //    — which is what made a changed reasoning level arrive as `medium`
      //    instead of the chosen `High`. The dialog's own wrapper only marks
      //    `providerId`, so the rest is filled in here.
      const request2 = request as unknown as Parameters<
        typeof bb.sdk.threads.spawn
      >[0];
      const spawned = await bb.sdk.threads.spawn({
        ...request2,
        origin: "app",
        executionInputSources: {
          providerId: "explicit",
          model: "explicit",
          reasoningLevel: "explicit",
          permissionMode: "explicit",
          ...(request2.serviceTier === undefined
            ? {}
            : { serviceTier: "explicit" as const }),
        },
      });
      return { threadId: spawned.id ?? null };
    },
    // A custom ACP provider already carries its own brand mark, so the sidebar
    // reads it from the host rather than hard-coding a second glyph per agent.
    async listProviders() {
      const providers = await bb.sdk.providers.list();
      return {
        providers: providers.map(({ id, displayName, logoUrl }) => ({
          id,
          displayName,
          logoUrl,
        })),
      };
    },
    async listLifecycle() {
      return { rows: readAll() };
    },
    /**
     * The archived threads this plugin settled in the last day, and only
     * those. A thread the user archived through bb itself has no row here and
     * stays out of the sidebar, exactly as it did before any of this existed;
     * one settled longer ago than the window keeps its row and its archive and
     * simply stops being drawn.
     *
     * The window is applied here as well as on the frontend. The frontend's is
     * the live one — it re-cuts on its own clock, so a row ages off screen
     * without a refetch — and this one keeps the response proportional to the
     * shelf instead of to the whole archive.
     */
    async listSettledThreads() {
      const now = Date.now();
      const settledAtById = new Map(
        readAll()
          .filter(
            (row) =>
              row.settledAt !== null &&
              isWithinSettledWindow(row.settledAt, now),
          )
          .map((row) => [row.threadId, row.settledAt as number]),
      );
      if (settledAtById.size === 0) return { threads: [] };
      let archived;
      try {
        archived = await listArchivedThreads();
      } catch (error) {
        // The shelf keeps whatever the frontend already had rather than
        // emptying itself over one failed read.
        bb.log.warn(`listing archived threads failed: ${String(error)}`);
        throw error;
      }
      return {
        threads: archived
          .filter((thread) => settledAtById.has(thread.id))
          .map((thread) => ({
            id: thread.id,
            // Non-null by construction: the id came from this map.
            settledAt: settledAtById.get(thread.id) ?? 0,
            projectId: thread.projectId,
            title: thread.title,
            titleFallback: thread.titleFallback,
            parentThreadId: thread.parentThreadId,
            sectionId: thread.sectionId,
            originKind: thread.originKind,
            originPluginId: thread.originPluginId,
            providerId: thread.providerId,
            status: thread.status,
            hasPendingInteraction: thread.hasPendingInteraction,
            isPinned: thread.pinnedAt !== null,
            activity: {
              workflows: thread.activity.activeWorkflowCount,
              backgroundAgents: thread.activity.activeBackgroundAgentCount,
              backgroundCommands: thread.activity.activeBackgroundCommandCount,
              planMode: thread.activity.activePlanModeCount,
              goals: thread.activity.activeGoalCount,
            },
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
            lastReadAt: thread.lastReadAt,
            latestAttentionAt: thread.latestAttentionAt,
          })),
      };
    },
    /**
     * The live view, read from bb's SDK.
     *
     * The rows the host's cache holds, read from the source and mapped into the
     * shape the list already speaks. The frontend calls this only while the
     * host view is failing, so it is a way back rather than a second opinion.
     */
    async listThreadsForRecovery() {
      const [rows, projects, hostNameById] = await Promise.all([
        listVisibleThreadRows(),
        bb.sdk.projects.list({ includePersonal: true }),
        hostNamesById(),
      ]);
      return {
        threads: rows.map((thread) => toThreadWireRow(thread, hostNameById)),
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          isPersonal: project.kind === "personal",
        })),
      };
    },
    /**
     * A project's newest archived threads, for the shelf under its list.
     *
     * The archive is where finished work goes, and bb's own sidebar view cannot
     * show it — that view is built from queries pinned to `archived: false`, the
     * same fact the settled shelf exists for — so recovering one meant a search.
     * This reads the newest few for one project, newest archive first, which is
     * the order a person looks for them in.
     *
     * Hidden rows are left out for the same reason the recovery read leaves them
     * out: the host's own sidebar does not draw them.
     */
    async listProjectArchivedThreads({
      projectId,
      ownershipMode,
      projectIds,
      environmentIds,
      limit,
    }) {
      const actualProjectIds = [...new Set(projectIds ?? [projectId])];
      const ownedEnvironmentIds = new Set(environmentIds ?? []);
      const [projectRows, hostNameById] = await Promise.all([
        Promise.all(
          actualProjectIds.map((actualProjectId) =>
            listThreadRows({ archived: true, projectId: actualProjectId }),
          ),
        ),
        hostNamesById(),
      ]);
      const rows = projectRows.flat().filter((row) => {
        if (ownershipMode === "claimed") return row.projectId === projectId;
        if (
          row.environmentId !== null &&
          ownedEnvironmentIds.has(row.environmentId)
        ) {
          return true;
        }
        return row.projectId === projectId && row.environmentId === null;
      });
      const newest = rows
        .filter((row) => row.visibility === "visible")
        .sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0))
        .slice(0, limit);
      return {
        threads: newest.map((thread) => toThreadWireRow(thread, hostNameById)),
      };
    },
    /**
     * bb's own pin order, newest-pinned last.
     *
     * The comparison is bb's: the pin sort key, compared by codepoint. That is
     * what the key is for — it survives re-pinning without renumbering the rows
     * around it — and matching it is what keeps this list in the same order as
     * the built-in sidebar. A row pinned before the key existed falls back to
     * the pin time, newest first, so it is ordered rather than dropped.
     */
    async listPinnedOrder() {
      const rows = await listVisibleThreadRows();
      const pinned = rows.filter((row) => row.pinnedAt !== null);
      pinned.sort((left, right) => {
        const leftKey = left.pinSortKey;
        const rightKey = right.pinSortKey;
        if (leftKey !== null && rightKey !== null) {
          return compareCodepoints(leftKey, rightKey);
        }
        if (leftKey !== null) return -1;
        if (rightKey !== null) return 1;
        return (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0);
      });
      return { threadIds: pinned.map((row) => row.id) };
    },
    async reorderPinned({ threadId, previousThreadId, nextThreadId }) {
      await bb.sdk.threads.reorderPinned({
        threadId,
        previousThreadId,
        nextThreadId,
      });
      return { ok: true };
    },
    async previewBulkDelete({ threadIds, protectedThreadId }) {
      return bulkDelete.preview(threadIds, protectedThreadId);
    },
    async confirmBulkDelete({ token }) {
      return bulkDelete.confirm(token);
    },
    async settle({ threadId }) {
      // Settling clears any snooze: they are two answers to the same
      // question, and holding both would make the shelf order ambiguous.
      write({
        threadId,
        settledAt: Date.now(),
        snoozedUntil: null,
        snoozedAt: null,
        archivedThreadIds: [],
      });
      // The row first, then the archive. A settled thread stays on screen
      // only because its row says so, so archiving first would blink it out
      // of the list until the row landed.
      const archivedThreadIds = await archiveThread(threadId);
      if (archivedThreadIds.length > 0) {
        // Second write, second publish — and the publish is the point. bb has
        // just evicted the thread from the host's sidebar view, so this is
        // what tells the frontend to fetch it back from `listSettledThreads`.
        // Re-read rather than re-derive: a user who restored the thread while
        // the archive was in flight must not have their un-settle overwritten
        // by the settle that started before it.
        const row = readOne(threadId);
        if (row !== undefined && row.settledAt !== null) {
          write({ ...row, archivedThreadIds });
        }
      }
      return { ok: true, archived: archivedThreadIds.length > 0 };
    },
    async unsettle({ threadId }) {
      // The archive first, then the row — the mirror of settle, for the same
      // reason: clearing the row while the thread is still archived would
      // drop it out of the sidebar entirely.
      const ids = archivedIdsFor(threadId);
      let failure = await unarchiveThreads(ids);
      if (failure !== null && (await askToRetryUnarchive(threadId, failure))) {
        // One retry, on the user's word. A second failure is logged like the
        // first and the row is cleared as before — the thread is still in bb's
        // archived view, which is where the README has always pointed.
        failure = await unarchiveThreads(ids);
      }
      clear(threadId);
      return { ok: true, message: failure };
    },
    async snooze({ threadId, snoozedUntil }) {
      const now = Date.now();
      // Snoozing a settled thread takes the archive back first: a snoozed row
      // is not on the settled shelf, so the thread has nowhere to be drawn
      // until bb reports it again.
      //
      // A failure here is the one lifecycle path that can lose a thread. The
      // host's sidebar view is built from `archived: false`, so a thread that
      // stays archived is in neither the tree nor `listSettledThreads` — while
      // the row would say it is snoozed. Nothing would draw it again until bb
      // unarchived it by hand. So the row is not written, and the failure is
      // reported instead of the thread disappearing.
      const failure = await unarchiveThreads(archivedIdsFor(threadId));
      if (failure !== null) return { ok: false, message: failure };
      write({
        threadId,
        settledAt: null,
        snoozedUntil,
        snoozedAt: now,
        archivedThreadIds: [],
      });
      return { ok: true, message: null };
    },
    async unsnooze({ threadId }) {
      clear(threadId);
      return { ok: true };
    },
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
  const primeSidebarIndex = async (attempts: number): Promise<void> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if ((await refreshSidebarIndex()) !== null) return;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  };

  void primeSidebarIndex(5);

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

function colorSetting(label: string, defaultColor: string) {
  return {
    type: "string" as const,
    label,
    description: "Six-digit hex color (#RRGGBB); used only by Custom palette.",
    default: defaultColor,
  };
}
