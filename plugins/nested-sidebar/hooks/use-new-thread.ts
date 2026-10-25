/**
 * Where a new thread starts, and what happens to it once it exists.
 *
 * Two halves of one subject. The first is the seed: every `+` in the sidebar
 * opens the same dialog, and what differs between them is only the environment
 * it starts from. The second is the aftermath — a spawned thread has to be
 * opened once the sidebar can actually see it, which is not the moment the RPC
 * answers.
 *
 * Both lived inline in `ThreadInbox`, which is why that component knew about
 * worktree seeds, the composer's own environment-picker quirks, and the host's
 * silent no-op on an unknown thread id. None of that is about drawing a list.
 */
import { useCallback, useEffect, useState } from "react";
import { announceToSidebar } from "@/lib/clipboard";
import type { NewThreadSeed } from "@/components/inbox/new-thread-dialog";
import type { WorkspaceLaunch } from "@/components/inbox/tree-rows";
import type { WorkspacePaths } from "@/lib/workspace";

/** How long a spawn may wait for the sidebar to report its thread. */
const PENDING_OPEN_TIMEOUT_MS = 15_000;

export interface NewThreadApi {
  /** The dialog's seed, or null when it is closed. */
  readonly seed: NewThreadSeed | null;
  readonly close: () => void;
  /** Open the seed the user asked for, then wait for the thread it creates. */
  readonly created: (threadId: string | null) => void;
  /** `+` on a project row: a project and nothing more. */
  readonly seedFromProject: (projectId: string, projectName: string) => void;
  /** "New worktree": an instruction to create one, not a reference to one. */
  readonly seedNewWorktree: (projectId: string, projectName: string) => void;
  /** `+` on a workspace row: the worktree that row names. */
  readonly seedFromWorkspace: (launch: WorkspaceLaunch) => void;
}

export function useNewThread(input: {
  readonly paths: WorkspacePaths;
  /** Every thread the sidebar currently holds, to know when the spawn lands. */
  readonly hostThreads: readonly { readonly id: string }[];
  readonly openThread: (threadId: string) => void;
  readonly onNavigate: () => void;
}): NewThreadApi {
  const { paths, hostThreads, openThread, onNavigate } = input;
  const [seed, setSeed] = useState<NewThreadSeed | null>(null);
  /**
   * A thread this plugin just spawned, waiting to be opened.
   *
   * `sidebarActions.open` is a silent no-op for a thread the host's client
   * store has not received yet — it looks the id up and returns if it is not
   * there. A spawn is always inside that window: the create RPC answers before
   * the sidebar's own read catches up, so opening on the spot does nothing and
   * the user is left on the composer they just submitted. The id waits here
   * instead and is opened on the render that brings the thread in.
   */
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (pendingOpenId === null) return;
    if (!hostThreads.some((thread) => thread.id === pendingOpenId)) return;
    setPendingOpenId(null);
    openThread(pendingOpenId);
    // The host's `onNavigate` is the one thing that closes the mobile drawer,
    // and every other route into a thread calls it. This one skipped it, so a
    // thread started from a row on a phone opened behind an open sidebar.
    onNavigate();
  }, [hostThreads, pendingOpenId, openThread, onNavigate]);

  // A thread the sidebar never hands back — one spawned into a view this
  // client does not hold — must not leave this waiting for the session. It is
  // announced rather than dropped silently: the thread exists, and a user who
  // watched the dialog close is owed the reason the list did not follow.
  useEffect(() => {
    if (pendingOpenId === null) return;
    const timer = setTimeout(() => {
      setPendingOpenId(null);
      announceToSidebar(
        "The thread was created, but this sidebar has not received it yet.",
      );
    }, PENDING_OPEN_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingOpenId]);

  const close = useCallback(() => setSeed(null), []);
  const created = useCallback((threadId: string | null) => {
    setSeed(null);
    setPendingOpenId(threadId);
  }, []);

  /**
   * A project row has no worktree to seed — the composer's own environment
   * picker is where that is chosen — but the surface stays the one the
   * workspace rows use, and `+` means the same thing on every row.
   */
  const seedFromProject = useCallback(
    (projectId: string, projectName: string) => {
      setSeed({ projectId, projectName, originLabel: projectName });
    },
    [],
  );

  /**
   * bb has no standalone "create environment" call — an environment comes into
   * being when a thread spawns into it — so creating a worktree and creating a
   * thread are one action by construction. The dialog is where that happens,
   * with the branch and base still the user's to choose.
   *
   * Unlike a workspace row's seed this one is not settled on submit: it is an
   * instruction to create rather than a reference to something that already
   * exists, so the branch picker stays the user's to change.
   *
   * `hostId` is not optional in practice even though the contract marks it so:
   * the composer resolves a `host` seed with no host to `null` and silently
   * falls back to the project's default, which is how this seed used to arrive
   * as a plain project checkout. The project's source host is the machine the
   * worktree belongs on.
   */
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
        // With no source host there is no worktree seed either, so the header
        // says where this actually came from rather than naming a worktree that
        // was never asked for.
        originLabel:
          hostId === null ? projectName : `New worktree in ${projectName}`,
      });
    },
    [paths],
  );

  /**
   * A workspace row seeds the worktree it belongs to, and the dialog submits
   * that exact environment rather than trusting the composer to keep it.
   *
   * It cannot be handed to `openNewThread`: that shortcut accepts only a
   * project and a focus flag, so the worktree would be dropped and the thread
   * would land in a brand-new worktree instead. The composer's own environment
   * picker is no substitute either — its "reuse an existing environment" list
   * is built by grouping *threads*, so a worktree whose threads have all been
   * archived is simply absent from it, and a `reuse` seed the list does not
   * contain is dropped without an error. Starting a thread in a worktree that
   * has no threads left is exactly the case this row exists for, which is why
   * the dialog owns both the seed and the environment it finally submits.
   */
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

  return {
    seed,
    close,
    created,
    seedFromProject,
    seedNewWorktree,
    seedFromWorkspace,
  };
}
