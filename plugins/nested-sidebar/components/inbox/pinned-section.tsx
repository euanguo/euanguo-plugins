/**
 * Pinned roots from every project, above the tree.
 *
 * The section exists because "pinned" and "first inside its project" are
 * different promises. A pin says *keep this where I can see it*, and a row that
 * lives inside a collapsed project — or behind a group tab that excludes that
 * project — is exactly the row a pin was supposed to keep in view.
 *
 * Every row here is the same row the tree draws: `FamilyRow`, so a pinned thread
 * keeps its status, its children, its menu, its split gesture, and its rename.
 * The only difference is where a reorder is written: this section's drops land
 * in bb's own pin order, and the tree's land in the project's family order.
 *
 * The header carries the count because that is the one thing a folded section
 * has to answer — the rows below are pinned, and how many there are.
 */

import {
  PINNED_DRAG_TYPE,
  parseDraggedPinned,
  type PinnedFamily,
} from "@/lib/pinned";
import { FamilyRow, type TreeRowHandlers } from "@/components/inbox/tree-rows";

export function PinnedSection({
  pinned,
  handlers,
  reorderEnabled,
  reorderDisabledReason,
  onReorder,
}: {
  pinned: readonly PinnedFamily[];
  handlers: TreeRowHandlers;
  reorderEnabled: boolean;
  reorderDisabledReason: string | null;
  onReorder: (input: {
    sourceId: string;
    targetId: string;
    position: "before" | "after";
  }) => void;
}) {
  if (pinned.length === 0) return null;
  return (
    <section
      aria-label="Pinned threads"
      data-nest-pinned-section=""
      className="mb-1"
    >
      <h2 className="flex items-center gap-2 px-1.5 pb-1 pt-1.5">
        <span className="text-2xs font-medium text-muted-foreground/70">
          Pinned
        </span>
        <span className="h-px flex-1 bg-sidebar-border" />
        <span className="text-2xs tabular-nums text-muted-foreground/70">
          {pinned.length}
        </span>
      </h2>
      {/*
        The drop target is the list, and the row under the pointer is found from
        the pointer itself. `FamilyRow` renders a thread card whose `<li>` already
        carries `data-nest-family`, so the section can address a row without the
        card having to know this section exists.
      */}
      <ul
        className="flex flex-col gap-px"
        onDragOver={(event) => {
          if (!reorderEnabled) return;
          if (!event.dataTransfer.types.includes(PINNED_DRAG_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          if (!reorderEnabled) return;
          const dragged = parseDraggedPinned(
            event.dataTransfer.getData(PINNED_DRAG_TYPE),
          );
          if (dragged === null) return;
          const target = pinnedRowId(event.target);
          if (target === null) return;
          event.preventDefault();
          const bounds = target.bounds;
          onReorder({
            sourceId: dragged.rootId,
            targetId: target.rootId,
            position:
              event.clientY >= bounds.top + bounds.height / 2
                ? "after"
                : "before",
          });
        }}
      >
        {pinned.map((entry) => (
          <FamilyRow
            key={entry.family.root.id}
            family={entry.family}
            projectId={entry.projectId}
            handlers={handlers}
            pinned
          />
        ))}
      </ul>
      {reorderEnabled || reorderDisabledReason === null ? null : (
        <p className="px-1.5 pt-1 text-2xs text-muted-foreground/70">
          {reorderDisabledReason}
        </p>
      )}
      {/*
        A pinned row names its project, because the section is cross-project and
        the tree's own header is not there to say which project a row came from.
      */}
      <span className="sr-only">
        {pinned.map((entry) => entry.projectName).join(", ")}
      </span>
    </section>
  );
}

/**
 * The pinned row under a drop, and where its midpoint is.
 *
 * Read from the DOM rather than from React state on purpose: the drop lands on
 * whatever the pointer is over, which is a row, not an index — and the row
 * carries its own id already, so nothing here has to know the list's order.
 */
function pinnedRowId(
  target: EventTarget | null,
): { rootId: string; bounds: DOMRect } | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest("[data-nest-family]");
  if (row === null) return null;
  const rootId = row.getAttribute("data-nest-family");
  if (rootId === null || rootId.length === 0) return null;
  return { rootId, bounds: row.getBoundingClientRect() };
}
