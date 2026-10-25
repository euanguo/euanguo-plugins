import * as React from "react";
import { Icon } from "@/components/ui/icon";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse";
import {
  ROW_LAYOUT_CHANGED_EVENT,
  lastRowPointer,
  rememberRowPointer,
} from "@/lib/row-pointer";
import { cn } from "@/lib/utils";

/**
 * The trailing controls every row shares.
 *
 * A row exposes at most THREE things: the one action frequent enough to deserve
 * its own button (`+` — start a thread here), the disclosure that says it can
 * open and which way it is now, and a menu holding everything else. The menu is
 * a right-click, so it costs no width and needs no trigger.
 *
 * The disclosure is its own control rather than part of the menu trigger, which
 * is what it used to be. One slot doing both jobs meant the arrow vanished the
 * moment the pointer arrived (the trigger swapped it for three dots), so a row
 * could not be read as open or closed while you were pointing at it — which is
 * exactly when you are deciding whether to click it.
 */

/**
 * Whether the pointer or the keyboard is on a row, for the one thing that swaps
 * under them: a thread card's park buttons, which replace its age.
 *
 * Tracked in React rather than with Tailwind group modifiers on purpose: rows
 * nest (a card inside a worktree inside a project), and CSS `group-hover` fires
 * for every ancestor group, which would light up a parent's controls while the
 * pointer is on a child.
 */
export function useRowReveal<T extends HTMLElement = HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [pointer, setPointer] = React.useState(false);
  const [focus, setFocus] = React.useState(false);
  /**
   * A coarse pointer has no hover, so a control gated on one never appears.
   * It was not merely unreachable either: the park pair is painted with
   * `opacity-0` and left with `pointer-events: auto`, so a tap anywhere over
   * it wrote a snooze while the user saw an empty row. Measured on a coarse
   * emulation: the wrapper read `opacity: 0` and `elementFromPoint` at the
   * button's own centre still returned the button. Revealed is therefore
   * unconditional there.
   */
  const coarse = usePointerCoarse();

  React.useEffect(() => {
    const recheck = () => {
      const node = ref.current;
      const position = lastRowPointer();
      if (node === null || position === null) return;
      if (typeof document.elementFromPoint !== "function") return;
      const hit = document.elementFromPoint(position.x, position.y);
      setPointer(hit !== null && node.contains(hit));
    };
    document.addEventListener(ROW_LAYOUT_CHANGED_EVENT, recheck);
    return () => {
      document.removeEventListener(ROW_LAYOUT_CHANGED_EVENT, recheck);
    };
  }, []);

  return {
    ref,
    revealed: coarse || pointer || focus,
    handlers: {
      onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
        rememberRowPointer({ x: event.clientX, y: event.clientY });
        setPointer(true);
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        rememberRowPointer({ x: event.clientX, y: event.clientY });
      },
      onPointerLeave: () => setPointer(false),
      onFocusCapture: () => setFocus(true),
      onBlurCapture: () => setFocus(false),
    },
  };
}

/**
 * The arrow: whether a row is open, and the way to change it.
 *
 * Always visible and never swapped for anything, because the state it reports
 * is worth reading at rest as well as under the pointer.
 */
export function RowDisclosure({
  label,
  expanded,
  controls,
  onToggle,
}: {
  /** What the row is, for the accessible name: "Expand Worktrees". */
  label: string;
  expanded: boolean;
  controls: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      title={label}
      data-bb-icon-button=""
      onClick={(event) => {
        // The row's own button toggles too; this must not do both.
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "relative z-10 flex size-5 shrink-0 items-center justify-center rounded-md",
        "text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      <Icon
        name="ChevronDown"
        className={cn(
          "size-3 transition-transform duration-150 ease-out motion-reduce:transition-none",
          expanded && "rotate-180",
        )}
        aria-hidden
      />
    </button>
  );
}

/** A frequent, always-visible row action. */
export function RowActionButton({
  label,
  icon,
  onClick,
  className,
}: {
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-bb-icon-button=""
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "relative z-10 flex size-5 shrink-0 items-center justify-center rounded-md",
        "text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      <Icon name={icon} className="size-3" aria-hidden />
    </button>
  );
}

/** The trailing cluster: an optional primary action, then the menu trigger. */
export function RowActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "ml-auto flex min-w-0 shrink-0 items-center justify-end gap-0.5",
        className,
      )}
    >
      {children}
    </span>
  );
}
