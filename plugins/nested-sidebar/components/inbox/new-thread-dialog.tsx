import { useEffect, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  useRpc,
  type NewThreadComposerProps,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server";
import { Modal } from "@/components/ui/modal";

/**
 * The environment seed shape, borrowed from the host composer's own prop rather
 * than redeclared: it is exactly what that prop accepts, and the SDK does not
 * export the underlying type by name.
 */
type CreateThreadEnvironmentArgs = NonNullable<
  NewThreadComposerProps["defaultEnvironment"]
>;

export interface NewThreadSeed {
  /** Always set: this dialog only exists to create inside a known project. */
  readonly projectId: string;
  readonly projectName: string;
  /** The workspace the user clicked + on, when they clicked a workspace row. */
  readonly environment?: CreateThreadEnvironmentArgs;
  /** Shown in the header so the user can see where the seed came from. */
  readonly originLabel: string;
}

/**
 * The new-thread dialog.
 *
 * bb's own compose surface is reused verbatim — prompt editor, attachments,
 * provider/model/reasoning, environment and branch pickers — and merely
 * framed as a modal seeded from the row the user clicked. That is deliberate:
 * reimplementing the composer would drift from bb's own behaviour, and the
 * host component is the one thing that cannot fall behind it.
 *
 * The seed is a seed, not a lock: the project picker stays editable, and the
 * environment picker can still be pointed at a different worktree — or at a
 * newly created one — from inside the composer.
 *
 * The dialog is only ever open when there is a seed, and it closes through the
 * shared modal's unconditional escape hatches, so a composer that renders
 * slowly — or not at all — can never trap the user.
 */
export function NewThreadDialog({
  seed,
  onClose,
  onCreated,
}: {
  seed: NewThreadSeed | null;
  onClose: () => void;
  onCreated: (threadId: string | null) => void;
}) {
  // No seed, no dialog — not a dialog with empty content. A new-thread modal
  // without a project has nothing to seed and nothing useful to show, so the
  // honest thing is for it not to exist. This is also the belt to the modal's
  // braces: even if `open` were somehow true, there is no seed to title it with
  // and no way to get an unlabelled box on screen.
  if (seed === null) return null;

  return <SeedDialog seed={seed} onClose={onClose} onCreated={onCreated} />;
}

/**
 * The seeded dialog itself, split out so the hook order is stable: the guard
 * above returns before any hooks run, and this component is only ever mounted
 * with a real seed.
 */
function SeedDialog({
  seed,
  onClose,
  onCreated,
}: {
  seed: NewThreadSeed;
  onClose: () => void;
  onCreated: (threadId: string | null) => void;
}) {
  const rpc = useRpc<typeof nestRpcContract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    setError(null);
    setBusy(false);
    setFocusRequest((value) => value + 1);
  }, [seed]);

  const submit = async (request: NewThreadRequest) => {
    setBusy(true);
    setError(null);
    try {
      // A `reuse` seed is the one the composer can drop on its own: its "reuse
      // an existing environment" list is built by grouping *threads*, so a
      // worktree whose threads have all been archived is absent from it, and a
      // seed it does not hold loses to the default — silently, and in exactly
      // the case this dialog exists for. Clicking `+` on a workspace row is the
      // user naming the worktree themselves, so that seed is re-asserted here.
      //
      // Every other seed is left to the composer. A project seed has no
      // worktree in it, and a new-worktree seed is an instruction the branch
      // picker is free to refine; overriding either would discard a choice the
      // user made in the composer's own controls.
      const reused =
        seed.environment?.type === "reuse" ? seed.environment : null;
      const created = await rpc.call("spawnThread", {
        request: {
          ...request,
          ...(reused === null ? {} : { environment: reused }),
        },
      });
      onCreated(created.threadId);
    } catch (caught) {
      // The composer keeps its draft when submit throws, so the user never
      // loses what they typed to a failed create.
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      icon="Add"
      // Roomier than the default: this is bb's whole compose surface, and the
      // row of pickers beneath the prompt is what goes first when it is narrow.
      // Only the width — the composer is content-height, so a forced height
      // would show as blank space rather than as a bigger editor.
      width="56rem"
      // The composer's slash panel is positioned inside it and cannot be
      // painted under a clipping ancestor, so this is the one dialog that must
      // not clip — see Modal for what that costs.
      allowOverflow
      title={`New thread in ${seed.projectName}`}
      subtitle={seed.originLabel}
    >
      {error === null ? null : (
        <p className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-2xs text-destructive">
          {error}
        </p>
      )}
      <NewThreadComposer
        // Re-mount on a new seed so the composer re-seeds its pickers from the
        // row the user actually clicked, not the previous one.
        key={`${seed.projectId}:${seed.originLabel}`}
        defaultProjectId={seed.projectId}
        defaultEnvironment={seed.environment}
        layout="document"
        focusRequest={focusRequest}
        draftKey={`nest:new:${seed.projectId}`}
        placeholder="Describe the work for this thread…"
        onSubmit={submit}
      />
    </Modal>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Could not create the thread.";
}
