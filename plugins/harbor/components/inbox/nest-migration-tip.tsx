import { Icon } from "@bb-ui/icon";
import type { NestMigrationPreview } from "@/lib/schemas/settings";
import { cn } from "@/lib/ui/utils";

function summarizePending(preview: NestMigrationPreview): string {
  const { pending } = preview;
  const parts: string[] = [];
  if (pending.groups > 0) {
    parts.push(`${pending.groups} ${pending.groups === 1 ? "group" : "groups"}`);
  }
  if (pending.features > 0) {
    parts.push(
      `${pending.features} ${pending.features === 1 ? "feature" : "features"}`,
    );
  }
  if (pending.memberships > 0 && pending.groups === 0) {
    parts.push(
      `${pending.memberships} ${pending.memberships === 1 ? "assignment" : "assignments"}`,
    );
  }
  if (pending.lifecycle > 0) {
    parts.push(
      `${pending.lifecycle} ${pending.lifecycle === 1 ? "thread" : "threads"}`,
    );
  }
  return parts.length > 0
    ? `${parts.join(" · ")} — click to preview`
    : "Click to preview Nest data";
}

/**
 * Floating bottom sidebar tip inviting the user to preview & import legacy
 * Nest groups, features, colors, and thread shelves on demand.
 */
export function NestMigrationTip({
  preview,
  busy = false,
  onOpen,
  onDismiss,
}: {
  preview: NestMigrationPreview | null;
  busy?: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  if (preview === null || !preview.showTip) return null;

  return (
    <div
      data-harbor-nest-migration-tip=""
      className={cn(
        "mx-2 mb-2 mt-1 flex shrink-0 items-center gap-1.5 rounded-xl border border-border/80 bg-popover/95 px-2.5 py-2 shadow-md backdrop-blur-md",
        "transition-colors duration-150 ease-out hover:border-border hover:bg-popover motion-reduce:transition-none",
      )}
    >
      <button
        type="button"
        disabled={busy}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon name="FolderSync" className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">
            Migrate from Nest
          </span>
          <span className="block truncate text-2xs text-muted-foreground">
            {summarizePending(preview)}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label="Dismiss Nest migration tip"
        title="Dismiss tip (still available in Settings)"
        disabled={busy}
        data-bb-icon-button=""
        onClick={onDismiss}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
      >
        <Icon name="X" className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
