import { useEffect, useRef } from "react";

import {
  projectInScope,
  type GroupTab,
  type GroupScope,
  type ProjectGroup,
} from "@/lib/groups";
import { featureThreadAncestors, type FeatureNode } from "@/lib/feature-view";
import { threadAncestors, type GroupNode } from "@/lib/tree";
import {
  ALL_SCOPE_KEY,
  UNGROUPED_SCOPE_KEY,
  resolveGroupScope,
  writeViewState,
  type NestViewState,
} from "@/lib/view-state";

export function useInboxViewSync(input: {
  readonly activeThreadId: string | null;
  readonly treeNodes: readonly GroupNode[];
  /** Present in the feature view, where the thread is looked for under its feature. */
  readonly featureNodes: readonly FeatureNode[] | null;
  readonly groupTabs: readonly GroupTab[];
  readonly groupScope: GroupScope;
  readonly groups: readonly ProjectGroup[];
  readonly groupAssignment: Readonly<Record<string, string>>;
  readonly patchViewStateWith: (
    update: (current: NestViewState) => NestViewState,
  ) => void;
}): void {
  const {
    activeThreadId,
    treeNodes,
    featureNodes,
    groupTabs,
    groupScope,
    groups,
    groupAssignment,
    patchViewStateWith,
  } = input;
  const revealedThreadRef = useRef<string | null>(null);
  const ungroupedTabVisible = groupTabs.some(
    (tab) => tab.scope.kind === "ungrouped",
  );

  useEffect(() => {
    if (groupScope.kind !== "ungrouped") return;
    if (ungroupedTabVisible) return;
    patchViewStateWith((current) =>
      current.scope === UNGROUPED_SCOPE_KEY
        ? { ...current, scope: ALL_SCOPE_KEY }
        : current,
    );
  }, [groupScope.kind, patchViewStateWith, ungroupedTabVisible]);

  useEffect(() => {
    if (activeThreadId === null) return;
    if (revealedThreadRef.current === activeThreadId) return;
    revealedThreadRef.current = activeThreadId;
    const ancestors = revealTarget(treeNodes, featureNodes, activeThreadId);
    if (ancestors === null) {
      revealedThreadRef.current = null;
      return;
    }
    const groupKey = ancestors.groupId ?? UNGROUPED_SCOPE_KEY;
    patchViewStateWith((current) => {
      const validGroupIds = new Set(groups.map((group) => group.id));
      /**
       * The feature view is a flat list with no strip, so there is no scope to
       * make line up with a feature. The project view still has to open the
       * group its project is filed under.
       */
      const scoped = ancestors.scopedByGroup
        ? true
        : projectInScope(
            resolveGroupScope(current.scope, validGroupIds),
            groupAssignment,
            validGroupIds,
            ancestors.projectId,
          );
      const collapsedGroups = current.collapsedGroups.filter(
        (id) => id !== groupKey,
      );
      const collapsedProjects = current.collapsedProjects.filter(
        (id) => id !== ancestors.projectId,
      );
      const workspaceKey = ancestors.workspaceKey;
      const expandedWorkspaces =
        workspaceKey === null || current.expandedWorkspaces.includes(workspaceKey)
          ? current.expandedWorkspaces
          : [...current.expandedWorkspaces, workspaceKey];
      const collapsedFamilies = current.collapsedFamilies.filter(
        (id) => id !== ancestors.rootId,
      );
      const scope = scoped ? current.scope : groupKey;
      if (
        scope === current.scope &&
        collapsedGroups.length === current.collapsedGroups.length &&
        collapsedProjects.length === current.collapsedProjects.length &&
        expandedWorkspaces.length === current.expandedWorkspaces.length &&
        collapsedFamilies.length === current.collapsedFamilies.length
      ) {
        return current;
      }
      const next = {
        ...current,
        scope,
        collapsedGroups,
        collapsedProjects,
        expandedWorkspaces,
        collapsedFamilies,
      };
      writeViewState(next);
      return next;
    });
  }, [
    activeThreadId,
    featureNodes,
    groupAssignment,
    groups,
    patchViewStateWith,
    treeNodes,
  ]);
}

/**
 * The branch to open for a thread, in whichever view is drawn.
 *
 * In the feature view the "project" level is the feature, so its id is the one
 * the collapse set is keyed by; a root conversation has no worktree row to open.
 */
function revealTarget(
  treeNodes: readonly GroupNode[],
  featureNodes: readonly FeatureNode[] | null,
  threadId: string,
): {
  readonly groupId: string | null;
  readonly projectId: string;
  readonly workspaceKey: string | null;
  readonly rootId: string;
  readonly scopedByGroup: boolean;
} | null {
  if (featureNodes !== null) {
    const found = featureThreadAncestors(featureNodes, threadId);
    return found === null
      ? null
      : {
          groupId: null,
          projectId: found.featureId,
          workspaceKey: found.workspaceKey,
          rootId: found.rootId,
          scopedByGroup: true,
        };
  }
  const found = threadAncestors(treeNodes, threadId);
  return found === null ? null : { ...found, scopedByGroup: false };
}
