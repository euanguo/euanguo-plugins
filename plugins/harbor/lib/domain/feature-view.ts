/**
 * The Features section: the work itself, one feature after another.
 *
 * Features are a flat list in their own order. They are not filed into groups,
 * but the strip still narrows them: a group tab shows the features that touch a
 * project filed there, derived from the owners of their member workspaces and
 * never stored.
 *
 * This is a lens, not a second tree. It is fed the very families the project
 * rows draw, already filtered by the status preset and searched, and buckets
 * them by the feature the workspace index puts their workspace in. A workspace
 * that belongs to an active feature is drawn here and nowhere else, so the
 * project rows leave it out.
 *
 * Inside a feature there are two kinds of workspace: the feature folder itself,
 * where the root conversations plan the work, and one member workspace per
 * repository. Every member the index knows is a row, conversation or not,
 * because this is the only place it is drawn.
 */

import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import {
  EMPTY_META_SUMMARY,
  type FeatureMetaSummary,
} from "./feature-meta.ts";
import {
  isFeatureRoot,
  sortFeatures,
  type Feature,
  type FeatureMember,
} from "./features.ts";
import type { ThreadFamily } from "./inbox.ts";
import { rollupThreads, statusKindRank, type StatusRollup } from "./rollup.ts";
import { familyUpdatedAt } from "./thread-management.ts";
import type { WorkspaceNode } from "./tree.ts";
import type { Workspace, WorkspaceIndex } from "./workspace-index.ts";

export const FEATURE_FILTER_PRESETS = [
  "all",
  "needs-you",
  "dirty",
  "stale",
] as const;

export type FeatureFilterPreset = (typeof FEATURE_FILTER_PRESETS)[number];

export const FEATURE_FILTER_LABELS: Readonly<
  Record<FeatureFilterPreset, string>
> = {
  all: "All",
  "needs-you": "Needs you",
  dirty: "Dirty",
  stale: "Stale",
};

export const FEATURE_FILTER_DESCRIPTIONS: Readonly<
  Record<FeatureFilterPreset, string>
> = {
  all: "Show all active features",
  "needs-you": "Auto-filter: features with threads waiting for input or failed",
  dirty: "Auto-filter: features with uncommitted git changes",
  stale: "Auto-filter: features with no recent activity",
};

export const FEATURE_SORT_MODES = [
  "activity",
  "status",
  "name",
  "manual",
] as const;

export type FeatureSortMode = (typeof FEATURE_SORT_MODES)[number];

export const DEFAULT_FEATURE_SORT: FeatureSortMode = "activity";

export const FEATURE_SORT_LABELS: Readonly<Record<FeatureSortMode, string>> = {
  activity: "Recent activity",
  status: "Attention",
  name: "Name A→Z",
  manual: "Created order",
};

export type FeatureOpenTarget =
  | { readonly kind: "thread"; readonly threadId: string }
  | { readonly kind: "new-feature-chat"; readonly featureId: string };

function latestFamilyIn(families: readonly ThreadFamily[]): ThreadFamily | null {
  let best: ThreadFamily | null = null;
  let bestUpdated = -1;
  for (const family of families) {
    const updated = familyUpdatedAt(family);
    if (
      best === null ||
      updated > bestUpdated ||
      (updated === bestUpdated &&
        (family.root.createdAt > best.root.createdAt ||
          (family.root.createdAt === best.root.createdAt &&
            family.root.id.localeCompare(best.root.id) < 0)))
    ) {
      best = family;
      bestUpdated = updated;
    }
  }
  return best;
}

/**
 * Resolves the single-click target of a Feature row:
 * urgent failure/waiting thread first, else remembered active thread across
 * the feature, else latest feature-root conversation, else latest member-repo
 * conversation, else a fresh feature-root chat screen (never a blocking modal).
 */
export function featureOpenTarget(input: {
  readonly featureId: string;
  readonly rollup: StatusRollup;
  readonly rootFamilies: readonly ThreadFamily[];
  readonly memberFamilies: readonly ThreadFamily[];
  readonly lastActiveThreadId: string | null;
}): FeatureOpenTarget {
  const {
    featureId,
    rollup,
    rootFamilies,
    memberFamilies,
    lastActiveThreadId,
  } = input;
  if (
    (rollup.kind === "failed" || rollup.kind === "needs-you") &&
    rollup.leadThreadId !== null
  ) {
    return { kind: "thread", threadId: rollup.leadThreadId };
  }
  if (lastActiveThreadId !== null) {
    const allFamilies = [...rootFamilies, ...memberFamilies];
    const hasLast = allFamilies.some(
      (family) =>
        family.root.id === lastActiveThreadId ||
        family.children.some((child) => child.id === lastActiveThreadId),
    );
    if (hasLast) {
      return { kind: "thread", threadId: lastActiveThreadId };
    }
  }
  const rootLatest = latestFamilyIn(rootFamilies);
  if (rootLatest !== null) {
    return { kind: "thread", threadId: rootLatest.root.id };
  }
  const memberLatest = latestFamilyIn(memberFamilies);
  if (memberLatest !== null) {
    return { kind: "thread", threadId: memberLatest.root.id };
  }
  return { kind: "new-feature-chat", featureId };
}

/** A workspace drawn under a feature, with the project its menus act on. */
export interface FeatureWorkspaceNode extends WorkspaceNode {
  readonly ref: Workspace;
  readonly projectId: string;
  readonly projectName: string;
}

export interface FeatureNode {
  readonly feature: Feature;
  /** What the feature has recorded besides its folder, as counts. */
  readonly meta: FeatureMetaSummary;
  /**
   * The feature folder's own workspace, with the root conversations in it.
   *
   * Null until bb has an environment there and nothing runs in it yet, which
   * is the state of a feature that was just named.
   */
  readonly root: FeatureWorkspaceNode | null;
  /** Conversations whose cwd is the feature folder itself. */
  readonly rootFamilies: ThreadFamily[];
  /** Member workspaces, one per repository the index knows of. */
  readonly workspaces: FeatureWorkspaceNode[];
  /** Every worktree on disk in the folder, for the repositories line. */
  readonly members: readonly FeatureMember[];
  readonly rollup: StatusRollup;
  readonly threadCount: number;
}

export interface FeatureViewInput {
  /** Families from every project, unpruned by project filters or search. */
  readonly families: readonly ThreadFamily[];
  readonly features: readonly Feature[];
  /** Workspaces drawn in another section, which this one leaves out. */
  readonly drawnElsewhere?: ReadonlySet<string>;
  readonly members: readonly FeatureMember[];
  readonly workspaceIndex: WorkspaceIndex;
  readonly meta?: Readonly<Record<string, FeatureMetaSummary>>;
  readonly workspaceChanges?: ReadonlyMap<
    string,
    { readonly insertions: number; readonly deletions: number }
  >;
  readonly filter?: FeatureFilterPreset;
  readonly sort?: FeatureSortMode;
  readonly pinnedFeatureIds?: readonly string[];
  /**
   * Whether a feature or member with no matching conversation is still drawn.
   *
   * True with no filter and no search: an empty feature is a real destination
   * the user just made. False otherwise, because a filter that answers with
   * every feature it did not match is not a filter.
   */
  readonly showEmpty: boolean;
  readonly searchQuery: string;
  readonly projectNames: ReadonlyMap<string, string>;
  readonly now: number;
}

export interface FeatureView {
  readonly features: FeatureNode[];
  /** Parked features awaiting wake conditions or manual restore. */
  readonly parked: readonly Feature[];
  /** Finished features, in their own order, for the shelf at the bottom. */
  readonly archived: readonly Feature[];
}

/** Features a workspace can be drawn under: active ones only. A parked feature sits on the Parked shelf; a finished feature hands its rows back. */
export function activeFeatureIds(features: readonly Feature[]): ReadonlySet<string> {
  return new Set(
    features.filter((feature) => feature.state === "active").map((feature) => feature.id),
  );
}

const PARK_REASON_LABELS: Record<string, string> = {
  "waiting-qa": "Waiting QA",
  "waiting-backend": "Waiting Backend",
  "waiting-release": "Waiting Release",
  deferred: "Deferred",
};

export function parkReasonLabel(reason: string | null | undefined): string | null {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (trimmed.length === 0) return null;
  return PARK_REASON_LABELS[trimmed] ?? trimmed;
}

export function formatWakeLabel(
  wakeAt: number | null | undefined,
  now: number,
): string | null {
  if (typeof wakeAt !== "number" || !Number.isFinite(wakeAt)) return null;
  const deltaMs = wakeAt - now;
  if (deltaMs <= 0) return "Due now";
  const hours = Math.round(deltaMs / 3_600_000);
  if (hours < 1) {
    const mins = Math.max(1, Math.round(deltaMs / 60_000));
    return `Wake in ${mins}m`;
  }
  if (hours < 24) return `Wake in ${hours}h`;
  const days = Math.round(hours / 24);
  if (days <= 14) return `Wake in ${days}d`;
  return new Date(wakeAt).toLocaleDateString();
}

/** Features that still own their worktrees and suppress duplicate rows under Projects (active + parked). */
export function ownedFeatureIds(features: readonly Feature[]): ReadonlySet<string> {
  return new Set(
    features.filter((feature) => feature.state !== "archived").map((feature) => feature.id),
  );
}

/** Whether the Features section draws this workspace instead of its project. */
export function inActiveFeature(
  workspace: Pick<Workspace, "featureId"> | null,
  active: ReadonlySet<string>,
): boolean {
  return workspace !== null && workspace.featureId !== null && active.has(workspace.featureId);
}

export function buildFeatureView(input: FeatureViewInput): FeatureView {
  const {
    families,
    features,
    members,
    showEmpty,
    projectNames,
    workspaceIndex,
    now,
    workspaceChanges,
  } = input;
  const filter = input.filter ?? "all";
  const drawnElsewhere = input.drawnElsewhere ?? new Set<string>();
  const active = activeFeatureIds(features);
  const query = input.searchQuery.trim().toLowerCase();
  const matches = (value: string | null | undefined) =>
    query.length > 0 &&
    typeof value === "string" &&
    value.toLowerCase().includes(query);

  const threadTitle = (thread: PluginSidebarThread): string =>
    thread.title?.trim() || thread.titleFallback?.trim() || "";

  const isDirtyWorkspace = (workspace: Workspace): boolean =>
    workspace.environmentIds.some((environmentId) => {
      const counts = workspaceChanges?.get(environmentId);
      return (
        counts !== undefined &&
        (counts.insertions > 0 || counts.deletions > 0)
      );
    });

  const familyNeedsAttention = (family: ThreadFamily): boolean =>
    [family.root, ...family.children].some(
      (thread) =>
        thread.hasPendingInteraction ||
        thread.indicator === "waiting-for-input" ||
        thread.indicator === "unread-error",
    );

  const filterFamiliesByQuery = (
    items: readonly ThreadFamily[],
  ): ThreadFamily[] => {
    if (query.length === 0) return [...items];
    return items.flatMap((family) => {
      if (matches(threadTitle(family.root))) return [family];
      const children = family.children.filter((child) =>
        matches(threadTitle(child)),
      );
      return children.length > 0 ? [{ ...family, children }] : [];
    });
  };

  const hasAttentionMeta = (meta: FeatureMetaSummary): boolean =>
    meta.draftCount > 0 ||
    meta.blockerCount > 0 ||
    meta.openQuestionCount > 0;

  const familiesByKey = new Map<string, ThreadFamily[]>();
  for (const family of families) {
    const workspace = workspaceIndex.workspaceOfThread(family.root);
    if (workspace === null || !inActiveFeature(workspace, active)) continue;
    const bucket = familiesByKey.get(workspace.key) ?? [];
    bucket.push(family);
    familiesByKey.set(workspace.key, bucket);
  }

  const workspaceNode = (
    workspace: Workspace,
    inWorkspace: ThreadFamily[],
  ): FeatureWorkspaceNode => ({
    ref: workspace,
    families: inWorkspace,
    rollup: rollupThreads(threadsOf(inWorkspace), now),
    projectId: workspace.projectId,
    projectName: projectNames.get(workspace.projectId) ?? workspace.projectId,
  });

  const nodeOf = (feature: Feature): FeatureNode | null => {
    const inFeature = (workspaceIndex.byFeature.get(feature.id) ?? []).filter(
      (workspace) => !drawnElsewhere.has(workspace.key),
    );
    const rootWorkspace =
      inFeature.find((workspace) => isFeatureRoot(feature, workspace.path)) ??
      null;
    const meta = input.meta?.[feature.id] ?? EMPTY_META_SUMMARY;
    const attentionMeta = hasAttentionMeta(meta);
    const unfilteredFamilies = inFeature.flatMap(
      (workspace) => familiesByKey.get(workspace.key) ?? [],
    );
    const unfilteredRollup = rollupThreads(threadsOf(unfilteredFamilies), now);

    if (filter === "needs-you") {
      if (
        unfilteredRollup.needsYou === 0 &&
        unfilteredRollup.failed === 0 &&
        !attentionMeta
      ) {
        return null;
      }
    } else if (filter === "dirty") {
      if (!inFeature.some(isDirtyWorkspace)) return null;
    } else if (filter === "stale") {
      if (unfilteredFamilies.length === 0 || unfilteredRollup.kind !== "stale") {
        return null;
      }
    }

    const featureMatches = matches(feature.name);

    const resolveWorkspaceNode = (
      workspace: Workspace,
      isRoot: boolean,
    ): FeatureWorkspaceNode | null => {
      const raw = familiesByKey.get(workspace.key) ?? [];
      if (filter === "dirty" && !isDirtyWorkspace(workspace)) return null;

      const filterNarrowed =
        filter === "needs-you" && !attentionMeta
          ? raw.filter(familyNeedsAttention)
          : raw;
      if (
        filter === "needs-you" &&
        !attentionMeta &&
        filterNarrowed.length === 0
      ) {
        return null;
      }

      const projectName =
        projectNames.get(workspace.projectId) ?? workspace.projectId;
      const workspaceMatches =
        featureMatches ||
        matches(workspace.label) ||
        matches(workspace.branch) ||
        (!isRoot && matches(projectName));

      const matchedFamilies =
        query.length === 0 || workspaceMatches
          ? filterNarrowed
          : filterFamiliesByQuery(filterNarrowed);

      const keepEmpty =
        filter === "dirty" ||
        (filter === "needs-you" && attentionMeta) ||
        (filter === "all" && (showEmpty || workspaceMatches));

      if (matchedFamilies.length === 0 && !keepEmpty) return null;
      if (query.length > 0 && !workspaceMatches && matchedFamilies.length === 0) {
        return null;
      }
      return workspaceNode(workspace, matchedFamilies);
    };

    const root =
      rootWorkspace === null ? null : resolveWorkspaceNode(rootWorkspace, true);
    const memberRows = inFeature
      .filter((workspace) => workspace !== rootWorkspace)
      .flatMap((workspace) => {
        const node = resolveWorkspaceNode(workspace, false);
        return node === null ? [] : [node];
      });
    const all = [
      ...(root?.families ?? []),
      ...memberRows.flatMap((node) => node.families),
    ];
    const visible =
      all.length > 0 ||
      memberRows.length > 0 ||
      root !== null ||
      (filter === "all" && (showEmpty || featureMatches)) ||
      (filter === "needs-you" && attentionMeta && (query.length === 0 || featureMatches));
    if (!visible) return null;
    return {
      feature,
      meta,
      root,
      rootFamilies: root?.families ?? [],
      workspaces: memberRows,
      members: members.filter((member) => member.featureId === feature.id),
      rollup: rollupThreads(threadsOf(all), now),
      threadCount: threadsOf(all).length,
    };
  };

  const shown = sortFeatures(
    features.filter((feature) => active.has(feature.id)),
  );
  const unsortedNodes = shown.flatMap((feature) => nodeOf(feature) ?? []);
  const sortedNodes = sortFeatureNodes(
    unsortedNodes,
    input.sort ?? "manual",
    input.pinnedFeatureIds ?? [],
  );

  const matchesFeatureQuery = (feature: Feature): boolean => {
    if (query.length === 0) return true;
    return (
      matches(feature.name) ||
      matches(feature.parkedReason) ||
      matches(feature.parkedNote)
    );
  };

  const parked = sortFeatures(
    features.filter((feature) => feature.state === "parked"),
  )
    .filter(matchesFeatureQuery)
    .filter((feature) => {
      if (filter === "all" || filter === "stale") return true;
      if (filter === "needs-you") {
        const meta = input.meta?.[feature.id] ?? EMPTY_META_SUMMARY;
        const due = typeof feature.wakeAt === "number" && feature.wakeAt <= now;
        return due || hasAttentionMeta(meta);
      }
      return (workspaceIndex.byFeature.get(feature.id) ?? []).some(
        isDirtyWorkspace,
      );
    })
    .sort((left, right) => (right.parkedAt ?? 0) - (left.parkedAt ?? 0));

  const archived =
    filter !== "all"
      ? []
      : sortFeatures(features.filter((feature) => feature.state === "archived")).filter(
          (feature) => query.length === 0 || matches(feature.name),
        );

  return {
    features: sortedNodes,
    parked,
    archived,
  };
}

function nodeLatestActivity(node: FeatureNode): number {
  let latest = 0;
  for (const family of node.rootFamilies) {
    latest = Math.max(latest, familyUpdatedAt(family));
  }
  for (const workspace of node.workspaces) {
    for (const family of workspace.families) {
      latest = Math.max(latest, familyUpdatedAt(family));
    }
  }
  return latest;
}

function sortFeatureNodes(
  nodes: readonly FeatureNode[],
  mode: FeatureSortMode,
  pinnedFeatureIds: readonly string[],
): FeatureNode[] {
  if (nodes.length <= 1) return [...nodes];
  if (mode === "manual" && pinnedFeatureIds.length === 0) return [...nodes];

  const pinRank = new Map(pinnedFeatureIds.map((id, index) => [id, index]));
  const manualRank = new Map(nodes.map((node, index) => [node.feature.id, index]));
  const activityById = new Map(
    nodes.map((node) => [node.feature.id, nodeLatestActivity(node)]),
  );

  const byManual = (left: FeatureNode, right: FeatureNode) =>
    (manualRank.get(left.feature.id) ?? 0) - (manualRank.get(right.feature.id) ?? 0);

  const byMode = (left: FeatureNode, right: FeatureNode): number => {
    switch (mode) {
      case "manual":
        return byManual(left, right);
      case "name":
        return (
          left.feature.name.localeCompare(right.feature.name) ||
          byManual(left, right)
        );
      case "status":
        return (
          statusKindRank(left.rollup.kind) - statusKindRank(right.rollup.kind) ||
          (activityById.get(right.feature.id) ?? 0) -
            (activityById.get(left.feature.id) ?? 0) ||
          byManual(left, right)
        );
      case "activity":
        return (
          (activityById.get(right.feature.id) ?? 0) -
            (activityById.get(left.feature.id) ?? 0) ||
          statusKindRank(left.rollup.kind) - statusKindRank(right.rollup.kind) ||
          byManual(left, right)
        );
    }
  };

  return [...nodes].sort((left, right) => {
    const leftPin = pinRank.get(left.feature.id);
    const rightPin = pinRank.get(right.feature.id);
    if (leftPin !== undefined && rightPin !== undefined) return leftPin - rightPin;
    if (leftPin !== undefined) return -1;
    if (rightPin !== undefined) return 1;
    return byMode(left, right);
  });
}

/**
 * The status of everything the Features section holds, as one rollup.
 *
 * Read before search, filters and the group scope, like the rest of the strip's
 * dots: a hint that changed with the current tab would be reporting the tab.
 */
export function rollupFeatureFamilies(input: {
  readonly families: readonly ThreadFamily[];
  readonly features: readonly Feature[];
  readonly workspaceIndex: WorkspaceIndex;
  readonly now: number;
}): StatusRollup {
  const shown = activeFeatureIds(input.features);
  const threads = input.families
    .filter((family) =>
      inActiveFeature(input.workspaceIndex.workspaceOfThread(family.root), shown),
    )
    .flatMap((family) => [family.root, ...family.children]);
  return rollupThreads(threads, input.now);
}

/** Where one thread sits in the Features section, in the keys its disclosures use. */
export interface FeatureThreadAncestors {
  readonly featureId: string;
  /** Null for a root conversation, which is drawn flat under the feature. */
  readonly workspaceKey: string | null;
  readonly rootId: string;
}

export function featureThreadAncestors(
  nodes: readonly FeatureNode[],
  threadId: string,
): FeatureThreadAncestors | null {
  const holds = (family: ThreadFamily) =>
    family.root.id === threadId || family.children.some((child) => child.id === threadId);
  for (const node of nodes) {
    const root = node.rootFamilies.find(holds);
    if (root !== undefined) {
      return { featureId: node.feature.id, workspaceKey: null, rootId: root.root.id };
    }
    for (const workspace of node.workspaces) {
      const family = workspace.families.find(holds);
      if (family !== undefined) {
        return {
          featureId: node.feature.id,
          workspaceKey: workspace.ref.key,
          rootId: family.root.id,
        };
      }
    }
  }
  return null;
}

function threadsOf(families: readonly ThreadFamily[]): PluginSidebarThread[] {
  return families.flatMap((family) => [family.root, ...family.children]);
}
