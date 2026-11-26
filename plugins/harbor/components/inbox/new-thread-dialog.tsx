import { experimental_NewThreadComposer as NewThreadComposer } from "@get-bb/plugin-sdk/app";
import { Modal } from "@/components/ui/modal";
import {
  useWorkspaceSpawn,
  type WorkspaceSpawnEnvironment,
} from "@/hooks/use-new-thread";

export interface NewThreadSeed {
  /** Always set: this dialog only exists to create inside a known project. */
  readonly projectId: string;
  readonly projectName: string;
  /** The workspace the user clicked + on, when they clicked a workspace row. */
  readonly environment?: WorkspaceSpawnEnvironment;
  /** Shown in the header so the user can see where the seed came from. */
  readonly originLabel: string;
  /** The dialog's title, when "New thread in <project>" would name the wrong place. */
  readonly title?: string;
  /**
   * Submit exactly this project and environment, whatever the composer's pickers
   * say. A feature's conversation has one right place — its folder, in the
   * Features project — and a picker that drifted would start it somewhere the
   * feature view never shows.
   */
  readonly locked?: boolean;
}

/**
 * The new-thread dialog.
 *
 * bb's own compose surface is reused verbatim and framed as a modal seeded from
 * the row the user clicked.
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
  if (seed === null) return null;

  return <SeedDialog seed={seed} onClose={onClose} onCreated={onCreated} />;
}

function SeedDialog({
  seed,
  onClose,
  onCreated,
}: {
  seed: NewThreadSeed;
  onClose: () => void;
  onCreated: (threadId: string | null) => void;
}) {
  const spawn = useWorkspaceSpawn({
    resetKey: `${seed.projectId}:${seed.originLabel}:${seed.locked === true ? "1" : "0"}`,
    projectId: seed.projectId,
    environment: seed.environment,
    locked: seed.locked,
    onCreated,
  });

  return (
    <Modal
      open
      onClose={onClose}
      busy={spawn.busy}
      icon="Plus"
      width="56rem"
      allowOverflow
      title={seed.title ?? `New thread in ${seed.projectName}`}
      subtitle={seed.originLabel}
    >
      {spawn.error === null ? null : (
        <p
          role="alert"
          className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-2xs text-destructive"
        >
          {spawn.error}
        </p>
      )}
      <NewThreadComposer
        key={`${seed.projectId}:${seed.originLabel}`}
        defaultProjectId={seed.projectId}
        defaultEnvironment={seed.environment}
        layout="document"
        focusRequest={spawn.focusRequest}
        draftKey={`harbor:new:${seed.projectId}`}
        placeholder="Describe the work for this thread…"
        onSubmit={spawn.submit}
      />
    </Modal>
  );
}
