import {
  automaticProjectColor,
  bestBadgeForeground,
} from "@/lib/domain/project-colors";
import { cn } from "@/lib/ui/utils";

/**
 * A group's letter tile.
 *
 * The scope strip names a group with one character drawn here instead of the
 * emoji a user had to pick for it: the first character of the name is already
 * there, needs no picker, and cannot be empty.
 *
 * The colour comes from the group's own key rather than its name, so renaming a
 * group keeps its tile, and two groups that start with the same letter still
 * look different. The palette is the project badge's — one set of tiles for the
 * whole sidebar rather than a second one beside it.
 */
export function GroupBadge({
  name,
  seed,
  className,
}: {
  name: string;
  seed: string;
  className?: string;
}) {
  const backgroundColor = automaticProjectColor(seed);
  return (
    <span
      aria-hidden
      data-nest-group-badge={seed}
      className={cn(
        "flex shrink-0 items-center justify-center rounded border border-black/15 font-semibold uppercase leading-none shadow-sm",
        className,
      )}
      style={{
        backgroundColor,
        color: bestBadgeForeground(backgroundColor),
      }}
    >
      {badgeLetter(name)}
    </span>
  );
}

/**
 * The character the tile shows.
 *
 * Spread rather than `charAt(0)`: a name may start outside the BMP — an emoji
 * someone pasted in — and half a surrogate pair would draw as a box.
 */
function badgeLetter(name: string): string {
  const first = [...name.trim()][0];
  return first === undefined ? "?" : first.toLocaleUpperCase();
}
