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
import { useCallback, useMemo, useState } from "react";
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

  const patch = useCallback((next: Partial<NestViewState>) => {
    setState((current) => {
      const merged = { ...current, ...next };
      writeViewState(merged);
      return merged;
    });
  }, []);

  const patchWith = useCallback(
    (update: (current: NestViewState) => NestViewState) => {
      setState((current) => {
        const next = update(current);
        if (next === current) return current;
        writeViewState(next);
        return next;
      });
    },
    [],
  );

  const api = useMemo<NestViewStateApi>(
    () => ({
      isGroupCollapsed: (groupId) => state.collapsedGroups.includes(groupId),
      setGroupCollapsed: (groupId, collapsed) =>
        patch({ collapsedGroups: withId(state.collapsedGroups, groupId, collapsed) }),
      isProjectCollapsed: (projectId) =>
        state.collapsedProjects.includes(projectId),
      setProjectCollapsed: (projectId, collapsed) =>
        patch({
          collapsedProjects: withId(state.collapsedProjects, projectId, collapsed),
        }),
      isWorkspaceExpanded: (workspaceKey) =>
        state.expandedWorkspaces.includes(workspaceKey),
      setWorkspaceFolded: ({ keys, openKey, expanded }) =>
        patch({
          expandedWorkspaces: foldWorkspaceExpansion(
            state.expandedWorkspaces,
            keys,
            openKey,
            expanded,
          ),
        }),
      setWorkspaceExpanded: (workspaceKey, expanded) =>
        patch({
          expandedWorkspaces: withId(state.expandedWorkspaces, workspaceKey, expanded),
        }),
      isArchivedShelfOn: (projectId) =>
        state.archivedProjects.includes(projectId),
      setArchivedShelf: (projectId, on) =>
        patch({ archivedProjects: withId(state.archivedProjects, projectId, on) }),
      familyOverride: (rootId) => {
        if (state.collapsedFamilies.includes(rootId)) return false;
        if (state.expandedFamilies.includes(rootId)) return true;
        return null;
      },
      setFamilyOverride: (rootId, expanded) => {
        if (expanded === null) {
          patch({
            expandedFamilies: withId(state.expandedFamilies, rootId, false),
            collapsedFamilies: withId(state.collapsedFamilies, rootId, false),
          });
          return;
        }
        patch({
          expandedFamilies: withId(state.expandedFamilies, rootId, expanded),
          collapsedFamilies: withId(state.collapsedFamilies, rootId, !expanded),
        });
      },
    }),
    [patch, state],
  );

  return { state, patch, patchWith, api };
}
