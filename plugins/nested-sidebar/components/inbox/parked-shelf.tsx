import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import { Icon } from "@/components/ui/icon";
import { PageControls } from "@/components/inbox/page-controls";
import { SlimRow } from "@/components/inbox/slim-row";
import { TRAILING_GLYPH_BOX_CLASS } from "@/components/inbox/status-slot";
import type { useLifecycle } from "@/hooks/use-lifecycle";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import {
  hasMoreRows,
  nextPageSize,
  visibleRows,
} from "@/lib/paging";
import { cn } from "@/lib/utils";

export function ParkedShelf({
  label,
  threads,
  pendingCount = 0,
  expanded,
  onToggle,
  shelf,
  activeThreadId,
  lifecycle,
  onNavigate,
  now,
  settledLimit,
  settledPageSize,
  searching,
  onLoadMore,
  onShowLess,
  page,
}: {
  label: string;
  threads: readonly PluginSidebarThread[];
  pendingCount?: number;
  expanded: boolean;
  onToggle: () => void;
  shelf: "snoozed" | "settled";
  activeThreadId: string | null;
  lifecycle: ReturnType<typeof useLifecycle>;
  onNavigate: () => void;
  now: number;
  settledLimit?: number;
  settledPageSize?: number;
  searching?: boolean;
  page?: number;
  onLoadMore?: () => void;
  onShowLess?: () => void;
}) {
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLUListElement>();
  const count = threads.length + pendingCount;
  const pages = page ?? 1;
  const paged = shelf === "settled" && !searching;
  const limit = paged ? (settledLimit ?? threads.length) : threads.length;
  const visible = visibleRows(
    threads,
    limit,
    activeThreadId,
    (thread) => thread.id,
  );
  const hasMore = hasMoreRows(threads.length, limit);
  const nextPageCount = nextPageSize(
    threads.length,
    limit,
    settledPageSize ?? limit,
  );
  if (count === 0) return null;

  return (
    <section aria-label={label}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="mt-3 flex w-full cursor-pointer items-center gap-2 px-2.5 pb-1 text-left"
      >
        <span className="text-2xs font-medium text-muted-foreground/70">
          {expanded ? label : `${label} (${count})`}
        </span>
        <span className="h-px flex-1 bg-sidebar-border" />
        <span className={TRAILING_GLYPH_BOX_CLASS}>
          <Icon
            name="ChevronDown"
            className={cn(
              "size-3 text-muted-foreground/70 transition-transform duration-150 ease-out motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>
      <ul ref={attachListAutoAnimateRef} className="flex flex-col gap-px">
        {expanded
          ? visible.map((thread) => (
              <SlimRow
                key={thread.id}
                thread={thread}
                isActive={thread.id === activeThreadId}
                shelf={shelf}
                wakeAt={lifecycle.wakeAtFor(thread)}
                now={now}
                onNavigate={onNavigate}
                onRestore={() =>
                  shelf === "snoozed"
                    ? lifecycle.unsnooze(thread.id)
                    : lifecycle.unsettle(thread.id)
                }
              />
            ))
          : null}
      </ul>
      {expanded && paged && onLoadMore && onShowLess && (hasMore || pages > 1) ? (
        <PageControls
          hasMore={hasMore}
          remaining={nextPageCount}
          page={pages}
          onLoadMore={onLoadMore}
          onShowLess={onShowLess}
          className="ml-2.5"
        />
      ) : null}
    </section>
  );
}
