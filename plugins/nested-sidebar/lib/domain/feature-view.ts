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
import type { GroupScope } from "./groups.ts";
import type { ThreadFamily } from "./inbox.ts";
import { rollupThreads, type StatusRollup } from "./rollup.ts";
import type { WorkspaceNode } from "./tree.ts";
import type { Workspace, WorkspaceIndex } from "./workspace-index.ts";

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
  /** The families the project rows draw, after filter and search, from every project. */
  readonly families: readonly ThreadFamily[];
  readonly features: readonly Feature[];
  /** Features unchecked in the selector; they are not drawn. */
  readonly hiddenFeatureIds?: readonly string[];
  /** Workspaces drawn in another section, which this one leaves out. */
  readonly drawnElsewhere?: ReadonlySet<string>;
  readonly members: readonly FeatureMember[];
  readonly workspaceIndex: WorkspaceIndex;
  readonly meta?: Readonly<Record<string, FeatureMetaSummary>>;
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
  readonly scope: GroupScope;
  readonly now: number;
}

export interface FeatureView {
  readonly features: FeatureNode[];
  /** Finished features, in their own order, for the shelf at the bottom. */
  readonly archived: readonly Feature[];
}

/** Features a workspace can be drawn under: active ones only. A finished feature hands its rows back. */
export function activeFeatureIds(features: readonly Feature[]): ReadonlySet<string> {
  return new Set(
    features.filter((feature) => feature.state === "active").map((feature) => feature.id),
  );
}

/** Whether the Features section draws this workspace instead of its project. */
export function inActiveFeature(
  workspace: Pick<Workspace, "featureId"> | null,
  active: ReadonlySet<string>,
): boolean {
  return workspace !== null && workspace.featureId !== null && active.has(workspace.featureId);
}

/** A feature's member workspaces: everything the index files under it but its own folder. */
export function featureMemberWorkspaces(
  feature: Feature,
  workspaceIndex: WorkspaceIndex,
): readonly Workspace[] {
  return (workspaceIndex.byFeature.get(feature.id) ?? []).filter(
    (workspace) => !isFeatureRoot(feature, workspace.path),
  );
}

/**
 * Whether the strip's scope shows features at all.
 *
 * Only All and the Features tab do. A group tab answers "which projects", and
 * a feature is not a project: deriving "the features that touch a project in
 * this group" made selecting IM list five features above the IM projects,
 * which reads as features filed under a group. They are not — a feature is its
 * own axis, reached from All or from its own tab.
 */
export function featureInScope(scope: GroupScope): boolean {
  return scope.kind === "all" || scope.kind === "features";
}

export function buildFeatureView(input: FeatureViewInput): FeatureView {
  const { families, features, members, showEmpty, projectNames, workspaceIndex, now } = input;
  const hidden = new Set(input.hiddenFeatureIds ?? []);
  const drawnElsewhere = input.drawnElsewhere ?? new Set<string>();
  const active = activeFeatureIds(features);
  const query = input.searchQuery.trim().toLowerCase();
  const matches = (value: string) => query.length > 0 && value.toLowerCase().includes(query);

  const familiesByKey = new Map<string, ThreadFamily[]>();
  for (const family of families) {
    const workspace = workspaceIndex.workspaceOfThread(family.root);
    if (workspace === null || !inActiveFeature(workspace, active)) continue;
    const bucket = familiesByKey.get(workspace.key) ?? [];
    bucket.push(family);
    familiesByKey.set(workspace.key, bucket);
  }

  const workspaceNode = (workspace: Workspace): FeatureWorkspaceNode => {
    const inWorkspace = familiesByKey.get(workspace.key) ?? [];
    return {
      ref: workspace,
      families: inWorkspace,
      rollup: rollupThreads(threadsOf(inWorkspace), now),
      projectId: workspace.projectId,
      projectName: projectNames.get(workspace.projectId) ?? workspace.projectId,
    };
  };

  const nodeOf = (feature: Feature): FeatureNode | null => {
    const inFeature = (workspaceIndex.byFeature.get(feature.id) ?? []).filter(
      (workspace) => !drawnElsewhere.has(workspace.key),
    );
    const rootWorkspace =
      inFeature.find((workspace) => isFeatureRoot(feature, workspace.path)) ?? null;
    const rootNode = rootWorkspace === null ? null : workspaceNode(rootWorkspace);
    const root =
      rootNode !== null && (showEmpty || rootNode.families.length > 0 || matches(feature.name))
        ? rootNode
        : null;
    const memberRows = inFeature
      .filter((workspace) => workspace !== rootWorkspace)
      .map(workspaceNode)
      .filter(
        (node) => showEmpty || node.families.length > 0 || matches(node.ref.label),
      );
    const all = [...(root?.families ?? []), ...memberRows.flatMap((node) => node.families)];
    const visible =
      all.length > 0 ||
      showEmpty ||
      matches(feature.name) ||
      memberRows.length > 0;
    if (!visible) return null;
    return {
      feature,
      meta: input.meta?.[feature.id] ?? EMPTY_META_SUMMARY,
      root,
      rootFamilies: root?.families ?? [],
      workspaces: memberRows,
      members: members.filter((member) => member.featureId === feature.id),
      rollup: rollupThreads(threadsOf(all), now),
      threadCount: threadsOf(all).length,
    };
  };

  const shown = sortFeatures(
    features.filter((feature) => active.has(feature.id) && !hidden.has(feature.id)),
  ).filter(() => featureInScope(input.scope));

  return {
    features: shown.flatMap((feature) => nodeOf(feature) ?? []),
    archived: sortFeatures(features.filter((feature) => feature.state === "archived")).filter(
      (feature) => query.length === 0 || feature.name.toLowerCase().includes(query),
    ),
  };
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
  readonly hiddenFeatureIds?: readonly string[];
  readonly workspaceIndex: WorkspaceIndex;
  readonly now: number;
}): StatusRollup {
  const hidden = new Set(input.hiddenFeatureIds ?? []);
  const shown = new Set(
    [...activeFeatureIds(input.features)].filter((id) => !hidden.has(id)),
  );
  const threads = input.families
    .filter((family) => inActiveFeature(input.workspaceIndex.workspaceOfThread(family.root), shown))
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
