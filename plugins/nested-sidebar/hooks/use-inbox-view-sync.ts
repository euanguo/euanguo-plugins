import { useEffect, useRef } from "react";

import {
  projectInScope,
  type GroupTab,
  type GroupScope,
  type ProjectGroup,
} from "@/lib/groups";
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
    const ancestors = threadAncestors(treeNodes, activeThreadId);
    if (ancestors === null) {
      revealedThreadRef.current = null;
      return;
    }
    const groupKey = ancestors.groupId ?? UNGROUPED_SCOPE_KEY;
    patchViewStateWith((current) => {
      const validGroupIds = new Set(groups.map((group) => group.id));
      const scoped = projectInScope(
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
      const expandedWorkspaces = current.expandedWorkspaces.includes(
        ancestors.workspaceKey,
      )
        ? current.expandedWorkspaces
        : [...current.expandedWorkspaces, ancestors.workspaceKey];
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
    groupAssignment,
    groups,
    patchViewStateWith,
    treeNodes,
  ]);
}
