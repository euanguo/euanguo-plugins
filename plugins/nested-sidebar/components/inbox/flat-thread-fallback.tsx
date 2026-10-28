import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import {
  sortByCreatedAtDescending,
  threadDisplayTitle,
} from "@/lib/inbox";

export function FlatThreadFallback({
  threads,
  onOpen,
}: {
  threads: readonly PluginSidebarThread[];
  onOpen: (id: string) => void;
}) {
  const rows = sortByCreatedAtDescending(
    threads.filter((thread) => !thread.isArchived && !thread.isHidden),
  );
  return (
    <ul className="flex flex-col gap-px p-1.5" aria-label="Threads">
      {rows.map((thread) => (
        <li key={thread.id}>
          <button
            type="button"
            onClick={() => onOpen(thread.id)}
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-foreground/90 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1 truncate">
              {threadDisplayTitle(thread)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
