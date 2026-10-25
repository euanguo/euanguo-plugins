/**
 * A project's newest archived threads, under its list.
 *
 * The archive is where finished work goes, and bb's own sidebar view cannot show
 * it — that view is built from queries pinned to `archived: false`, the same fact
 * the settled shelf exists for. Recovering a thread you archived a week ago
 * therefore meant a search, even when you knew which project it was in.
 *
 * Four things about the surface, each for a reason:
 *
 * - **Dimmed, and shorter than a card.** These are not live work. A row that
 *   looked like a thread row would invite the same skimming, and skimming is the
 *   one thing an archive is not for.
 * - **The age is the timestamp that matters.** `updatedAt`, not the archive time:
 *   "when did I last work on this" is the question being asked.
 * - **Clicking reads it without unarchiving it.** bb's own archived view works
 *   that way, and a shelf where every look changes the archive would make the
 *   user think twice about looking.
 * - **Unarchive is a button, not a menu item.** It is the only action here, and
 *   the reason the shelf was opened.
 */

import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { threadDisplayTitle } from "@/lib/inbox";
import { relativeTimeLabel } from "@/lib/relative-time";

export function ArchivedShelf({
  threads,
  now,
  onOpen,
  onUnarchive,
}: {
  threads: readonly PluginSidebarThread[];
  now: number;
  onOpen: (threadId: string) => void;
  onUnarchive: (threadId: string) => void;
}) {
  // An empty shelf is not drawn at all: the project menu's toggle already says
  // the shelf is on, and a header over nothing would read as a failure.
  if (threads.length === 0) return null;
  return (
    <ul
      aria-label="Archived threads"
      className="mt-0.5 flex flex-col gap-px"
    >
      {threads.map((thread) => {
        const title = threadDisplayTitle(thread);
        return (
          <li
            key={thread.id}
            className="group/archived relative flex h-7 items-center gap-2 rounded-md px-1.5 text-2xs"
          >
            {/* The same structure as every other row: a full-bleed anchor under
                the controls, because a `<button>` inside an `<a>` is invalid
                interactive nesting. */}
            <a
              data-sidebar-thread-shortcut-target=""
              data-sidebar-thread-id={thread.id}
              href="#"
              aria-label={`${title} — archived`}
              onClick={(event) => {
                event.preventDefault();
                onOpen(thread.id);
              }}
              className="absolute inset-0 cursor-pointer rounded-md"
            />
            <span
              className={cn(
                "pointer-events-none relative min-w-0 flex-1 truncate",
                // Dimmed rather than muted: the title still has to be readable
                // enough to recognise the thread being looked for.
                "text-muted-foreground",
              )}
            >
              {title}
            </span>
            <span className="pointer-events-none relative shrink-0 tabular-nums text-muted-foreground/50">
              {relativeTimeLabel(thread.updatedAt, now)}
            </span>
            <button
              type="button"
              aria-label={`Unarchive ${title}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onUnarchive(thread.id);
              }}
              className={cn(
                "relative z-10 shrink-0 rounded px-1 py-0.5 opacity-0",
                "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                "group-hover/archived:opacity-100",
              )}
            >
              <Icon name="ArchiveRestore" className="size-3" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}