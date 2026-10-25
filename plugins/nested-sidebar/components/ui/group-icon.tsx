import { cn } from "@/lib/utils";
import { canonicalGroupIcon, type GroupIconName } from "@/lib/group-icons";

/**
 * A group's icon: one emoji, drawn as text.
 *
 * This used to be a lazy artwork loader — a batching fetch, a cache, an
 * IntersectionObserver to defer off-screen tiles, and an RPC round trip per
 * name, all so a row could show a picture from a 6,025-icon library whose
 * artwork was 6.9 MB. An emoji needs none of it: it is a character, so it
 * arrives with the text, costs nothing to draw, and cannot fail to load.
 *
 * `defer` is kept on the props because callers still pass it, but there is
 * nothing left to defer — the value is a string in the render tree already.
 */
export function GroupIcon({
  name,
  className,
  ariaHidden,
  ariaLabel,
}: {
  name: GroupIconName;
  className?: string;
  ariaHidden?: boolean | "true" | "false";
  ariaLabel?: string;
  /** Accepted and ignored: an emoji has no artwork to load. */
  defer?: boolean;
}) {
  const glyph = canonicalGroupIcon(name);
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center leading-none", className)}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      // The stored value is what a user chose, so it is also what a test or a
      // stylesheet should be able to find the tile by.
      data-group-icon={glyph}
    >
      {glyph}
    </span>
  );
}
