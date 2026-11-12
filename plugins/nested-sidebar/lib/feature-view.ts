/**
 * The feature view: the work itself, one feature after another.
 *
 * Features are a flat list. A group is a place to look for a *project*, and the
 * bottom switch already says which axis the list is drawn on; grouping the
 * features as well would be a second set of buckets answering a question
 * nobody asks of a list this short.
 *
 * This is a lens, not a second tree. It is fed the very families the project
 * view draws — already filtered by the status preset and searched — and only
 * re-buckets them by the feature their workspace path falls in. So a filter or
 * a search narrows both views the same way, and a thread that moves is in the
 * right place in both for free.
 *
 * Inside a feature the subject is the conversation. Root conversations — the
 * ones running in the feature folder itself — come first, flat, because they are
 * where the work is planned. A member repository appears as its own worktree row
 * only when a conversation runs in it; the rest are one line of names under the
 * feature, because four empty folder rows push the actual work off screen.
 */

import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import {
  EMPTY_META_SUMMARY,
  type FeatureMetaSummary,
} from "./feature-meta.ts";
import {
  featureOfWorkspace,
  isFeatureRoot,
  sortFeatures,
  type Feature,
  type FeatureAssignment,
  type FeatureMember,
} from "./features.ts";
import type { ThreadFamily } from "./inbox.ts";
import { rollupThreads, type StatusRollup } from "./rollup.ts";
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
  /** What the feature has recorded besides its folder, as counts. */
  readonly meta: FeatureMetaSummary;
  /** Conversations whose cwd is the feature folder itself. */
  readonly rootFamilies: ThreadFamily[];
  /** Member worktrees that hold a conversation, in the order their threads came. */
  readonly workspaces: FeatureWorkspaceNode[];
  /** Every worktree in the folder, conversation or not. */
  readonly members: readonly FeatureMember[];
  readonly rollup: StatusRollup;
  readonly threadCount: number;
}

export interface FeatureViewInput {
  /** The project view's families after filter and search. */
  readonly families: readonly ThreadFamily[];
  readonly features: readonly Feature[];
  /** Features the user unchecked in the selector; they are not drawn. */
  readonly hiddenFeatureIds?: readonly string[];
  readonly adoptions: FeatureAssignment;
  readonly members: readonly FeatureMember[];
  /** featureId -> what the feature has recorded, when the caller read it. */
  readonly meta?: Readonly<Record<string, FeatureMetaSummary>>;
  /**
   * Whether a feature with no matching conversation is still drawn.
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
  readonly features: FeatureNode[];
  /** Finished features, newest position first, for the shelf at the bottom. */
  readonly archived: readonly Feature[];
}

export function buildFeatureView(input: FeatureViewInput): FeatureView {
  const {
    families,
    features,
    adoptions,
    members,
    showEmpty,
    environments,
    projects,
    projectNames,
    workspaceOwnership,
    now,
  } = input;
  const hidden = new Set(input.hiddenFeatureIds ?? []);
  const active = features.filter(
    (feature) => feature.state === "active" && !hidden.has(feature.id),
  );
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
      meta: input.meta?.[feature.id] ?? EMPTY_META_SUMMARY,
      rootFamilies,
      workspaces: memberRows,
      members: members.filter((member) => member.featureId === feature.id),
      rollup: rollupThreads(threadsOf(all), now),
      threadCount: threadsOf(all).length,
    };
  };

  const visible = (node: FeatureNode) =>
    node.threadCount > 0 ||
    showEmpty ||
    (query.length > 0 && node.feature.name.toLowerCase().includes(query));

  return {
    features: sortFeatures(active).map(nodeOf).filter(visible),
    archived: sortFeatures(features.filter((feature) => feature.state === "archived")).filter(
      (feature) => query.length === 0 || feature.name.toLowerCase().includes(query),
    ),
  };
}

/**
 * The status of everything the feature view holds, as one rollup.
 *
 * Used by the switch at the bottom: the dots say what the whole view is doing,
 * so this reads the list before search, filters and the group scope — a
 * navigation hint that changed with the current tab would be reporting the tab,
 * not the queue.
 */
export function rollupFeatureFamilies(input: {
  readonly families: readonly ThreadFamily[];
  readonly features: readonly Feature[];
  readonly hiddenFeatureIds?: readonly string[];
  readonly adoptions: FeatureAssignment;
  readonly environments: ReadonlyMap<string, WorkspaceEnvironmentDescriptor>;
  readonly projects: ReadonlyMap<string, WorkspaceProjectDescriptor>;
  readonly workspaceOwnership: WorkspaceOwnershipMap;
  readonly now: number;
}): StatusRollup {
  const hidden = new Set(input.hiddenFeatureIds ?? []);
  const active = input.features.filter(
    (feature) => feature.state === "active" && !hidden.has(feature.id),
  );
  const threads: PluginSidebarThread[] = [];
  for (const family of input.families) {
    const ref = workspaceRefOf(
      family.root,
      input.environments,
      input.projects,
      input.workspaceOwnership,
    );
    const feature = featureOfWorkspace({
      features: active,
      adoptions: input.adoptions,
      environmentId: ref.environmentId,
      path: ref.path,
    });
    if (feature === null) continue;
    threads.push(family.root, ...family.children);
  }
  return rollupThreads(threads, input.now);
}

/** Where one thread sits in the feature view, in the keys its disclosures use. */
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
