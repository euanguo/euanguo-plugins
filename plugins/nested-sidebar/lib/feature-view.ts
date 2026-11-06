/**
 * Bucketing workspaces by the feature label they carry.
 *
 * This is a lens over rows that already exist, not a second tree. The project
 * view draws `group -> project -> workspace -> thread`; this one draws
 * `group -> feature -> workspace -> thread`, from the same threads and the same
 * workspace references. Nothing is copied, so a thread that moves or a worktree
 * that disappears is reflected in both views for free.
 *
 * Grouping stays. A feature is filed under a group the same way a project is,
 * so the top level of both views is the user's own buckets and the tab strip
 * means the same thing in each.
 */

import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import type { ThreadFamily } from "./inbox.ts";
import type { Feature, FeatureAssignment } from "./features.ts";
import { featuresByGroup } from "./features.ts";
import type { GroupIconName } from "./groups.ts";
import { shouldShowUngroupedTab, type GroupScope, type GroupTab } from "./groups.ts";
import type { StatusRollup } from "./rollup.ts";
import { mergeRollups, rollupThreads } from "./rollup.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
  WorkspaceRef,
} from "./workspace.ts";
import {
  workspaceRefOf,
} from "./workspace.ts";
import type { WorkspaceOwnershipMap } from "./workspace-ownership.ts";

/** One workspace row under a feature, with the threads that live in it. */
export interface FeatureWorkspaceNode {
  readonly ref: WorkspaceRef;
  readonly families: ThreadFamily[];
  readonly rollup: StatusRollup;
}

export interface FeatureNode {
  readonly feature: Feature;
  /**
   * The workspaces the label puts here, in the order they were drawn.
   *
   * Empty is a real state and the reason a draft feature is visible at all: a
   * person who named a piece of work should find it on the sidebar before any
   * worktree exists for it.
   */
  readonly workspaces: FeatureWorkspaceNode[];
  readonly rollup: StatusRollup;
}

export interface FeatureGroupNode {
  /** Null for the implicit Ungrouped bucket. */
  readonly groupId: string | null;
  readonly name: string;
  readonly icon: GroupIconName;
  readonly features: FeatureNode[];
  readonly rollup: StatusRollup;
  /**
   * Features filed here that have no workspace yet.
   *
   * Kept separately so a caller can say "2 of 5 not started" without walking
   * the nodes, and so the count cannot drift from the rows above it.
   */
  readonly draftCount: number;
}

export interface FeatureViewInput {
  readonly threads: readonly PluginSidebarThread[];
  readonly features: readonly Feature[];
  readonly assignment: FeatureAssignment;
  readonly groupOrder: readonly { id: string; name: string; icon: GroupIconName }[];
  readonly ungroupedIcon: GroupIconName;
  /** The strip's All tab icon, which belongs to the host's icon set. */
  readonly allIcon: GroupIconName;
  readonly environments: ReadonlyMap<string, WorkspaceEnvironmentDescriptor>;
  readonly projects: ReadonlyMap<string, WorkspaceProjectDescriptor>;
  readonly workspaceOwnership: WorkspaceOwnershipMap;
  readonly now: number;
}

export interface FeatureView {
  readonly nodes: FeatureGroupNode[];
  readonly tabs: GroupTab[];
}

/**
 * Build `group -> feature -> workspace` from the threads the caller already
 * filtered.
 *
 * The caller passes the *visible* threads, so a search or a status filter
 * narrows both views the same way. Building this from all threads would let the
 * feature view show a thread the project view had filtered out, which reads as
 * a bug in the filter.
 */
export function buildFeatureView(input: FeatureViewInput): FeatureView {
  const {
    threads,
    features,
    assignment,
    groupOrder,
    ungroupedIcon,
    allIcon,
    environments,
    projects,
    workspaceOwnership,
    now,
  } = input;

  const refsByLabel = new Map<string, Map<string, WorkspaceRef>>();
  const familiesByLabel = new Map<string, Map<string, ThreadFamily[]>>();
  for (const thread of threads) {
    const environmentId = thread.environment?.id ?? null;
    if (environmentId === null) continue;
    const featureId = assignment[environmentId];
    if (featureId === undefined) continue;
    const ref = workspaceRefOf(
      thread,
      environments,
      projects,
      workspaceOwnership,
    );
    const refs = refsByLabel.get(featureId) ?? new Map<string, WorkspaceRef>();
    refs.set(ref.key, ref);
    refsByLabel.set(featureId, refs);
    const families = familiesByLabel.get(featureId) ?? new Map<string, ThreadFamily[]>();
    const bucket = families.get(ref.key) ?? [];
    bucket.push(familyOf(thread));
    families.set(ref.key, bucket);
    familiesByLabel.set(featureId, families);
  }

  const validGroupIds = new Set(groupOrder.map((group) => group.id));
  const buckets = featuresByGroup(features, validGroupIds);

  const nodes: FeatureGroupNode[] = [];
  const makeGroup = (
    groupId: string | null,
    name: string,
    icon: GroupIconName,
    groupFeatures: readonly Feature[],
  ) => {
    if (groupFeatures.length === 0) return;
    const featureNodes: FeatureNode[] = groupFeatures.map((feature) => {
      const refs = [...(refsByLabel.get(feature.id)?.values() ?? [])];
      const families = familiesByLabel.get(feature.id);
      const workspaces: FeatureWorkspaceNode[] = refs.map((ref) => {
        const inWorkspace = families?.get(ref.key) ?? [];
        return {
          ref,
          families: inWorkspace,
          rollup: mergeRollups(inWorkspace.map((family) => familyRollup(family, now))),
        };
      });
      return {
        feature,
        workspaces,
        rollup: mergeRollups(workspaces.map((workspace) => workspace.rollup)),
      };
    });
    nodes.push({
      groupId,
      name,
      icon,
      features: featureNodes,
      rollup: mergeRollups(featureNodes.map((node) => node.rollup)),
      draftCount: featureNodes.filter(
        (node) => node.feature.state === "draft" || node.workspaces.length === 0,
      ).length,
    });
  };

  for (const group of groupOrder) {
    makeGroup(group.id, group.name, group.icon, buckets.get(group.id) ?? []);
  }
  makeGroup(null, "Ungrouped", ungroupedIcon, buckets.get(null) ?? []);

  return {
    nodes,
    tabs: featureTabs({
      nodes,
      features,
      groupOrder,
      ungroupedIcon,
      allIcon,
    }),
  };
}

/**
 * The scope strip for the feature view.
 *
 * Same semantics as the project strip: All, one tab per group, and Ungrouped
 * once groups exist and something sits outside them. The count is features, not
 * workspaces, because the strip selects what the first level holds.
 */
function featureTabs(input: {
  nodes: readonly FeatureGroupNode[];
  features: readonly Feature[];
  groupOrder: readonly { id: string; name: string; icon: GroupIconName }[];
  ungroupedIcon: GroupIconName;
  allIcon: GroupIconName;
}): GroupTab[] {
  const { nodes, features, groupOrder, ungroupedIcon, allIcon } = input;
  const countIn = (scope: GroupScope): number =>
    scope.kind === "all"
      ? features.length
      : nodes.find((node) =>
          scope.kind === "ungrouped"
            ? node.groupId === null
            : node.groupId === scope.groupId,
        )?.features.length ?? 0;
  const statusIn = (scope: GroupScope): GroupTab["statusKind"] => {
    const node = scope.kind === "all"
      ? undefined
      : nodes.find((candidate) =>
          scope.kind === "ungrouped"
            ? candidate.groupId === null
            : candidate.groupId === scope.groupId,
        );
    const rollup = scope.kind === "all"
      ? mergeRollups(nodes.map((candidate) => candidate.rollup))
      : node?.rollup;
    if (rollup === undefined || rollup.total === 0) return null;
    return rollup.kind === "inactive" || rollup.kind === "stale"
      ? null
      : rollup.kind;
  };
  const tabs: GroupTab[] = [
    {
      scope: { kind: "all" },
      label: "All",
      count: countIn({ kind: "all" }),
      icon: allIcon,
      statusKind: statusIn({ kind: "all" }),
    },
  ];
  for (const group of groupOrder) {
    const scope: GroupScope = { kind: "group", groupId: group.id };
    tabs.push({
      scope,
      label: group.name,
      count: countIn(scope),
      icon: group.icon,
      statusKind: statusIn(scope),
    });
  }
  const ungroupedCount = countIn({ kind: "ungrouped" });
  if (shouldShowUngroupedTab(groupOrder.length, ungroupedCount, features.length)) {
    tabs.push({
      scope: { kind: "ungrouped" },
      label: "Ungrouped",
      count: ungroupedCount,
      icon: ungroupedIcon,
      statusKind: statusIn({ kind: "ungrouped" }),
    });
  }
  return tabs;
}

/**
 * The family a single thread forms on its own.
 *
 * The feature view groups by workspace, not by thread family, so a root and its
 * children are drawn where they run. This keeps one thread as one node here and
 * leaves the family shape to the rows below.
 */
function familyOf(thread: PluginSidebarThread): ThreadFamily {
  return { root: thread, children: [] };
}

function familyRollup(family: ThreadFamily, now: number): StatusRollup {
  return rollupThreads([family.root, ...family.children], now);
}
