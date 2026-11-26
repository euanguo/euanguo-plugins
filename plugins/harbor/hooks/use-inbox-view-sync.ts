import { useEffect, useRef } from "react";

import {
  projectInScope,
  type GroupTab,
  type GroupScope,
  type ProjectGroup,
} from "@/lib/domain/groups";
import { featureThreadAncestors, type FeatureNode } from "@/lib/domain/feature-view";
import type { SidebarMode } from "@/lib/domain/organization";
import { threadAncestors, type GroupNode } from "@/lib/domain/tree";
import {
  ALL_SCOPE_KEY,
  UNGROUPED_SCOPE_KEY,
  resolveGroupScope,
  withId,
  type HarborViewState,
  type SidebarSurface,
} from "@/lib/ui/view-state";

export function useInboxViewSync(input: {
  readonly surface: SidebarSurface;
  readonly sidebarMode: SidebarMode;
  readonly activeThreadId: string | null;
  readonly treeNodes: readonly GroupNode[];
  /** Where a thread in a feature is looked for, since the projects leave it out. */
  readonly featureNodes: readonly FeatureNode[];
  readonly groupTabs: readonly GroupTab[];
  readonly groupScope: GroupScope;
  readonly groups: readonly ProjectGroup[];
  readonly groupAssignment: Readonly<Record<string, string>>;
  readonly patchViewStateWith: (
    update: (current: HarborViewState) => HarborViewState,
  ) => void;
}): void {
  const {
    surface,
    sidebarMode,
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
    if (surface !== "projects") return;
    if (groupScope.kind !== "ungrouped") return;
    if (ungroupedTabVisible) return;
    patchViewStateWith((current) =>
      current.scope === UNGROUPED_SCOPE_KEY
        ? { ...current, scope: ALL_SCOPE_KEY }
        : current,
    );
  }, [groupScope.kind, patchViewStateWith, surface, ungroupedTabVisible]);

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
      // A feature in the list is already in scope, and sits under no group:
      // the list was drawn for the scope it is in.
      const scoped =
        ancestors.inFeature ||
        projectInScope(
          resolveGroupScope(current.scope, validGroupIds),
          groupAssignment,
          validGroupIds,
          ancestors.projectId,
        );
      const collapsedGroups = ancestors.inFeature
        ? current.collapsedGroups
        : current.collapsedGroups.filter((id) => id !== groupKey);
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
      const shouldExpandFeature =
        ancestors.inFeature &&
        (sidebarMode === "threads" || ancestors.workspaceKey !== null);
      const expandedFeatures = shouldExpandFeature
        ? withId(current.expandedFeatures, ancestors.projectId, true)
        : current.expandedFeatures;
      const scope = scoped ? current.scope : groupKey;
      if (
        scope === current.scope &&
        collapsedGroups.length === current.collapsedGroups.length &&
        collapsedProjects.length === current.collapsedProjects.length &&
        expandedWorkspaces.length === current.expandedWorkspaces.length &&
        collapsedFamilies.length === current.collapsedFamilies.length &&
        expandedFeatures.length === current.expandedFeatures.length
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
        expandedFeatures,
      };
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
 * The branch to open for a thread, in whichever section draws it.
 *
 * Under a feature the "project" level is the feature, so its id is the one the
 * collapse set is keyed by; a root conversation has no workspace row to open.
 */
function revealTarget(
  treeNodes: readonly GroupNode[],
  featureNodes: readonly FeatureNode[],
  threadId: string,
): {
  readonly groupId: string | null;
  readonly projectId: string;
  readonly workspaceKey: string | null;
  readonly rootId: string;
  readonly inFeature: boolean;
} | null {
  const found = threadAncestors(treeNodes, threadId);
  if (found !== null) return { ...found, inFeature: false };
  const inFeature = featureThreadAncestors(featureNodes, threadId);
  return inFeature === null
    ? null
    : {
        groupId: null,
        projectId: inFeature.featureId,
        workspaceKey: inFeature.workspaceKey,
        rootId: inFeature.rootId,
        inFeature: true,
      };
}
