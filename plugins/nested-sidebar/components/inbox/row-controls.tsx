/**
 * The small controls a thread row carries.
 *
 * A row is one line in a sidebar and it has to say six things: what state the
 * thread is in, where it lives, which branch, whether it is pinned, and the two
 * ways to park it. Each of those is a control with its own hover, focus and
 * reduced-motion behaviour, which is more detail than the row itself can hold —
 * so they live here, where the animations and the tooltips are the subject
 * rather than an interruption between two rows.
 */
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { FamilyStatusPresentation } from "@/lib/family-status";
import { StatusGlyph } from "@/components/inbox/status-glyph";
import { threadStatus } from "@/components/inbox/status-slot";

// Each of these three carries the keyframes its control needs; they moved with
// the components, because a stylesheet is part of what a component draws.
import "./settle-button.css";
import "./snooze-button.css";
import "./pin-button.css";

export function ThreadStateGlyph({
  thread,
  className,
}: {
  thread: PluginSidebarThread;
  className?: string;
}) {
  const status = threadStatus(thread);
  const label =
    status === null
      ? "Inactive: no active work in this child thread"
      : `${thread.indicatorLabel ?? status.label}: child thread status`;

  const glyph =
    status === null ? (
      <span
        aria-hidden
        className="size-2 rounded-full opacity-50"
        style={{
          backgroundColor:
            "var(--nest-status-inactive, var(--muted-foreground))",
        }}
      />
    ) : (
      <StatusGlyph indicator={status.indicator} label={null} />
    );

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      tabIndex={0}
      className={cn(
        "group/child-status flex size-3.5 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      {glyph}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 w-max max-w-[min(14rem,calc(100cqw-1rem))] translate-y-0.5 rounded-md border border-border bg-popover px-2 py-1.5 text-2xs leading-tight text-popover-foreground opacity-0 shadow-md transition-all duration-150 ease-out motion-reduce:transition-none group-hover/child-status:translate-y-0 group-hover/child-status:opacity-100 group-focus-visible/child-status:translate-y-0 group-focus-visible/child-status:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

export function ThreadLocation({ thread }: { thread: PluginSidebarThread }) {
  const branch = thread.environment?.branchName;
  if (branch) {
    // A worktree's branch is a branch of the project; a thread running in the
    // project's own checkout is on the project's branch. The worktree row above
    // draws its branch line with the same two icons, so the mark means the same
    // thing at both levels.
    const displayKind = thread.environment?.workspaceDisplayKind;
    const isWorktree =
      displayKind === "managed-worktree" || displayKind === "unmanaged-worktree";
    return (
      <span
        title={`Branch: ${branch}`}
        // Carries its own size rather than inheriting: in the one-line layout
        // this sits in the title row, which has no type size of its own, and an
        // inherited 14px branch read as the largest thing on the row.
        className="flex min-w-0 flex-1 items-center gap-1 truncate text-2xs text-muted-foreground"
      >
        <Icon
          name={isWorktree ? "FolderGit" : "GitBranch"}
          aria-label={isWorktree ? "Worktree branch" : "Branch"}
          className="size-3 shrink-0 text-muted-foreground/60"
        />
        <span className="truncate font-mono">{branch}</span>
      </span>
    );
  }
  if (thread.host) {
    return (
      <span
        title={`Host: ${thread.host.name}`}
        className="min-w-0 flex-1 truncate text-2xs text-muted-foreground"
      >
        {thread.host.name}
      </span>
    );
  }
  return <span className="flex-1" />;
}

/**
 * The two park controls' own motion, in one place.
 *
 * Both lift their artwork and light a tinted ground, because they are a pair;
 * what happens next is what tells them apart, and it is the whole point of each
 * control. Settling is over — five sparkles, emerald. Snoozing is later — the
 * clock nods and three marks drift off it, violet, and deliberately quieter than
 * the five the settle spends. The colours are written down rather than read from
 * the palette; `snooze-button.css` says why, and why neither is the sky the
 * working state already uses.
 *
 * Every class here is a literal string so the build can see it.
 */
const PARK_TONES = {
  settle: {
    button: cn(
      "nest-settle group/settle relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md",
      "transition-colors duration-200 ease-out hover:text-emerald-700 dark:hover:text-emerald-300",
      "focus-visible:text-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500/50 dark:focus-visible:text-emerald-300",
      "motion-reduce:transition-none",
    ),
    ground: cn(
      "group-hover/settle:bg-emerald-500/15 group-hover/settle:shadow-[0_0_0_3px_rgb(16_185_129_/_0.08)] group-focus-visible/settle:bg-emerald-500/15",
      "motion-safe:group-hover/settle:-translate-y-0.5 motion-safe:group-focus-visible/settle:-translate-y-0.5 motion-safe:group-active/settle:translate-y-0 motion-safe:group-active/settle:scale-90 group-active/settle:bg-emerald-500/25",
    ),
    icon:
      "motion-safe:group-hover/settle:rotate-[-8deg] motion-safe:group-hover/settle:scale-110 motion-safe:group-focus-visible/settle:rotate-[-8deg] motion-safe:group-focus-visible/settle:scale-110",
  },
  snooze: {
    button: cn(
      "nest-snooze group/snooze relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md",
      "transition-colors duration-200 ease-out hover:text-violet-700 dark:hover:text-violet-300",
      "focus-visible:text-violet-700 focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:focus-visible:text-violet-300",
      "motion-reduce:transition-none",
    ),
    ground: cn(
      "group-hover/snooze:bg-violet-500/15 group-hover/snooze:shadow-[0_0_0_3px_rgb(139_92_246_/_0.08)] group-focus-visible/snooze:bg-violet-500/15",
      "motion-safe:group-hover/snooze:-translate-y-0.5 motion-safe:group-focus-visible/snooze:-translate-y-0.5 motion-safe:group-active/snooze:translate-y-0 motion-safe:group-active/snooze:scale-90 group-active/snooze:bg-violet-500/25",
    ),
    // The nod is a keyframe, not a transform: it plays once per hover and holds
    // its last frame, which a utility class cannot express. So this button's
    // icon carries no rotate or scale of its own to fight it.
    icon: "",
  },
} as const;

export function ParkButton({
  tone,
  label,
  icon,
  onActivate,
}: {
  /** Which of the two park acts this is, and therefore which effect it plays. */
  tone: keyof typeof PARK_TONES;
  label: string;
  icon: Extract<IconName, "Archive" | "Clock">;
  onActivate: () => void;
}) {
  const { button, ground, icon: iconMotion } = PARK_TONES[tone];
  const scope = tone === "settle" ? "settle" : "snooze";
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      }}
      className={button}
    >
      {/* Move only the artwork so hovering an edge cannot move the hit area. */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none relative flex size-full items-center justify-center rounded-[inherit]",
          "transition-[background-color,box-shadow,transform] duration-200 ease-out motion-reduce:transition-none",
          ground,
        )}
      >
        <Icon
          name={icon}
          className={cn(
            "size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none",
            tone === "snooze" && "nest-snooze-hand",
            iconMotion,
          )}
        />
        {tone === "settle"
          ? [0, 1, 2, 3, 4].map((sparkle) => (
              <span
                key={sparkle}
                aria-hidden="true"
                className="nest-settle-sparkle"
              />
            ))
          : // The marks that drift off it. They take the button's own hover
            // tint through `currentColor`, so they cannot drift from the icon.
            [0, 1, 2].map((mark) => (
              <span
                key={mark}
                aria-hidden="true"
                className="nest-snooze-z"
              >
                z
              </span>
            ))}
      </span>
      <ControlTooltip label={label} scope={scope} />
    </button>
  );
}

/**
 * The pin, as a control rather than a mark.
 *
 * The state is the glyph — solid when the thread is pinned, outlined when it is
 * not — and the press is its toggle, so unpinning is one click on the thing that
 * says pinned. **The colour never carries the state.** It wears exactly what the
 * park buttons beside it wear, so the three read as one row of controls, and the
 * fill is what says which of the two states this one is in. An earlier version
 * drew the unpinned pin a shade lighter and it read as a *disabled* control
 * rather than as a different state of the same one.
 *
 * It is two controls wearing one glyph. **Unpinned it is an action**, one of the
 * three the row reveals under the pointer, and it moves like the other two —
 * same target, same lift, same tinted ground, and an effect of its own in
 * `pin-button.css`. **Pinned it is a state**, drawn at rest, and it moves like
 * nothing at all: a pin that is holding a thread in place should not dance when
 * the pointer passes over it.
 *
 * The 20px target is padding around a 14px glyph, and the 3px on the side facing
 * the next control would be read as space: the cluster's own gap is 6px, so the
 * glyph would sit 9px from the age — and 12px from the snooze button that takes
 * the age's place under the pointer — while the controls around it sit 6px and
 * 8px apart. So the button hands its own inset back on that one side. Trimming
 * the other side would change nothing at all: the cluster is right aligned, and
 * the leading edge of its first child is not what separates anything.
 */
const PIN_MOTION = {
  button: cn(
    "nest-pin group/pin cursor-pointer",
    "focus-visible:text-foreground",
    "focus-visible:ring-2 focus-visible:ring-ring",
  ),
  ground: cn(
    // The tint and its halo are declared in `pin-button.css`, not as a
    // `bg-current/10` variant: Tailwind compiles that variant to a *solid*
    // `background-color: currentColor`, which would be a grey disc where the
    // park pair's grounds are a 15% wash. The lift is a utility because it is
    // the one part that has to sit behind `motion-safe:`.
    "nest-pin-ground",
    "motion-safe:group-hover/pin:-translate-y-0.5 motion-safe:group-focus-visible/pin:-translate-y-0.5",
    "motion-safe:group-active/pin:translate-y-0 motion-safe:group-active/pin:scale-90",
  ),
} as const;

export function PinButton({
  pinned,
  onToggle,
  className,
}: {
  pinned: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const label = pinned ? "Unpin thread" : "Pin thread";
  return (
    <button
      type="button"
      data-nest-pin={pinned ? "pinned" : "unpinned"}
      aria-label={label}
      // A toggle, not a one-way action: the button reports the state it holds.
      aria-pressed={pinned}
      onClick={(event) => {
        // The row's full-bleed anchor sits underneath, so both of these are
        // load-bearing: without them a pin also opens the thread.
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "relative z-10 -mr-[3px] flex size-5 shrink-0 items-center justify-center rounded-md",
        "transition-colors duration-150 ease-out motion-reduce:transition-none",
        "focus-visible:outline-none",
        pinned
          ? // A state, not an action: it never lifts, tints, presses or bites —
            // it answers the pointer with colour and nothing else.
            "hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          : cn("hover:text-foreground", PIN_MOTION.button),
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none relative flex size-full items-center justify-center rounded-[inherit]",
          // Move only the artwork, so hovering an edge cannot move the hit area.
          // The pinned pin has no ground to move at all.
          !pinned &&
            cn(
              "transition-[background-color,box-shadow,transform] duration-200 ease-out motion-reduce:transition-none",
              PIN_MOTION.ground,
            ),
        )}
      >
        <Icon
          name={pinned ? "PinFilled" : "Pin"}
          className={cn(
            "size-3.5",
            !pinned &&
              "nest-pin-seat transition-transform duration-200 ease-out motion-reduce:transition-none",
          )}
          aria-hidden
        />
        {pinned
          ? null
          : // The P's the pin leaves behind as it turns in: three of them, each
            // with its own delay and its own path — the construction the park
            // pair's effects use, and the shortest of the three. A letter, like
            // the snooze's `z`: that pair of marks says *which* act this is
            // without a legend, where a ring or a dot says only "something
            // happened here".
            [0, 1, 2].map((mark) => (
              <span key={mark} aria-hidden="true" className="nest-pin-mark">
                P
              </span>
            ))}
      </span>
      <ControlTooltip label={label} scope="pin" />
    </button>
  );
}

/**
 * One hover/focus label for the row's controls.
 *
 * Native `title` tooltips arrive on the platform's timer and cannot be styled,
 * so the pin, snooze and settle buttons use the same drawn bubble as the
 * provider glyph. Each control owns its group name, so a label never depends on
 * whichever ancestor happened to be hovered.
 */
export function ControlTooltip({
  label,
  scope,
}: {
  label: string;
  scope: "pin" | "snooze" | "settle";
}) {
  return (
    <span
      role="tooltip"
      className={cn(
        "pointer-events-none absolute bottom-full right-0 z-40 mb-1 w-max max-w-[min(12rem,calc(100cqw-1rem))] translate-y-0.5 rounded-md border border-border bg-popover px-2 py-1 text-2xs text-popover-foreground opacity-0 shadow-md transition-all duration-150 ease-out motion-reduce:transition-none",
        scope === "pin" &&
          "group-hover/pin:translate-y-0 group-hover/pin:opacity-100 group-focus/pin:translate-y-0 group-focus/pin:opacity-100",
        scope === "snooze" &&
          "group-hover/snooze:translate-y-0 group-hover/snooze:opacity-100 group-focus/snooze:translate-y-0 group-focus/snooze:opacity-100",
        scope === "settle" &&
          "group-hover/settle:translate-y-0 group-hover/settle:opacity-100 group-focus/settle:translate-y-0 group-focus/settle:opacity-100",
      )}
    >
      {label}
    </span>
  );
}
