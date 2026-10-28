import { ThreadCard } from "@/components/inbox/thread-card";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import type { ThreadFamily } from "@/lib/inbox";
import {
  PINNED_DRAG_TYPE,
  encodeDraggedPinned,
} from "@/lib/pinned";
import {
  BULK_PROTECTION_LABELS,
  bulkEligibility,
} from "@/lib/thread-management";
import type { TreeRowHandlers } from "@/components/inbox/tree-row-types";

export function FamilyRow({
  family,
  projectId,
  handlers,
  pinned = false,
}: {
  family: ThreadFamily;
  projectId: string;
  handlers: TreeRowHandlers;
  pinned?: boolean;
}) {
  const eligibility = bulkEligibility(family, handlers.activeThreadId);
  const reorderEnabled = pinned
    ? handlers.pinnedReorderEnabled
    : handlers.reorderEnabled;
  return (
    <ThreadCard
      thread={family.root}
      childThreads={family.children}
      providerInfoById={handlers.providerInfoById}
      activeThreadId={handlers.activeThreadId}
      canPark={handlers.lifecycle.canPark(family.root)}
      forceExpanded={handlers.forceExpanded}
      onNavigate={handlers.onNavigate}
      onSettle={() => handlers.lifecycle.settle(family.root.id)}
      onSnooze={(until) => handlers.lifecycle.snooze(family.root.id, until)}
      now={handlers.now}
      selectionMode={handlers.selectionMode}
      selected={handlers.selectedRootIds.has(family.root.id)}
      selectionHintId={handlers.selectionHintId}
      selectionDisabledReason={
        eligibility.eligible
          ? null
          : BULK_PROTECTION_LABELS[eligibility.reason]
      }
      onToggleSelected={(intent) =>
        handlers.onToggleRoot(family.root.id, intent)
      }
      reorderEnabled={reorderEnabled}
      reorderDisabledReason={
        pinned
          ? handlers.pinnedReorderDisabledReason
          : handlers.reorderDisabledReason
      }
      onMoveByKeyboard={(direction) =>
        pinned
          ? handlers.onPinnedKeyboardMove(family.root.id, direction)
          : handlers.onKeyboardMove(projectId, family.root.id, direction)
      }
      onReorderDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        if (pinned) {
          event.dataTransfer.setData(
            PINNED_DRAG_TYPE,
            encodeDraggedPinned(family.root.id),
          );
          return;
        }
        event.dataTransfer.setData(
          "application/x-nest-family",
          JSON.stringify({ projectId, rootId: family.root.id }),
        );
      }}
      onReorderDragOver={
        pinned
          ? () => undefined
          : (event) => {
              if (!handlers.reorderEnabled) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
      }
      onReorderDrop={
        pinned
          ? () => undefined
          : (event) => {
              event.preventDefault();
              const dragged = parseDraggedFamily(
                event.dataTransfer.getData("application/x-nest-family"),
              );
              if (dragged === null) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              handlers.onReorder({
                sourceProjectId: dragged.projectId,
                sourceRootId: dragged.rootId,
                targetProjectId: projectId,
                targetRootId: family.root.id,
                position:
                  event.clientY < bounds.top + bounds.height / 2
                    ? "before"
                    : "after",
              });
            }
      }
      preferences={handlers.preferences}
    />
  );
}

export function FlatFamilies({
  families,
  projectId,
  handlers,
}: {
  families: readonly ThreadFamily[];
  projectId: string;
  handlers: TreeRowHandlers;
}) {
  const attachListAutoAnimateRef = useListAutoAnimate<HTMLUListElement>();
  return (
    <ul ref={attachListAutoAnimateRef} className="flex flex-col gap-px">
      {families.map((family) => (
        <FamilyRow
          key={family.root.id}
          family={family}
          projectId={projectId}
          handlers={handlers}
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
