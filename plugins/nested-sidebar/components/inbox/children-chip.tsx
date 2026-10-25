import {
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { cn } from "@/lib/utils";
import { Disc, DiscCluster } from "@/components/inbox/disc";
import { familyStatusColor } from "@/components/inbox/family-status";
import { StatusGlyph } from "@/components/inbox/status-glyph";
import { Menu, MenuLabel, MenuRow } from "@/components/ui/menu";
import { childrenOf, threadDisplayTitle } from "@/lib/inbox";
import { familyStatusPresentation } from "@/lib/family-status";

const MAX_DISCS = 3;

/**
 * This thread's children, in the thread header.
 *
 * The sidebar shows a thread's children — and its children's children — while
 * the family is on screen and expanded. It cannot show them when the user is
 * reading the thread itself and the list is somewhere else: another group tab,
 * a filter that excludes this family, a collapsed project, or a sidebar that is
 * simply not where the eyes are. This chip is that surface. It names the number,
 * and it is the route into a child from inside its parent.
 *
 * A chip was written for this slot early on and never registered — only the
 * parent's chip was, so the file was dead weight and the plugin that forked this
 * one dropped it. It is back as a wired component, under a name that says what
 * it draws: bb's *subagents* are activity counters on a thread, and the thing
 * this chip lists is child *threads*, which is what its own label always said.
 *
 * Its panel is the sidebar's one menu (`Menu` + `MenuRow`) rather than a second
 * one drawn here: a chip that rolled its own rows and its own panel is what the
 * row menus were rebuilt to stop doing.
 */
export function ChildrenChip({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const { threads } = useSidebarThreads();
  const actions = useThreadActions();

  const children = childrenOf(threads, threadId);
  if (children.length === 0) return null;

  const waiting = children.filter((child) => child.hasPendingInteraction).length;
  const needsYou = waiting > 0;
  // The same words and the same colour the sidebar uses for a hand raised:
  // this is a state, so it comes from the palette rather than from a hue.
  const status = familyStatusPresentation("needs-you");
  const label = needsYou ? status.label : `${children.length} children`;

  return (
    <Menu
      label={`${children.length} child threads`}
      trigger={
        <button
          type="button"
          aria-label={
            needsYou
              ? `${children.length} child threads, ${waiting} waiting for you`
              : `${children.length} child threads`
          }
          title={label}
          className={cn(
            "flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border text-2xs text-muted-foreground",
            "hover:bg-accent hover:text-foreground",
            isCompactViewport ? "px-1.5" : "px-2",
          )}
        >
          <DiscCluster threads={children} max={MAX_DISCS} />
          {isCompactViewport ? null : (
            <span
              className="truncate"
              // On the label alone, so the chip's own hover still reads.
              style={needsYou ? { color: familyStatusColor(status) } : undefined}
            >
              {label}
            </span>
          )}
        </button>
      }
    >
      <MenuLabel>Children</MenuLabel>
      {children.map((child) => (
        <MenuRow key={child.id} onSelect={() => actions.open(child.id)}>
          <Disc thread={child} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{threadDisplayTitle(child)}</span>
            <span className="truncate text-2xs text-muted-foreground">
              {child.originKind ?? "thread"}
            </span>
          </span>
          <StatusGlyph
            indicator={child.indicator}
            label={child.indicatorLabel}
            className="mt-0.5"
          />
        </MenuRow>
      ))}
    </Menu>
  );
}
