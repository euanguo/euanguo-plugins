/**
 * The plugin's RPC surface: what the frontend may ask for, and in what shape.
 *
 * This is one module because it is one contract. It used to be the middle third
 * of `server.ts`, which put a handler and the shape it promised hundreds of
 * lines apart, so neither could be read without the other. Here the schemas and
 * the `defineRpcContract` call are the whole file: adding a method is a change
 * to the contract, and the handler that answers it lives in `server/rpc/*.ts`
 * where the work is.
 *
 * Nothing here reaches the database, the host, or bb — which is what makes it
 * safe for the frontend to import. `useRpc<typeof nestRpcContract>` pulls this
 * module in for its type, and a module that only builds zod schemas costs
 * nothing to load.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { MAX_BULK_DELETE_ROOTS } from "../lib/bulk-delete.ts";
import { SCOPE_ICON_SCOPES } from "../lib/group-scope-icons.ts";
import { DEFAULT_GROUP_ICON } from "../lib/group-icons.ts";
import {
  MAX_GROUPS,
  MAX_GROUP_NAME_LENGTH,
  validGroupIcon,
} from "../lib/groups.ts";
import {
  MAX_ORDER_ID_LENGTH,
  MAX_ORDER_ITEMS,
  MAX_ORDER_SCOPES,
} from "../lib/manual-order.ts";
import { ORGANIZATION_MODES } from "../lib/organization.ts";
import {
  MAX_PROJECT_COLOR_ROWS,
  MAX_PROJECT_ID_LENGTH,
} from "../lib/project-colors.ts";
import {
  MAX_PROJECT_ICON_ROWS,
  PROJECT_ICON_SOURCES,
} from "../lib/project-icons.ts";
import {
  PROJECT_SORT_MODES,
  THREAD_SORT_MODES,
  WORKTREE_SORT_MODES,
} from "../lib/sort-modes.ts";
import type { WorktreeRemovalPlan } from "../lib/worktree-removal.ts";

/**
 * One group's icon on the wire.
 *
 * Validated here rather than at the handler because a stored icon is what the
 * frontend draws: an unvalidated string would reach a row as text, and the
 * store's own rule is what says which strings are allowed to.
 */
const groupIconSchema = z.string().refine(validGroupIcon, {
  message: "Unknown group icon.",
});

const threadIdSchema = z.object({ threadId: z.string().trim().min(1) });
const projectIdSchema = z
  .string()
  .min(1)
  .max(MAX_PROJECT_ID_LENGTH)
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), {
    message: "Project id contains control characters.",
  });
const projectColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-F]{6}$/i)
  .transform((value) => value.toUpperCase());
const storedProjectColorSchema = z.object({
  projectId: projectIdSchema,
  color: projectColorSchema,
});
const projectIconSchema = z.object({
  src: z.string(),
  label: z.string(),
  source: z.enum(PROJECT_ICON_SOURCES),
});
/**
 * One project's stored answer, miss included.
 *
 * The null is on the wire on purpose: it is how the sidebar tells a project
 * that was already looked at — and has no icon — from one nobody has looked at
 * yet, without asking again for the first kind.
 */
const projectIconEntrySchema = z.object({
  projectId: projectIdSchema,
  icon: projectIconSchema.nullable(),
});
const bulkDeleteSkipReasonSchema = z.enum([
  "missing",
  "current",
  "working",
  "waiting",
  "unread",
  "pinned",
  "overlap",
  "scope-changed",
]);
const bulkDeleteSkippedRootSchema = z.object({
  id: z.string(),
  reason: bulkDeleteSkipReasonSchema,
  message: z.string(),
});
const selectedThreadIdsSchema = z
  .array(z.string().trim().min(1))
  .min(1)
  .max(MAX_BULK_DELETE_ROOTS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "A root thread can be selected only once.",
  });

// Manual order: one scope's list of ids, bounded and duplicate-free. The store
// validates again on write, so a schema here only has to reject what the wire
// should never carry.
const orderItemsSchema = z
  .array(z.string().trim().min(1).max(MAX_ORDER_ID_LENGTH))
  .max(MAX_ORDER_ITEMS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "An order cannot name the same item twice.",
  });
const orderScopeIdSchema = z.string().trim().min(1).max(MAX_ORDER_ID_LENGTH);
const orderMapSchema = z
  .record(orderScopeIdSchema, orderItemsSchema)
  .refine((map) => Object.keys(map).length <= MAX_ORDER_SCOPES, {
    message: "Too many order scopes.",
  });
/**
 * What every order write answers with.
 *
 * `revision` is on every answer, refusals included, so a caller that was refused
 * always knows what to reload at. `stale` is its own flag rather than a third
 * reason: it is the one refusal the user can act on — reload and try again — and
 * a client that cannot tell it from a malformed id would have nothing to say.
 */
const orderWriteSchema = z.object({
  ok: z.boolean(),
  stale: z.boolean(),
  revision: z.number().int().nonnegative(),
});
const projectSortSchema = z.enum(PROJECT_SORT_MODES);
const threadSortSchema = z.enum(THREAD_SORT_MODES);
const worktreeSortSchema = z.enum(WORKTREE_SORT_MODES);
const organizationModeSchema = z.enum(ORGANIZATION_MODES);

/**
 * What bb can say about one workspace before anything is touched. The counts are
 * what the removal dialog has to put in front of the user, so they travel with
 * their names rather than as a tuple.
 */
const worktreeSurveySchema = z.object({
  path: z.string(),
  hostId: z.string(),
  branch: z.string().nullable(),
  /** bb created this directory, so removing it is bb's own cleanup. */
  bbOwned: z.boolean(),
  gitWorktree: z.boolean(),
  directoryExists: z.boolean(),
  mainRepoPath: z.string().nullable(),
  changedFiles: z.number().int().nonnegative(),
  untrackedFiles: z.number().int().nonnegative(),
  aheadCommits: z.number().int().nonnegative(),
  baseRef: z.string().nullable(),
  threads: z.number().int().nonnegative(),
  liveThreads: z.number().int().nonnegative(),
  openTerminals: z.number().int().nonnegative(),
});

const removalWarningSchema = z.object({
  kind: z.enum(["discard", "in-use", "external"]),
  text: z.string(),
});

const worktreeRemovalPlanSchema = z.object({
  threadCount: z.number().int().nonnegative(),
  liveThreadCount: z.number().int().nonnegative(),
  directory: z.object({
    via: z.enum(["git", "delete"]),
    warnings: z.array(removalWarningSchema),
    refusal: z.string().nullable(),
  }),
});

const removalBlockerSchema = z.enum(["unavailable", "acknowledgement"]);
/**
 * One disagreement between how bb filed a workspace and where it really is.
 *
 * Shape-only, like everything else on the wire: the code is what a client
 * switches on, and the message is already written so both sides say the same
 * sentence rather than each composing its own.
 */
const repoDiagnosticSchema = z.object({
  code: z.enum([
    "split-repo",
    "multi-repo-project",
    "orphan-workspace",
    "ownership-conflict",
    "ambiguous-owner",
    "dangling-path",
    "duplicate-path",
    "unseen-worktree",
    "path-not-canonical",
  ]),
  repoKey: z.string(),
  subjects: z.array(z.string()).readonly(),
  message: z.string(),
});

/** A worktree the repository records, which bb may have no environment for. */
const repoWorktreeSchema = z.object({
  hostId: z.string().nullable().optional(),
  path: z.string(),
  branch: z.string().nullable(),
  head: z.string().nullable(),
  detached: z.boolean(),
  prunable: z.boolean(),
});

/**
 * The plan as the wire carries it. The one difference is the warnings array:
 * the plan hands it out read-only, and zod's inferred type is mutable.
 */
export function worktreePlanWire(plan: WorktreeRemovalPlan) {
  return {
    ...plan,
    directory: { ...plan.directory, warnings: [...plan.directory.warnings] },
  };
}

/**
 * How many archived rows a project's shelf may ask for.
 *
 * A shelf is for recovering a thread you remember, not for browsing the archive
 * — bb has its own archived view for the second thing — so the contract refuses
 * more than a shelf would ever draw rather than letting a request page the whole
 * archive.
 */
const MAX_ARCHIVED_SHELF_ROWS = 50;

/**
 * One live thread as bb's SDK reports it, for the recovery read.
 *
 * Every open field is loose on purpose — `status`, `originKind`, and
 * `workspaceDisplayKind` arrive as plain strings — so a value a newer bb
 * invents degrades in `lib/recovery-threads.ts` instead of failing this output
 * validation and leaving the retry with nothing to show. `listSettledThreads`
 * makes the same trade for the same reason.
 */
const recoveryThreadRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string().nullable(),
  titleFallback: z.string().nullable(),
  parentThreadId: z.string().nullable(),
  sectionId: z.string().nullable(),
  originKind: z.string().nullable(),
  originPluginId: z.string().nullable(),
  providerId: z.string(),
  status: z.string(),
  hasPendingInteraction: z.boolean(),
  isPinned: z.boolean(),
  activity: z.object({
    workflows: z.number(),
    backgroundAgents: z.number(),
    backgroundCommands: z.number(),
    planMode: z.number(),
    goals: z.number(),
  }),
  environment: z
    .object({
      id: z.string().nullable(),
      name: z.string().nullable(),
      branchName: z.string().nullable(),
      providerId: z.string().nullable(),
      workspaceDisplayKind: z.string().nullable(),
    })
    .nullable(),
  host: z.object({ id: z.string(), name: z.string() }).nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastReadAt: z.number().nullable(),
  latestAttentionAt: z.number(),
});

export const nestRpcContract = defineRpcContract({
  listProjectColors: {
    input: z.object({}),
    output: z.object({
      colors: z.array(storedProjectColorSchema).max(MAX_PROJECT_COLOR_ROWS),
    }),
  },
  setProjectColor: {
    input: z.object({ projectId: projectIdSchema, color: projectColorSchema }),
    output: storedProjectColorSchema,
  },
  resetProjectColor: {
    input: z.object({ projectId: projectIdSchema }),
    output: z.object({ projectId: projectIdSchema, reset: z.boolean() }),
  },
  /**
   * Every project icon this build can still stand behind, misses included.
   *
   * Rows are filtered against what bb says each project's source is right now,
   * so an answer is only ever about a checkout the project still points at —
   * and a miss ages out (see `PROJECT_ICON_MISS_TTL_MS`) so a favicon added
   * later still turns up. Whatever is absent here is what the caller probes.
   */
  listProjectIcons: {
    input: z.object({}),
    output: z.object({
      icons: z.array(projectIconEntrySchema).max(MAX_PROJECT_ICON_ROWS),
    }),
  },
  /**
   * Look for a project's icon in its checkout, once.
   *
   * `icon: null` covers both "this checkout has none" and "there is nothing to
   * probe", and the caller treats them the same: the row keeps its letter.
   */
  detectProjectIcon: {
    input: z.object({ projectId: projectIdSchema }),
    output: projectIconEntrySchema,
  },
  // Project groups: the level above projects. Everything on a group row
  // (counts, worst status) is derived from its threads at render time, so the
  // wire carries only identity, name, order, and membership.
  listGroups: {
    input: z.object({}),
    output: z.object({
      groups: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          position: z.number(),
          icon: groupIconSchema,
        }),
      ),
      assignment: z.record(z.string(), z.string()),
      // The strip's own two tabs are not rows in project_groups, so their icons
      // travel beside the groups rather than inside them.
      icons: z.object({
        all: groupIconSchema,
        ungrouped: groupIconSchema,
      }),
    }),
  },
  setScopeIcon: {
    input: z.object({
      scope: z.enum(SCOPE_ICON_SCOPES),
      icon: groupIconSchema,
    }),
    output: z.object({ ok: z.boolean() }),
  },
  /**
   * The absolute path of each workspace and project, for the copy actions.
   *
   * Neither the app's environment DTO nor its project DTO carries a path, and
   * the clipboard lives in the app, so this is the one read a "copy path" needs
   * from this side.
   */
  listWorkspacePaths: {
    input: z.object({}),
    output: z.object({
      /** environmentId -> authoritative workspace facts. */
      environments: z.record(
        z.string(),
        z.object({
          id: z.string(),
          projectId: z.string(),
          hostId: z.string(),
          path: z.string().nullable(),
          isGitRepo: z.boolean(),
          isWorktree: z.boolean(),
          branchName: z.string().nullable(),
          name: z.string().nullable(),
          providerId: z.string().nullable(),
          workspaceDisplayKind: z.enum(["managed-worktree", "unmanaged-worktree", "other"]).nullable(),
        }),
      ),
      /** projectId -> the project's configured source. */
      projects: z.record(
        z.string(),
        z.object({
          projectId: z.string(),
          sourcePath: z.string().nullable(),
          sourceHostId: z.string().nullable(),
        }),
      ),
    }),
  },
  /**
   * The physical axis: which repository each workspace really belongs to.
   *
   * Separate from `listWorkspacePaths` because it costs a round trip to every
   * machine holding a workspace, and the path read does not. A client that only
   * copies paths should not wait for a probe, and one that draws the tree can
   * paint bb's own answer first and re-group when this lands.
   *
   * `unavailableHostIds` is what keeps a partial answer from looking complete:
   * the workspaces on those machines are placed from their paths alone, which
   * is why they carry a `dangling-path` diagnostic.
   */
  listRepoFacts: {
    input: z.object({}),
    output: z.object({
      repos: z
        .array(
          z.object({
            key: z.string(),
            kind: z.enum(["git-remote", "git-local", "directory"]),
            name: z.string(),
            remoteUrl: z.string().nullable(),
            rootPath: z.string().nullable(),
            hostIds: z.array(z.string()).readonly(),
            projectIds: z.array(z.string()).readonly(),
            workspaces: z
              .array(
                z.object({
                  key: z.string(),
                  hostId: z.string(),
                  path: z.string(),
                  /** Every spelling bb used, so a mismatch can be shown. */
                  rawPaths: z.array(z.string()).readonly(),
                  environmentIds: z.array(z.string()).readonly(),
                  projectIds: z.array(z.string()).readonly(),
                  repoKey: z.string(),
                  isMainWorktree: z.boolean(),
                  isLinkedWorktree: z.boolean(),
                  isNestedRepository: z.boolean(),
                  repositoryRoot: z.string().nullable(),
                }),
              )
              .readonly(),
            unseenWorktrees: z.array(repoWorktreeSchema).readonly(),
            diagnostics: z.array(repoDiagnosticSchema).readonly(),
          }),
        )
        .readonly(),
      diagnostics: z.array(repoDiagnosticSchema).readonly(),
      /** projectId -> repoKey, for a caller that only wants the grouping. */
      repoKeyByProject: z.record(z.string(), z.string()),
      /** projectId -> the repository named by its configured source. */
      sourceRepoKeyByProject: z.record(z.string(), z.string()),
      workspaceOwnership: z.record(
        z.string(),
        z.object({
          environmentId: z.string(),
          claimedProjectId: z.string(),
          ownerProjectId: z.string().nullable(),
          workspaceKey: z.string(),
          repoKey: z.string().nullable(),
          kind: z.enum([
            "project-checkout",
            "git-worktree",
            "nested-checkout",
            "external-checkout",
            "external-directory",
            "personal",
            "unresolved",
          ]),
          confidence: z.enum([
            "exact-source",
            "local-repository",
            "shared-remote",
            "contained",
            "claimed",
            "unresolved",
          ]),
          conflict: z.boolean(),
        }),
      ),
      unseenWorkspaces: z.record(
        z.string(),
        z.array(
          z.object({
            projectId: z.string(),
            repoKey: z.string(),
            hostId: z.string(),
            path: z.string(),
            branch: z.string().nullable(),
            detached: z.boolean(),
          }),
        ).readonly(),
      ),
      unavailableHostIds: z.array(z.string()).readonly(),
    }),
  },
  // Removing a worktree row. One operation, three things, and only the third is
  // irreversible — so inspection answers with the numbers, and the plan says
  // what the user still has to acknowledge before the directory may go.
  inspectWorktree: {
    input: z.object({ environmentId: z.string().trim().min(1) }),
    output: z.object({
      survey: worktreeSurveySchema,
      plan: worktreeRemovalPlanSchema,
    }),
  },
  removeWorktree: {
    input: z.object({
      environmentId: z.string().trim().min(1),
      deleteDirectory: z.boolean(),
      acknowledged: z.boolean(),
    }),
    output: z.object({
      /** The reversible half: threads archived and the environment released. */
      ok: z.boolean(),
      /** Set when the server refused before doing anything. */
      blocker: removalBlockerSchema.nullable(),
      archivedThreads: z.boolean(),
      environmentRemoved: z.boolean(),
      directory: z.enum(["kept", "removed", "failed"]),
      message: z.string().nullable(),
    }),
  },
  createGroup: {
    input: z.object({
      name: z.string().trim().min(1).max(MAX_GROUP_NAME_LENGTH),
      icon: groupIconSchema.default(DEFAULT_GROUP_ICON),
    }),
    output: z.object({
      id: z.string(),
      name: z.string(),
      position: z.number(),
      icon: groupIconSchema,
    }),
  },
  renameGroup: {
    input: z.object({
      groupId: z.string().trim().min(1),
      name: z.string().trim().min(1).max(MAX_GROUP_NAME_LENGTH),
      icon: groupIconSchema.optional(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  deleteGroup: {
    input: z.object({ groupId: z.string().trim().min(1) }),
    output: z.object({ ok: z.boolean() }),
  },
  assignProjectToGroup: {
    input: z.object({
      projectId: projectIdSchema,
      groupId: z.string().trim().min(1).nullable(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  reorderGroups: {
    input: z.object({
      groupIds: z.array(z.string().trim().min(1)).max(MAX_GROUPS),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  // Manual order: the user's own arrangement, one list per scope. Separate
  // from the sort mode, which is only a lens over it.
  listManualOrder: {
    input: z.object({}),
    output: z.object({
      projects: orderMapSchema,
      families: orderMapSchema,
      workspaces: orderMapSchema,
      /** The revision this arrangement was read at; a write sends it back. */
      revision: z.number().int().nonnegative(),
    }),
  },
  reorderProjects: {
    input: z.object({
      groupId: orderScopeIdSchema,
      projectIds: orderItemsSchema,
      baseRevision: z.number().int().nonnegative(),
    }),
    output: orderWriteSchema,
  },
  reorderFamilies: {
    input: z.object({
      projectId: orderScopeIdSchema,
      rootIds: orderItemsSchema,
      baseRevision: z.number().int().nonnegative(),
    }),
    output: orderWriteSchema,
  },
  /**
   * The worktrees of one project. The checkout is deliberately not in the list:
   * it leads the project under every arrangement, so there is nothing to store
   * for it and nothing that could move it.
   */
  reorderWorkspaces: {
    input: z.object({
      projectId: orderScopeIdSchema,
      workspaceKeys: orderItemsSchema,
      baseRevision: z.number().int().nonnegative(),
    }),
    output: orderWriteSchema,
  },
  /**
   * One-time migration from the browser-local order. The project ids arrive as
   * the legacy global list and are split by group membership here, because
   * this is the side that already knows the assignment.
   */
  seedManualOrder: {
    input: z.object({
      projectIds: z
        .array(z.string().trim().min(1).max(MAX_ORDER_ID_LENGTH))
        .max(MAX_ORDER_ITEMS * 4),
      families: orderMapSchema,
    }),
    output: z.object({ ok: z.boolean() }),
  },
  // View preferences the sidebar writes itself, because the frontend cannot
  // write `bb.settings`.
  getViewPreferences: {
    input: z.object({}),
    output: z.object({
      projectSort: projectSortSchema,
      threadSort: threadSortSchema,
      worktreeSort: worktreeSortSchema,
      organizationMode: organizationModeSchema,
    }),
  },
  setViewPreferences: {
    input: z.object({
      projectSort: projectSortSchema.optional(),
      threadSort: threadSortSchema.optional(),
      worktreeSort: worktreeSortSchema.optional(),
      organizationMode: organizationModeSchema.optional(),
    }),
    output: z.object({
      projectSort: projectSortSchema,
      threadSort: threadSortSchema,
      worktreeSort: worktreeSortSchema,
      organizationMode: organizationModeSchema,
    }),
  },
  /**
   * Rename a project. Thin on purpose: the name is bb's own field, and the
   * sidebar's project row is a second way into it rather than a parallel
   * store. bb validates the value, so nothing is re-checked here beyond the
   * empty case it would reject anyway.
   */
  renameProject: {
    input: z.object({
      projectId: projectIdSchema,
      name: z.string().trim().min(1),
    }),
    output: z.object({ name: z.string() }),
  },
  /**
   * Rename a worktree — its environment's display name, which is the alias the
   * sidebar shows beside the branch.
   *
   * bb owns this field, so this is a forward rather than a second store: the
   * worktree then reads the same way everywhere, and a branch change can never
   * disagree with a name only this plugin knew about.
   */
  renameEnvironment: {
    input: z.object({
      environmentId: z.string().trim().min(1),
      name: z.string().trim().min(1).max(120),
    }),
    output: z.object({ name: z.string().nullable() }),
  },
  /**
   * Remove a project and its threads.
   *
   * Destructive and recursive, so the confirmation lives in the UI and the
   * request carries the project's current name: a rename between the dialog
   * opening and the click must fail rather than delete something the user did
   * not name. The plugin never removes a project the user has not typed for.
   */
  removeProject: {
    input: z.object({
      projectId: projectIdSchema,
      expectedName: z.string().trim().min(1),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  /**
   * Create a thread from the new-thread dialog.
   *
   * The request body is forwarded to `threads.spawn` as-is rather than
   * re-declared here: it is bb's own composer output, and re-typing that schema
   * would silently drop any field the host adds later. Only the two facts this
   * plugin actually depends on are asserted — a project is named, and the
   * origin says it came from a plugin.
   */
  spawnThread: {
    input: z.object({ request: z.record(z.string(), z.unknown()) }),
    output: z.object({ threadId: z.string().nullable() }),
  },
  listProviders: {
    input: z.object({}),
    output: z.object({
      providers: z.array(
        z.object({
          id: z.string(),
          displayName: z.string(),
          logoUrl: z.string().nullable(),
        }),
      ),
    }),
  },
  listLifecycle: {
    input: z.object({}),
    output: z.object({
      rows: z.array(
        z.object({
          threadId: z.string(),
          settledAt: z.number().nullable(),
          snoozedUntil: z.number().nullable(),
          snoozedAt: z.number().nullable(),
        }),
      ),
    }),
  },
  // The settled shelf's own rows. bb's sidebar view is built from queries
  // pinned to `archived: false`, so a settled — and therefore archived —
  // thread never reaches the frontend through the host. It comes through here
  // instead, and only for the last day: see `SETTLED_WINDOW_MS`. Fields are
  // deliberately loose (`status`, `originKind` as plain strings) so a new bb
  // value degrades in the mapper rather than failing output validation and
  // blanking the shelf.
  listSettledThreads: {
    input: z.object({}),
    output: z.object({
      threads: z.array(
        z.object({
          id: z.string(),
          settledAt: z.number(),
          projectId: z.string(),
          title: z.string().nullable(),
          titleFallback: z.string().nullable(),
          parentThreadId: z.string().nullable(),
          sectionId: z.string().nullable(),
          originKind: z.string().nullable(),
          originPluginId: z.string().nullable(),
          providerId: z.string(),
          status: z.string(),
          hasPendingInteraction: z.boolean(),
          isPinned: z.boolean(),
          activity: z.object({
            workflows: z.number(),
            backgroundAgents: z.number(),
            backgroundCommands: z.number(),
            planMode: z.number(),
            goals: z.number(),
          }),
          createdAt: z.number(),
          updatedAt: z.number(),
          lastReadAt: z.number().nullable(),
          latestAttentionAt: z.number(),
        }),
      ),
    }),
  },
  // The live view's own rows, read from bb's SDK rather than from the host's
  // sidebar cache.
  //
  // `experimental_useSidebarThreads` has no refetch, so when the host reports
  // `error` a plugin has no way back and the user has no retry. This is that
  // way. It is a fallback, not a second source of truth: the frontend consults
  // it only while the host view is failing, and the host's answer wins the
  // moment it returns.
  listThreadsForRecovery: {
    input: z.object({}),
    output: z.object({
      threads: z.array(recoveryThreadRowSchema),
      projects: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          isPersonal: z.boolean(),
        }),
      ),
    }),
  },
  // A project's newest archived threads, for the shelf under its list.
  listProjectArchivedThreads: {
    input: z.object({
      projectId: z.string().trim().min(1),
      ownershipMode: z.enum(["claimed", "filesystem"]).default("claimed"),
      /** Real bb projects whose claimed archives may contribute owned rows. */
      projectIds: z.array(z.string().trim().min(1)).max(32).optional(),
      /** Environment ids physically owned by the display project. */
      environmentIds: z.array(z.string().trim().min(1)).max(500).optional(),
      limit: z.number().int().positive().max(MAX_ARCHIVED_SHELF_ROWS),
    }),
    output: z.object({ threads: z.array(recoveryThreadRowSchema) }),
  },
  // bb's own pin order, as a list of root ids.
  //
  // The frontend cannot derive this. `PluginSidebarThread` carries `isPinned` and
  // nothing else about the pin, so a section ordered from the host view would be
  // ordered by whatever the array happened to be in. Reading the key from bb's
  // own table is what makes a pin moved in the built-in sidebar land in the same
  // place here.
  listPinnedOrder: {
    input: z.object({}),
    output: z.object({ threadIds: z.array(z.string()) }),
  },
  // The write side of the same order, routed to bb's own mutation so every
  // surface that draws pinned threads agrees afterwards.
  reorderPinned: {
    input: z.object({
      threadId: z.string().trim().min(1),
      previousThreadId: z.string().trim().min(1).nullable(),
      nextThreadId: z.string().trim().min(1).nullable(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  previewBulkDelete: {
    input: z.object({
      threadIds: selectedThreadIdsSchema,
      protectedThreadId: z.string().trim().min(1).nullable(),
    }),
    output: z.object({
      token: z.string().nullable(),
      expiresAt: z.number().int().positive().nullable(),
      included: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          childCount: z.number().int().nonnegative(),
        }),
      ),
      skipped: z.array(bulkDeleteSkippedRootSchema),
      rootCount: z.number().int().nonnegative(),
      childCount: z.number().int().nonnegative(),
      totalThreadCount: z.number().int().nonnegative(),
    }),
  },
  confirmBulkDelete: {
    input: z.object({ token: z.string().trim().min(1).max(200) }),
    output: z.object({
      deleted: z.array(z.string()),
      skipped: z.array(bulkDeleteSkippedRootSchema),
      failed: z.array(
        z.object({ id: z.string(), message: z.string().max(240) }),
      ),
    }),
  },
  /**
   * `archived` is bb's half of the park, and it can fail on its own: the call
   * reaches the thread's host, which may be offline. The row is written either
   * way — a settle the user asked for is not undone by an unreachable machine —
   * so the caller needs this flag to say the two halves disagree.
   */
  settle: {
    input: threadIdSchema,
    output: z.object({ ok: z.boolean(), archived: z.boolean() }),
  },
  /**
   * `message` is the unarchive failure, when there was one. The row is cleared
   * regardless — it describes a park the user has taken back — so a non-null
   * message means the thread is no longer parked here but is still archived in
   * bb, and the only route back is bb's own archived view.
   */
  unsettle: {
    input: threadIdSchema,
    output: z.object({ ok: z.boolean(), message: z.string().nullable() }),
  },
  snooze: {
    input: z.object({
      threadId: z.string().trim().min(1),
      // Absolute wake time, so a snooze means the same thing on every device.
      snoozedUntil: z.number().int().positive(),
    }),
    output: z.object({ ok: z.boolean(), message: z.string().nullable() }),
  },
  unsnooze: { input: threadIdSchema, output: z.object({ ok: z.boolean() }) },
});
