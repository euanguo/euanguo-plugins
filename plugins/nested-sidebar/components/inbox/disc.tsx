import { cn } from "@/lib/utils";

/**
 * The one thing a disc needs from a thread: its id, which is where the colour
 * comes from.
 *
 * Narrower than the host's thread DTO on purpose, so a folded row can draw a
 * cluster from the ids its rollup already carries without holding the threads
 * themselves — a project's rollup is a summary, and should stay one.
 */
export interface DiscThread {
  readonly id: string;
}

/**
 * A per-thread dot. Colour comes from the thread's id so the same thread keeps
 * the same colour everywhere it appears, and every hue is a rotation of one
 * accent, so a custom palette still applies.
 *
 * `thread` is null for the "and more" disc in a cluster.
 */
export function Disc({
  thread,
  compact = false,
}: {
  thread: DiscThread | null;
  /** A size down, for a cluster that has to sit inside a chip. */
  compact?: boolean;
}) {
  const hue = thread === null ? 0 : hashHue(thread.id);
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-full border border-background",
        compact ? "size-2.5" : "size-3.5",
      )}
      style={{
        backgroundColor:
          thread === null
            ? "var(--muted-foreground)"
            : `oklch(0.72 0.13 ${hue})`,
      }}
    />
  );
}

/**
 * Up to `max` of a thread's children, overlapping, plus an "and more" disc when
 * there are more. Shared by the thread header's chip, the row's chip and a
 * folded row's rollup, so none of them can disagree about what a cluster of
 * threads under something looks like.
 */
export function DiscCluster({
  threads,
  max = 3,
  compact = false,
}: {
  threads: readonly DiscThread[];
  max?: number;
  compact?: boolean;
}) {
  const shown = threads.slice(0, max);
  const overlap = compact ? "-ml-1" : "-ml-1.5";
  return (
    <span className="flex shrink-0 items-center" aria-hidden>
      {shown.map((thread, index) => (
        // `flex` on the holder, not a plain span: a block box around an
        // `inline-block` is a *line box*, so the disc sits on the text baseline
        // and the font's descent hangs below it — a 10px disc in a 14px holder,
        // reading 1.5px above the middle of the chip it is in. Measured in the
        // running app, and inherited from upstream, which writes the same span.
        <span
          key={thread.id}
          className={cn("flex shrink-0 items-center", index > 0 && overlap)}
        >
          <Disc thread={thread} compact={compact} />
        </span>
      ))}
      {threads.length > max ? (
        <span className={cn("flex shrink-0 items-center", overlap)}>
          <Disc thread={null} compact={compact} />
        </span>
      ) : null}
    </span>
  );
}

export function hashHue(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 360;
  }
  return hash;
}
