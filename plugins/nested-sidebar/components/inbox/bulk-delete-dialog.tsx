import { useId } from "react";
import { Icon } from "@/components/ui/icon";
import { PlainDialog } from "@/components/ui/modal";

export interface BulkDeletePreviewView {
  token: string | null;
  included: readonly {
    id: string;
    title: string;
    childCount: number;
  }[];
  skipped: readonly {
    id: string;
    reason: string;
    message: string;
  }[];
  rootCount: number;
  childCount: number;
  totalThreadCount: number;
}

export function BulkDeleteDialog({
  open,
  preview,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  preview: BulkDeletePreviewView | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();

  const shownTitles = preview?.included.slice(0, 5) ?? [];
  const remainingTitles = Math.max(
    0,
    (preview?.included.length ?? 0) - shownTitles.length,
  );

  return (
    <PlainDialog
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      labelledBy={titleId}
      describedBy={descriptionId}
      className="w-[min(26rem,calc(100vw-2rem))]"
    >
      <div className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Icon name="Trash" className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-foreground">
              Delete selected threads permanently?
            </h2>
            <p
              id={descriptionId}
              className="mt-1 text-xs leading-relaxed text-muted-foreground"
            >
              This cannot be undone. Deleting a root also deletes every child
              agent in its thread tree.
            </p>
          </div>
        </div>

        {preview ? (
          <>
            <dl className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/30 p-2 text-center">
              <Count label="Roots" value={preview.rootCount} />
              <Count label="Child agents" value={preview.childCount} />
              <Count label="Total" value={preview.totalThreadCount} />
            </dl>
            <div>
              <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                Selected roots
              </p>
              <ul className="mt-1 space-y-1 text-xs text-foreground/90">
                {shownTitles.map((root) => (
                  <li key={root.id} className="truncate">
                    {root.title}
                  </li>
                ))}
                {remainingTitles > 0 ? (
                  <li className="text-muted-foreground">
                    and {remainingTitles} more
                  </li>
                ) : null}
              </ul>
            </div>
            {preview.skipped.length > 0 ? (
              <p className="rounded-md bg-primary/10 px-2 py-1.5 text-xs text-primary">
                {preview.skipped.length} selected {preview.skipped.length === 1 ? "family was" : "families were"} protected and will stay.
              </p>
            ) : null}
          </>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            disabled={busy}
            onClick={onCancel}
            className="h-8 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || preview?.token == null}
            onClick={onConfirm}
            className="flex h-8 items-center gap-1.5 rounded-md bg-destructive px-3 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            {busy ? (
              <Icon
                name="Loading"
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <Icon name="Trash" className="size-3.5" aria-hidden />
            )}
            Delete permanently
          </button>
        </div>
      </div>
    </PlainDialog>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 tabular-nums text-sm font-semibold text-foreground">
        {value}
      </dd>
    </div>
  );
}
