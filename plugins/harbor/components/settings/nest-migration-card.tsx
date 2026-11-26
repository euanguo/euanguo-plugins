import { useState } from "react";
import { Button } from "@bb-ui/button";
import { Icon } from "@bb-ui/icon";
import { NestMigrationModal } from "@/components/inbox/nest-migration-modal";
import { useNestMigration } from "@/hooks/use-nest-migration";

function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Permanent Nest migration entry point inside Harbor Settings → Sidebar & Layout,
 * remaining accessible even after the sidebar tip is dismissed.
 */
export function NestMigrationCard() {
  const migration = useNestMigration();
  const { preview, loading } = migration;
  const [modalOpen, setModalOpen] = useState(false);

  const summaryText = loading && preview === null
    ? "Checking for sibling Nest sidebar database..."
    : preview === null || !preview.sourceFound
      ? "No legacy Nest database found alongside Harbor on this machine."
      : preview.hasPendingData
        ? `Ready to import: ${plural(preview.pending.groups, "group")}, ${plural(preview.pending.memberships, "assignment")}, ${plural(preview.pending.features, "feature")}, ${plural(preview.pending.badgeColors, "color")}, and ${plural(preview.pending.lifecycle, "shelf thread")}.`
        : "All detected Nest groups, features, badge colors, and shelf records are already synced into Harbor.";

  return (
    <section
      data-harbor-nest-migration-settings=""
      className="space-y-3"
    >
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Nest Data Migration
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Preview and selectively import project groups, in-place features, badge colors, and settled threads from Nest.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <Icon
            name="FolderSync"
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <p className="min-w-0 text-xs text-muted-foreground">{summaryText}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={preview?.hasPendingData ? "default" : "outline"}
          disabled={loading || preview === null || !preview.sourceFound}
          onClick={() => setModalOpen(true)}
          className="h-7 shrink-0 text-xs"
        >
          {preview?.hasPendingData ? "Preview & migrate..." : "View details..."}
        </Button>
      </div>

      <NestMigrationModal
        open={modalOpen}
        migration={migration}
        onClose={() => setModalOpen(false)}
      />
    </section>
  );
}
