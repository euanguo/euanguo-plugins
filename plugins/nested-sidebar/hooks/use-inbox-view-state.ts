/**
 * The tree's remembered shape, as one hook.
 *
 * bb restores the route but nothing about the shape the user left the tree in,
 * so a reload would drop them back on "All" with everything expanded. This is
 * that record and the write path for it: the scope, the filter, and every
 * collapsed or expanded id, stored as one object so a crash between two writes
 * cannot leave a filter from one session over a scope from another.
 *
 * It lives here rather than inline in `ThreadInbox` because the state, the
 * accessors four different row levels call, and the persistence rule are one
 * subject — and because the component had grown to hold four such subjects.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { NestViewStateApi } from "@/components/inbox/view-state-context";
import {
  foldWorkspaceExpansion,
  readViewState,
  withId,
  writeViewState,
  type NestViewState,
} from "@/lib/view-state";

export interface InboxViewStateApi {
  readonly state: NestViewState;
  /**
   * One write path for the remembered view.
   *
   * The setter takes a patch rather than a whole state so callers never have to
   * spread the record themselves — that is how a scope change would silently
   * drop a collapse. The write is best-effort: a browser refusing storage
   * leaves the session working, just without persistence.
   */
  readonly patch: (patch: Partial<NestViewState>) => void;
  /**
   * A patch computed from the current record.
   *
   * The two callers that need this decide from what is stored — "is this scope
   * still valid", "what is still collapsed on the way to this thread" — so a
   * patch built from the render's copy would act on a stale one.
   */
  readonly patchWith: (
    update: (current: NestViewState) => NestViewState,
  ) => void;
  /** What the row components reach, in the shape they ask for. */
  readonly api: NestViewStateApi;
}

export function useInboxViewState(): InboxViewStateApi {
  const [state, setState] = useState<NestViewState>(readViewState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const patchWith = useCallback(
    (update: (current: NestViewState) => NestViewState) => {
      const next = update(stateRef.current);
      if (next === stateRef.current) return;
      stateRef.current = next;
      setState(next);
      writeViewState(next);
    },
    [],
  );

  const patch = useCallback(
    (next: Partial<NestViewState>) =>
      patchWith((current) => ({ ...current, ...next })),
    [patchWith],
  );

  const api = useMemo<NestViewStateApi>(
    () => ({
      isGroupCollapsed: (groupId) => state.collapsedGroups.includes(groupId),
      setGroupCollapsed: (groupId, collapsed) =>
        patchWith((current) => ({
          ...current,
          collapsedGroups: withId(current.collapsedGroups, groupId, collapsed),
        })),
      isProjectCollapsed: (projectId) =>
        state.collapsedProjects.includes(projectId),
      setProjectCollapsed: (projectId, collapsed) =>
        patchWith((current) => ({
          ...current,
          collapsedProjects: withId(current.collapsedProjects, projectId, collapsed),
        })),
      isWorkspaceExpanded: (workspaceKey) =>
        state.expandedWorkspaces.includes(workspaceKey),
      setWorkspaceFolded: ({ keys, openKey, expanded }) =>
        patchWith((current) => ({
          ...current,
          expandedWorkspaces: foldWorkspaceExpansion(
            current.expandedWorkspaces,
            keys,
            openKey,
            expanded,
          ),
        })),
      setWorkspaceExpanded: (workspaceKey, expanded) =>
        patchWith((current) => ({
          ...current,
          expandedWorkspaces: withId(current.expandedWorkspaces, workspaceKey, expanded),
        })),
      isArchivedShelfOn: (projectId) =>
        state.archivedProjects.includes(projectId),
      setArchivedShelf: (projectId, on) =>
        patchWith((current) => ({
          ...current,
          archivedProjects: withId(current.archivedProjects, projectId, on),
        })),
      isPersonalProjectExpanded: (projectId) =>
        state.expandedPersonalProjects.includes(projectId),
      setPersonalProjectExpanded: (projectId, expanded) =>
        patchWith((current) => ({
          ...current,
          expandedPersonalProjects: withId(
            current.expandedPersonalProjects,
            projectId,
            expanded,
          ),
        })),
      isFeatureExpanded: (featureId) => state.expandedFeatures.includes(featureId),
      setFeatureExpanded: (featureId, expanded) =>
        patchWith((current) => ({
          ...current,
          expandedFeatures: withId(current.expandedFeatures, featureId, expanded),
        })),
      isFeatureHidden: (featureId) => state.hiddenFeatureIds.includes(featureId),
      setFeatureHidden: (featureId, hidden) =>
        patchWith((current) => ({
          ...current,
          hiddenFeatureIds: withId(current.hiddenFeatureIds, featureId, hidden),
        })),
      setAllFeaturesHidden: (featureIds, hidden) =>
        patchWith((current) => ({
          ...current,
          hiddenFeatureIds: hidden ? [...new Set(featureIds)] : [],
        })),
      familyOverride: (rootId) => {
        if (state.collapsedFamilies.includes(rootId)) return false;
        if (state.expandedFamilies.includes(rootId)) return true;
        return null;
      },
      setFamilyOverride: (rootId, expanded) => {
        if (expanded === null) {
          patchWith((current) => ({
            ...current,
            expandedFamilies: withId(current.expandedFamilies, rootId, false),
            collapsedFamilies: withId(current.collapsedFamilies, rootId, false),
          }));
          return;
        }
        patchWith((current) => ({
          ...current,
          expandedFamilies: withId(current.expandedFamilies, rootId, expanded),
          collapsedFamilies: withId(current.collapsedFamilies, rootId, !expanded),
        }));
      },
    }),
    [patchWith, state],
  );

  return { state, patch, patchWith, api };
}
