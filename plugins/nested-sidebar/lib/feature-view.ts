/**
 * The feature view: `group -> feature -> conversations`, from rows that already
 * exist.
 *
 * This is a lens, not a second tree. It is fed the very families the project
 * view draws — already filtered by the status preset, searched, and with pinned
 * families taken out — and only re-buckets them by the feature their workspace
 * path falls in. So a filter or a search narrows both views the same way, and a
 * thread that moves is in the right place in both for free.
 *
 * Inside a feature the subject is the conversation. Root conversations — the
 * ones running in the feature folder itself — come first, flat, because they are
 * where the work is planned. A member repository appears as its own worktree row
 * only when a conversation runs in it; the rest are one line of names under the
 * feature, because four empty folder rows push the actual work off screen.
 */

import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import {
  effectiveFeatureGroup,
  featureOfWorkspace,
  featuresByGroup,
  isFeatureRoot,
  type Feature,
  type FeatureAssignment,
  type FeatureMember,
} from "./features.ts";
import { shouldShowUngroupedTab, type GroupIconName, type GroupScope, type GroupTab } from "./groups.ts";
import type { ThreadFamily } from "./inbox.ts";
import { mergeRollups, rollupThreads, type StatusRollup } from "./rollup.ts";
import type { WorkspaceNode } from "./tree.ts";
import {
  workspaceRefOf,
  type WorkspaceEnvironmentDescriptor,
  type WorkspaceProjectDescriptor,
} from "./workspace.ts";
import type { WorkspaceOwnershipMap } from "./workspace-ownership.ts";

/** A member worktree with conversations in it, drawn with the project view's own row. */
export interface FeatureWorkspaceNode extends WorkspaceNode {
  /** The project the worktree's threads belong to, which the row's menus act on. */
  readonly projectId: string;
  readonly projectName: string;
}

export interface FeatureNode {
  readonly feature: Feature;
  /** Conversations whose cwd is the feature folder itself. */
  readonly rootFamilies: ThreadFamily[];
  /** Member worktrees that hold a conversation, in the order their threads came. */
  readonly workspaces: FeatureWorkspaceNode[];
  /** Every worktree in the folder, conversation or not. */
  readonly members: readonly FeatureMember[];
  readonly rollup: StatusRollup;
  readonly threadCount: number;
}

export interface FeatureGroupNode {
  /** Null for the implicit Ungrouped bucket. */
  readonly groupId: string | null;
  readonly name: string;
  readonly icon: GroupIconName;
  readonly features: FeatureNode[];
  readonly rollup: StatusRollup;
}

export interface FeatureViewInput {
  /** The project view's families after filter, search and pinning, in its order. */
  readonly families: readonly ThreadFamily[];
  readonly features: readonly Feature[];
  readonly adoptions: FeatureAssignment;
  readonly members: readonly FeatureMember[];
  readonly groupOrder: readonly { id: string; name: string; icon: GroupIconName }[];
  readonly ungroupedIcon: GroupIconName;
  readonly allIcon: GroupIconName;
  readonly scope: GroupScope;
  /**
   * Whether a feature with nothing matching is still drawn.
   *
   * True with no filter and no search: an empty feature is a real destination
   * the user just made. False otherwise, because a filter that answers with
   * every feature it did not match is not a filter.
   */
  readonly showEmpty: boolean;
  readonly searchQuery: string;
  readonly environments: ReadonlyMap<string, WorkspaceEnvironmentDescriptor>;
  readonly projects: ReadonlyMap<string, WorkspaceProjectDescriptor>;
  readonly projectNames: ReadonlyMap<string, string>;
  readonly workspaceOwnership: WorkspaceOwnershipMap;
  readonly now: number;
}

export interface FeatureView {
  readonly nodes: FeatureGroupNode[];
  readonly tabs: GroupTab[];
  /** Finished features, newest position first, for the shelf at the bottom. */
  readonly archived: readonly Feature[];
}

export function buildFeatureView(input: FeatureViewInput): FeatureView {
  const {
    families,
    features,
    adoptions,
    members,
    groupOrder,
    ungroupedIcon,
    allIcon,
    scope,
    showEmpty,
    environments,
    projects,
    projectNames,
    workspaceOwnership,
    now,
  } = input;
  const active = features.filter((feature) => feature.state === "active");
  const query = input.searchQuery.trim().toLowerCase();

  const roots = new Map<string, ThreadFamily[]>();
  const workspaces = new Map<string, Map<string, Omit<FeatureWorkspaceNode, "rollup">>>();
  for (const family of families) {
    const ref = workspaceRefOf(family.root, environments, projects, workspaceOwnership);
    const feature = featureOfWorkspace({
      features: active,
      adoptions,
      environmentId: ref.environmentId,
      path: ref.path,
    });
    if (feature === null) continue;
    if (isFeatureRoot(feature, ref.path)) {
      const bucket = roots.get(feature.id) ?? [];
      bucket.push(family);
      roots.set(feature.id, bucket);
      continue;
    }
    const byKey =
      workspaces.get(feature.id) ?? new Map<string, Omit<FeatureWorkspaceNode, "rollup">>();
    const existing = byKey.get(ref.key);
    const projectId =
      (ref.environmentId === null
        ? null
        : workspaceOwnership[ref.environmentId]?.ownerProjectId) ?? family.root.projectId;
    byKey.set(ref.key, {
      ref,
      projectId,
      projectName: projectNames.get(projectId) ?? projectId,
      families: [...(existing?.families ?? []), family],
    });
    workspaces.set(feature.id, byKey);
  }

  const nodeOf = (feature: Feature): FeatureNode => {
    const rootFamilies = roots.get(feature.id) ?? [];
    const memberRows = [...(workspaces.get(feature.id)?.values() ?? [])].map(
      (workspace): FeatureWorkspaceNode => ({
        ...workspace,
        rollup: rollupThreads(threadsOf(workspace.families), now),
      }),
    );
    const all = [...rootFamilies, ...memberRows.flatMap((workspace) => workspace.families)];
    return {
      feature,
      rootFamilies,
      workspaces: memberRows,
      members: members.filter((member) => member.featureId === feature.id),
      rollup: rollupThreads(threadsOf(all), now),
      threadCount: threadsOf(all).length,
    };
  };

  const validGroupIds = new Set(groupOrder.map((group) => group.id));
  const visible = (node: FeatureNode) =>
    node.threadCount > 0 ||
    showEmpty ||
    (query.length > 0 && node.feature.name.toLowerCase().includes(query));
  const groupNodes: FeatureGroupNode[] = [];
  const buckets = featuresByGroup(active, validGroupIds);
  const pushGroup = (groupId: string | null, name: string, icon: GroupIconName) => {
    const nodes = (buckets.get(groupId) ?? []).map(nodeOf).filter(visible);
    if (nodes.length === 0) return;
    groupNodes.push({
      groupId,
      name,
      icon,
      features: nodes,
      rollup: mergeRollups(nodes.map((node) => node.rollup)),
    });
  };
  for (const group of groupOrder) pushGroup(group.id, group.name, group.icon);
  pushGroup(null, "Ungrouped", ungroupedIcon);

  const inScope = (groupId: string | null, candidate: GroupScope) =>
    candidate.kind === "all" ||
    (candidate.kind === "ungrouped" ? groupId === null : groupId === candidate.groupId);

  return {
    nodes: groupNodes.filter((node) => inScope(node.groupId, scope)),
    tabs: featureTabs({
      nodes: groupNodes,
      features: active,
      validGroupIds,
      groupOrder,
      ungroupedIcon,
      allIcon,
    }),
    archived: features.filter(
      (feature) =>
        feature.state === "archived" &&
        inScope(effectiveFeatureGroup(feature, validGroupIds), scope) &&
        (query.length === 0 || feature.name.toLowerCase().includes(query)),
    ),
  };
}

/**
 * The scope strip for the feature view.
 *
 * Same semantics as the project strip — All, one tab per group, Ungrouped once
 * groups exist and something sits outside them — with features as what is
 * counted, because the strip selects what the first level holds.
 */
function featureTabs(input: {
  nodes: readonly FeatureGroupNode[];
  features: readonly Feature[];
  validGroupIds: ReadonlySet<string>;
  groupOrder: readonly { id: string; name: string; icon: GroupIconName }[];
  ungroupedIcon: GroupIconName;
  allIcon: GroupIconName;
}): GroupTab[] {
  const { nodes, features, validGroupIds, groupOrder, ungroupedIcon, allIcon } = input;
  const countIn = (groupId: string | null) =>
    features.filter((feature) => effectiveFeatureGroup(feature, validGroupIds) === groupId)
      .length;
  const statusOf = (rollup: StatusRollup | undefined): GroupTab["statusKind"] => {
    if (rollup === undefined || rollup.total === 0) return null;
    return rollup.kind === "inactive" || rollup.kind === "stale" ? null : rollup.kind;
  };
  const rollupIn = (groupId: string | null) =>
    nodes.find((node) => node.groupId === groupId)?.rollup;
  const tabs: GroupTab[] = [
    {
      scope: { kind: "all" },
      label: "All",
      count: features.length,
      icon: allIcon,
      statusKind: statusOf(mergeRollups(nodes.map((node) => node.rollup))),
    },
    ...groupOrder.map((group) => ({
      scope: { kind: "group" as const, groupId: group.id },
      label: group.name,
      count: countIn(group.id),
      icon: group.icon,
      statusKind: statusOf(rollupIn(group.id)),
    })),
  ];
  const ungrouped = countIn(null);
  if (shouldShowUngroupedTab(groupOrder.length, ungrouped, features.length)) {
    tabs.push({
      scope: { kind: "ungrouped" },
      label: "Ungrouped",
      count: ungrouped,
      icon: ungroupedIcon,
      statusKind: statusOf(rollupIn(null)),
    });
  }
  return tabs;
}

/** Where one thread sits in the feature view, in the keys its disclosures use. */
export interface FeatureThreadAncestors {
  readonly groupId: string | null;
  readonly featureId: string;
  /** Null for a root conversation, which is drawn flat under the feature. */
  readonly workspaceKey: string | null;
  readonly rootId: string;
}

export function featureThreadAncestors(
  nodes: readonly FeatureGroupNode[],
  threadId: string,
): FeatureThreadAncestors | null {
  const holds = (family: ThreadFamily) =>
    family.root.id === threadId || family.children.some((child) => child.id === threadId);
  for (const group of nodes) {
    for (const node of group.features) {
      const root = node.rootFamilies.find(holds);
      if (root !== undefined) {
        return { groupId: group.groupId, featureId: node.feature.id, workspaceKey: null, rootId: root.root.id };
      }
      for (const workspace of node.workspaces) {
        const family = workspace.families.find(holds);
        if (family !== undefined) {
          return {
            groupId: group.groupId,
            featureId: node.feature.id,
            workspaceKey: workspace.ref.key,
            rootId: family.root.id,
          };
        }
      }
    }
  }
  return null;
}

function threadsOf(families: readonly ThreadFamily[]): PluginSidebarThread[] {
  return families.flatMap((family) => [family.root, ...family.children]);
}
