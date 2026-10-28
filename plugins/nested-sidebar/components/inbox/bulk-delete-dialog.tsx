import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { DialogActions } from "@/components/ui/control";
import { Button } from "@/components/ui/button";
import type { BulkDeletePreview } from "@/lib/bulk-delete";

/**
 * The confirmation for deleting whole thread families.
 *
 * It used to draw its own header — a hand-written `h2` beside a circular
 * destructive glyph — because it is a confirmation and the shared `Modal`
 * looked like a form. That made this dialog the odd one out in three ways at
 * once: no title bar, a different icon shape, and its actions at the bottom of
 * the body instead of in the footer. `Modal` now carries a `tone`, so a
 * destructive confirmation is the same shell as every other dialog and still
 * reads as destructive.
 */
export function BulkDeleteDialog({
  open,
  preview,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  preview: BulkDeletePreview | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const shownTitles = preview?.included.slice(0, 5) ?? [];
  const remainingTitles = Math.max(
    0,
    (preview?.included.length ?? 0) - shownTitles.length,
  );

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      title="Delete selected threads permanently?"
      subtitle="This cannot be undone."
      icon="Trash2"
      tone="destructive"
      busy={busy}
      width="26rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm" autoFocus disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm"
            variant="destructive"
            disabled={busy || preview?.token == null}
            onClick={onConfirm}
          >
            {busy ? (
              <Icon
                name="Loading"
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <Icon name="Trash2" className="size-3.5" aria-hidden />
            )}
            Delete permanently
          </Button>
        </DialogActions>
      }
    >
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Deleting a root also deletes every child agent in its thread tree.
        </p>

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
                {preview.skipped.length} selected{" "}
                {preview.skipped.length === 1 ? "family was" : "families were"}{" "}
                protected and will stay.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
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
