import {
  experimental_useSidebarThreads as useSidebarThreads,
  type ExperimentalThreadContextSegmentProps,
} from "@get-bb/plugin-sdk/app";

import { ChildrenChip } from "@/components/inbox/children-chip";
import { ParentChip } from "@/components/inbox/parent-chip";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { childrenOf, parentOf } from "@/lib/inbox";

/**
 * The family chips, in the row above the composer.
 *
 * They used to be header actions, a slot the SDK retired. bb's own parent
 * thread segment lives in this row now, so the way back to a parent and the
 * way into a child sit where bb puts the same kind of fact. One registration
 * draws both, because a thread can have a parent and children at once.
 */
export function useFamilySegmentVisible({
  threadId,
}: {
  threadId: string;
}): boolean {
  const { threads } = useSidebarThreads();
  return (
    parentOf(threads, threadId) !== null ||
    childrenOf(threads, threadId).length > 0
  );
}

export function FamilySegment({
  threadId,
}: ExperimentalThreadContextSegmentProps) {
  const isCompactViewport = useIsCompactViewport();
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <ParentChip
        threadId={threadId}
        isCompactViewport={isCompactViewport}
      />
      <ChildrenChip
        threadId={threadId}
        isCompactViewport={isCompactViewport}
      />
    </span>
  );
}
