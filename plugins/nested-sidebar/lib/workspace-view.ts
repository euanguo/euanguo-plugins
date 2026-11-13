/**
 * The physical tree: projects, the workspaces on disk, and the conversations
 * in them.
 *
 * The thread view answers "which project owns this conversation". This one
 * answers "what is on disk under this project", so a feature root draws its
 * member worktrees underneath it even when those worktrees belong to other bb
 * projects. A workspace appears once, under the deepest feature root that
 * contains it, which is what keeps a cross-repository feature in one place.
 */

import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import type { GroupIconName } from "./groups.ts";
import type { ThreadFamily } from "./inbox.ts";
import { mergeRollups, rollupThreads, type StatusRollup } from "./rollup.ts";
import type { GroupNode, ProjectNode, WorkspaceNode } from "./tree.ts";
import type { Workspace, WorkspaceIndex } from "./workspace-index.ts";
import { NO_WORKSPACE_KEY } from "./workspace-index.ts";
import { NO_WORKSPACE_REF } from "./workspace.ts";

export interface WorkspaceTreeNode {
  /** Null for the bucket threads without a workspace land in. */
  readonly workspace: Workspace | null;
  readonly families: readonly ThreadFamily[];
  readonly children: readonly WorkspaceTreeNode[];
  readonly rollup: StatusRollup;
}

export interface WorkspaceProjectGroup {
  readonly project: PluginSidebarProject;
  readonly workspaces: readonly WorkspaceTreeNode[];
  readonly rollup: StatusRollup;
}

export interface WorkspaceView {
  readonly projects: readonly WorkspaceProjectGroup[];
  readonly rollup: StatusRollup;
}

function threadsOf(families: readonly ThreadFamily[]): PluginSidebarThread[] {
  return families.flatMap((family) => [family.root, ...family.children]);
}

export function buildWorkspaceView(input: {
  readonly projectGroups: readonly {
    readonly project: PluginSidebarProject;
    readonly families: readonly ThreadFamily[];
  }[];
  readonly projects: readonly PluginSidebarProject[];
  readonly workspaceIndex: WorkspaceIndex;
  readonly now: number;
}): WorkspaceView {
  const familiesByKey = new Map<string, ThreadFamily[]>();
  for (const group of input.projectGroups) {
    for (const family of group.families) {
      const workspace = input.workspaceIndex.workspaceOfThread(family.root);
      const key = workspace?.key ?? `${NO_WORKSPACE_KEY}:${group.project.id}`;
      const list = familiesByKey.get(key) ?? [];
      list.push(family);
      familiesByKey.set(key, list);
    }
  }

  const nodeOf = (workspace: Workspace): WorkspaceTreeNode => {
    const families = familiesByKey.get(workspace.key) ?? [];
    const children = input.workspaceIndex.childrenOf(workspace.key).map(nodeOf);
    const all = [
      ...threadsOf(families),
      ...children.flatMap((child) =>
        child.families.flatMap((family) => [family.root, ...family.children]),
      ),
    ];
    return {
      workspace,
      families,
      children,
      rollup: rollupThreads(all, input.now),
    };
  };

  const projects = input.projects.map((project) => {
    const roots = (input.workspaceIndex.byProject.get(project.id) ?? [])
      .filter((workspace) => workspace.parentKey === null)
      .map(nodeOf);
    const noWorkspaceKey = `${NO_WORKSPACE_KEY}:${project.id}`;
    const noWorkspaceFamilies = familiesByKey.get(noWorkspaceKey) ?? [];
    if (noWorkspaceFamilies.length > 0) {
      roots.push({
        workspace: null,
        families: noWorkspaceFamilies,
        children: [],
        rollup: rollupThreads(threadsOf(noWorkspaceFamilies), input.now),
      });
    }
    return {
      project,
      workspaces: roots,
      rollup: rollupThreads(
        roots.flatMap((root) => [
          ...threadsOf(root.families),
          ...root.children.flatMap((child) =>
            child.families.flatMap((family) => [
              family.root,
              ...family.children,
            ]),
          ),
        ]),
        input.now,
      ),
    };
  });

  return {
    projects,
    rollup: rollupThreads(
      projects.flatMap((project) =>
        project.workspaces.flatMap((workspace) =>
          threadsOf(workspace.families),
        ),
      ),
      input.now,
    ),
  };
}

function allFamiliesOf(node: WorkspaceTreeNode): ThreadFamily[] {
  return [...node.families, ...node.children.flatMap(allFamiliesOf)];
}

function workspaceNodeOf(node: WorkspaceTreeNode): WorkspaceNode {
  return {
    ref: node.workspace!,
    families: [...node.families],
    rollup: node.rollup,
    ...(node.children.length === 0
      ? {}
      : { children: node.children.map(workspaceNodeOf) }),
  };
}

/**
 * The physical tree in the shape the project rows already draw.
 *
 * Same group, project, and workspace rows, just a different set of workspaces:
 * a feature root keeps its members underneath it, and a project row draws only
 * the workspaces no feature contains.
 */
export function buildWorkspaceTree(input: {
  readonly view: WorkspaceView;
  readonly assignment: Readonly<Record<string, string>>;
  readonly groupOrder: readonly {
    readonly id: string;
    readonly name: string;
    readonly icon: GroupIconName;
  }[];
  readonly ungroupedIcon: GroupIconName;
}): GroupNode[] {
  const projectsByGroup = new Map<string, ProjectNode[]>();
  for (const group of input.view.projects) {
    const node: ProjectNode = {
      project: group.project,
      families: group.workspaces.flatMap(allFamiliesOf),
      workspaces: group.workspaces.map((workspace) =>
        workspace.workspace === null
          ? {
              ref: NO_WORKSPACE_REF,
              families: [...workspace.families],
              rollup: workspace.rollup,
            }
          : workspaceNodeOf(workspace),
      ),
      showWorkspaces: true,
      rollup: group.rollup,
      repoKey: null,
      mergedProjectIds: [group.project.id],
      foreignClaimProjectIds: [],
    };
    const groupId = input.assignment[group.project.id] ?? "__ungrouped__";
    const bucket = projectsByGroup.get(groupId) ?? [];
    bucket.push(node);
    projectsByGroup.set(groupId, bucket);
  }

  const nodes: GroupNode[] = [];
  for (const group of input.groupOrder) {
    const bucket = projectsByGroup.get(group.id);
    if (bucket === undefined || bucket.length === 0) continue;
    nodes.push({
      groupId: group.id,
      name: group.name,
      icon: group.icon,
      projects: bucket,
      rollup: mergeRollups(bucket.map((project) => project.rollup)),
    });
  }
  const ungrouped = projectsByGroup.get("__ungrouped__");
  if (ungrouped !== undefined && ungrouped.length > 0) {
    nodes.push({
      groupId: null,
      name: "Ungrouped",
      icon: input.ungroupedIcon,
      projects: ungrouped,
      rollup: mergeRollups(ungrouped.map((project) => project.rollup)),
    });
  }
  return nodes;
}
