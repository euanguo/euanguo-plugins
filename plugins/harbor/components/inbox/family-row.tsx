import { useCallback, type DragEvent } from "react";

import { ThreadCard } from "@/components/inbox/thread-card";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import type { ThreadFamily } from "@/lib/domain/inbox";
import {
  PINNED_DRAG_TYPE,
  encodeDraggedPinned,
} from "@/lib/domain/pinned";
import {
  BULK_PROTECTION_LABELS,
  bulkEligibility,
} from "@/lib/domain/thread-management";
import type { RootSelectionIntent } from "@/lib/domain/thread-management";
import { useTreeRowHandlers } from "@/components/inbox/tree-row-handlers-context";

const NOOP = () => undefined;

export function FamilyRow({
  family,
  projectId,
  pinned = false,
}: {
  family: ThreadFamily;
  projectId: string;
  pinned?: boolean;
}) {
  const handlers = useTreeRowHandlers();
  const eligibility = bulkEligibility(family, handlers.activeThreadId);
  const reorderEnabled = pinned
    ? handlers.pinnedReorderEnabled
    : handlers.reorderEnabled;
  const onSettle = useCallback(
    () => handlers.lifecycle.settle(family.root.id),
    [family, handlers],
  );
  const onSnooze = useCallback(
    (until: number) => handlers.lifecycle.snooze(family.root.id, until),
    [family, handlers],
  );
  const onToggleSelected = useCallback(
    (intent: RootSelectionIntent) =>
      handlers.onToggleRoot(family.root.id, intent),
    [family, handlers],
  );
  const onMoveByKeyboard = useCallback(
    (direction: -1 | 1) =>
      pinned
        ? handlers.onPinnedKeyboardMove(family.root.id, direction)
        : handlers.onKeyboardMove(projectId, family.root.id, direction),
    [family, handlers, pinned, projectId],
  );
  const onReorderDragStart = useCallback((event: DragEvent<HTMLSpanElement>) => {
    event.dataTransfer.effectAllowed = "move";
    if (pinned) {
      event.dataTransfer.setData(
        PINNED_DRAG_TYPE,
        encodeDraggedPinned(family.root.id),
      );
      return;
    }
    event.dataTransfer.setData(
      "application/x-harbor-family",
      JSON.stringify({ projectId, rootId: family.root.id }),
    );
  }, [family, pinned, projectId]);
  const onReorderDragOver = useCallback((event: DragEvent<HTMLLIElement>) => {
    if (!handlers.reorderEnabled) return;
    if (!event.dataTransfer.types.includes("application/x-harbor-family")) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, [handlers]);
  const onReorderDrop = useCallback((event: DragEvent<HTMLLIElement>) => {
    if (pinned) return;
    event.preventDefault();
    event.stopPropagation();
    const dragged = parseDraggedFamily(
      event.dataTransfer.getData("application/x-harbor-family"),
    );
    if (dragged === null) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    handlers.onReorder({
      sourceProjectId: dragged.projectId,
      sourceRootId: dragged.rootId,
      targetProjectId: projectId,
      targetRootId: family.root.id,
      position:
        event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
    });
  }, [family, handlers, pinned, projectId]);
  return (
    <ThreadCard
      thread={family.root}
      childThreads={family.children}
      providerInfoById={handlers.providerInfoById}
      activeThreadId={handlers.activeThreadId}
      canPark={handlers.lifecycle.canPark(family.root)}
      forceExpanded={handlers.forceExpanded}
      onNavigate={handlers.onNavigate}
      onSettle={onSettle}
      onSnooze={onSnooze}
      now={handlers.now}
      selectionMode={handlers.selectionMode}
      selected={handlers.selectedRootIds.has(family.root.id)}
      selectionHintId={handlers.selectionHintId}
      selectionDisabledReason={
        eligibility.eligible
          ? null
          : BULK_PROTECTION_LABELS[eligibility.reason]
      }
      onToggleSelected={onToggleSelected}
      reorderEnabled={reorderEnabled}
      reorderDisabledReason={
        pinned
          ? handlers.pinnedReorderDisabledReason
          : handlers.reorderDisabledReason
      }
      onMoveByKeyboard={onMoveByKeyboard}
      onReorderDragStart={onReorderDragStart}
      onReorderDragOver={pinned ? NOOP : onReorderDragOver}
      onReorderDrop={pinned ? NOOP : onReorderDrop}
      preferences={handlers.preferences}
      pullRequest={
        family.root.environment?.id === undefined ||
        family.root.environment?.id === null
          ? null
          : (handlers.pullRequests.get(family.root.environment.id) ?? null)
      }
    />
  );
}

export function FlatFamilies({
  families,
  projectId,
}: {
  families: readonly ThreadFamily[];
  projectId: string;
}) {
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLUListElement>();
  return (
    <ul ref={attachListAutoAnimateRef} className="flex flex-col gap-px">
      {families.map((family) => (
        <FamilyRow
          key={family.root.id}
          family={family}
          projectId={projectId}
        />
      ))}
    </ul>
  );
}

export function parseDraggedFamily(
  raw: string,
): { projectId: string; rootId: string } | null {
  if (raw.length === 0 || raw.length > 1_000) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("projectId" in parsed) ||
      !("rootId" in parsed) ||
      typeof parsed.projectId !== "string" ||
      typeof parsed.rootId !== "string"
    ) {
      return null;
    }
    return { projectId: parsed.projectId, rootId: parsed.rootId };
  } catch {
    return null;
  }
}
