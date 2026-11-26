import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { CompactThreadRow } from "@/components/inbox/compact-thread-row";

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
  if (threads.length === 0) return null;
  return (
    <ul aria-label="Archived threads" className="mt-0.5 flex flex-col gap-px">
      {threads.map((thread) => (
        <CompactThreadRow
          key={thread.id}
          variant="archived"
          thread={thread}
          now={now}
          onNavigate={() => onOpen(thread.id)}
          onRestore={() => onUnarchive(thread.id)}
        />
      ))}
    </ul>
  );
}
