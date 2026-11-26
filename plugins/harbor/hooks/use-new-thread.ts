/**
 * Where a new thread starts, and what happens to it once it exists.
 *
 * `useNewThread` manages sidebar-initiated dialog seeds (`NewThreadDialog`),
 * while `useWorkspaceSpawn` consolidates composer submission, environment
 * pinning, busy/error state, and draft-preserving error propagation across both
 * `NewChatPage` and `NewThreadDialog`.
 */
import {
  useRpc,
  type NewThreadComposerProps,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { NewThreadSeed } from "@/components/inbox/new-thread-dialog";
import type { WorkspaceLaunch } from "@/components/inbox/tree-row-types";
import { errorMessage } from "../lib/domain/rpc-error.ts";
import type { WorkspacePaths } from "../lib/domain/workspace.ts";
import type { harborRpcContract } from "../server/contract.ts";

export type WorkspaceSpawnEnvironment = NonNullable<
  NewThreadComposerProps["defaultEnvironment"]
>;

export interface WorkspaceSpawnOptions {
  /** Resets transient error/busy state and bumps focus when the target seed changes. */
  readonly resetKey: string;
  readonly projectId?: string;
  readonly environment?: WorkspaceSpawnEnvironment;
  readonly locked?: boolean;
  /** Optional lazy project lookup when an unindexed worktree submits before metadata loads. */
  readonly resolveFallbackProjectId?: () => Promise<string | null>;
  readonly onCreated: (threadId: string) => void;
}

export interface WorkspaceSpawnController {
  readonly busy: boolean;
  readonly error: string | null;
  readonly focusRequest: number;
  readonly requestFocus: () => void;
  readonly submit: (request: NewThreadRequest) => Promise<void>;
}

/**
 * Resolves the final spawn payload for `NewThreadComposer` submissions.
 *
 * A `reuse` seed is re-asserted on submit because `NewThreadComposer` builds its
 * reuse list by grouping threads; an empty or all-archived worktree is absent
 * from that list and would otherwise silently fall back to the project default.
 */
export function buildSpawnRequestPayload(input: {
  readonly request: NewThreadRequest;
  readonly projectId?: string;
  readonly environment?: WorkspaceSpawnEnvironment;
  readonly locked?: boolean;
  readonly fallbackProjectId?: string | null;
}): Record<string, unknown> {
  const { request, projectId, environment, locked, fallbackProjectId } = input;
  const reused = environment?.type === "reuse" ? environment : null;
  if (locked === true && projectId !== undefined && environment !== undefined) {
    return { ...request, projectId, environment };
  }
  if (reused !== null) {
    return {
      ...request,
      environment: reused,
      ...(fallbackProjectId !== undefined && fallbackProjectId !== null
        ? { projectId: fallbackProjectId }
        : {}),
    };
  }
  return { ...request };
}

/** Shared composer submission controller for `NewChatPage` and `NewThreadDialog`. */
export function useWorkspaceSpawn(
  options: WorkspaceSpawnOptions,
): WorkspaceSpawnController {
  const {
    resetKey,
    projectId,
    environment,
    locked,
    resolveFallbackProjectId,
    onCreated,
  } = options;
  const rpc = useRpc<typeof harborRpcContract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    setError(null);
    setBusy(false);
    setFocusRequest((value) => value + 1);
  }, [resetKey]);

  const requestFocus = useCallback(() => {
    setFocusRequest((value) => value + 1);
  }, []);

  const submit = useCallback(
    async (request: NewThreadRequest) => {
      setBusy(true);
      setError(null);
      try {
        const fallbackProjectId =
          projectId === undefined &&
          environment?.type === "reuse" &&
          resolveFallbackProjectId !== undefined
            ? await resolveFallbackProjectId()
            : null;
        const payload = buildSpawnRequestPayload({
          request,
          projectId,
          environment,
          locked,
          fallbackProjectId,
        });
        const created = await rpc.call("spawnThread", { request: payload });
        if (created.threadId === null) {
          throw new Error("Could not create the thread.");
        }
        onCreated(created.threadId);
      } catch (caught) {
        setError(errorMessage(caught, "Could not create the thread."));
        // Rethrow so `NewThreadComposer` keeps the user's draft intact.
        throw caught;
      } finally {
        setBusy(false);
      }
    },
    [
      environment,
      locked,
      onCreated,
      projectId,
      resolveFallbackProjectId,
      rpc,
    ],
  );

  return useMemo(
    () => ({ busy, error, focusRequest, requestFocus, submit }),
    [busy, error, focusRequest, requestFocus, submit],
  );
}

export interface NewThreadApi {
  /** The dialog's seed, or null when it is closed. */
  readonly seed: NewThreadSeed | null;
  readonly close: () => void;
  /** Close the dialog and navigate to the spawned thread. */
  readonly created: (threadId: string | null) => void;
  /** `+` on a project row: a project and nothing more. */
  readonly seedFromProject: (projectId: string, projectName: string) => void;
  /** "New worktree": an instruction to create one, not a reference to one. */
  readonly seedNewWorktree: (projectId: string, projectName: string) => void;
  /** `+` on a workspace row: the worktree that row names. */
  readonly seedFromWorkspace: (launch: WorkspaceLaunch) => void;
  /** `+` on a feature row: the feature directory, as an unmanaged workspace. */
  readonly seedFromFeature: (input: {
    readonly featureName: string;
    readonly projectId: string;
    readonly projectName: string;
    readonly rootPath: string;
    readonly hostId: string | null;
  }) => void;
}

export function useNewThread(input: {
  readonly paths: WorkspacePaths;
  readonly hostThreads?: readonly { readonly id: string }[];
  readonly openThread: (threadId: string) => void;
  readonly onNavigate: () => void;
}): NewThreadApi {
  const { paths, openThread, onNavigate } = input;
  const [seed, setSeed] = useState<NewThreadSeed | null>(null);

  const close = useCallback(() => setSeed(null), []);
  const created = useCallback(
    (threadId: string | null) => {
      setSeed(null);
      if (threadId !== null) {
        openThread(threadId);
        onNavigate();
      }
    },
    [onNavigate, openThread],
  );

  const seedFromProject = useCallback(
    (projectId: string, projectName: string) => {
      setSeed({ projectId, projectName, originLabel: projectName });
    },
    [],
  );

  const seedNewWorktree = useCallback(
    (projectId: string, projectName: string) => {
      const hostId = paths.projects[projectId]?.sourceHostId ?? null;
      setSeed({
        projectId,
        projectName,
        environment:
          hostId === null
            ? undefined
            : {
                type: "host",
                hostId,
                workspace: {
                  type: "managed-worktree",
                  baseBranch: { kind: "default" },
                },
              },
        originLabel:
          hostId === null ? projectName : `New worktree in ${projectName}`,
      });
    },
    [paths],
  );

  const seedFromWorkspace = useCallback((launch: WorkspaceLaunch) => {
    const { node, projectId, projectName } = launch;
    const environment: NewThreadSeed["environment"] =
      node.ref.environmentId === null
        ? node.ref.path !== null && node.ref.hostId !== null
          ? ({
              type: "host",
              hostId: node.ref.hostId,
              workspace: {
                type: "unmanaged",
                path: node.ref.path,
                branch:
                  node.ref.branch === null
                    ? undefined
                    : { kind: "existing", name: node.ref.branch },
              },
            } satisfies NonNullable<NewThreadSeed["environment"]>)
          : undefined
        : { type: "reuse", environmentId: node.ref.environmentId };
    setSeed({
      projectId,
      projectName,
      environment,
      originLabel:
        environment === undefined
          ? `Seeded from ${projectName}`
          : `${projectName} → ${node.ref.label}`,
    });
  }, []);

  const seedFromFeature = useCallback(
    (featureInput: {
      featureName: string;
      projectId: string;
      projectName: string;
      rootPath: string;
      hostId: string | null;
    }) => {
      setSeed({
        projectId: featureInput.projectId,
        projectName: featureInput.projectName,
        title: `New thread in ${featureInput.featureName}`,
        originLabel: featureInput.rootPath,
        locked: true,
        environment: {
          type: "host",
          ...(featureInput.hostId === null ? {} : { hostId: featureInput.hostId }),
          workspace: { type: "unmanaged", path: featureInput.rootPath },
        },
      });
    },
    [],
  );

  return {
    seed,
    close,
    created,
    seedFromProject,
    seedNewWorktree,
    seedFromWorkspace,
    seedFromFeature,
  };
}
