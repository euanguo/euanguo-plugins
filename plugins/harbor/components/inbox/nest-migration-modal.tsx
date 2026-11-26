import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@bb-ui/button";
import { Checkbox } from "@bb-ui/checkbox";
import { Icon } from "@bb-ui/icon";
import { GroupIcon } from "@/components/ui/group-icon";
import { Modal } from "@/components/ui/modal";
import type { NestMigrationApi } from "@/hooks/use-nest-migration";
import type { NestMigrationCounts } from "@/lib/schemas/settings";
import { cn } from "@/lib/ui/utils";

function pendingGroupsCount(counts: NestMigrationCounts): number {
  return counts.groups + counts.memberships + counts.manualOrders;
}

function pendingFeaturesCount(counts: NestMigrationCounts): number {
  return (
    counts.features +
    counts.featureBranches +
    counts.featureAdoptions +
    counts.featureBriefs +
    counts.featureDecisions +
    counts.featureRefs
  );
}

function pendingExtrasCount(counts: NestMigrationCounts): number {
  return counts.badgeColors + counts.lifecycle;
}

function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function formatImportSummary(imported: NestMigrationCounts): string {
  const parts: string[] = [];
  if (imported.groups > 0) parts.push(plural(imported.groups, "group"));
  if (imported.memberships > 0) parts.push(plural(imported.memberships, "assignment"));
  if (imported.manualOrders > 0) parts.push(plural(imported.manualOrders, "order"));
  if (imported.features > 0) parts.push(plural(imported.features, "feature"));
  if (imported.badgeColors > 0) parts.push(plural(imported.badgeColors, "color"));
  if (imported.lifecycle > 0) parts.push(plural(imported.lifecycle, "shelf item"));
  return parts.length > 0 ? `Imported ${parts.join(", ")}.` : "Migration finished.";
}

/**
 * Interactive dry-run preview & one-click migration dialog for importing
 * groups, in-place features, badge colors, and thread shelves from Nest.
 */
export function NestMigrationModal({
  open,
  migration,
  onClose,
}: {
  open: boolean;
  migration: NestMigrationApi;
  onClose: () => void;
}) {
  const { preview, loading, busy, error, apply } = migration;
  const baseId = useId();
  const groupsCheckboxId = `${baseId}-groups`;
  const featuresCheckboxId = `${baseId}-features`;
  const extrasCheckboxId = `${baseId}-extras`;
  const [includeGroups, setIncludeGroups] = useState(true);
  const [includeFeatures, setIncludeFeatures] = useState(true);
  const [includeExtras, setIncludeExtras] = useState(true);

  const groupsPending = preview ? pendingGroupsCount(preview.pending) : 0;
  const featuresPending = preview ? pendingFeaturesCount(preview.pending) : 0;
  const extrasPending = preview ? pendingExtrasCount(preview.pending) : 0;
  const groupsDisabled = busy || groupsPending === 0;
  const featuresDisabled = busy || featuresPending === 0;
  const extrasDisabled = busy || extrasPending === 0;
  const disabledCheckboxClass =
    "disabled:border-muted-foreground/50 disabled:bg-muted/40 disabled:opacity-70";

  useEffect(() => {
    if (!open || preview === null) return;
    setIncludeGroups(pendingGroupsCount(preview.pending) > 0);
    setIncludeFeatures(pendingFeaturesCount(preview.pending) > 0);
    setIncludeExtras(pendingExtrasCount(preview.pending) > 0);
  }, [open, preview]);

  const selectedHasPending =
    (includeGroups && groupsPending > 0) ||
    (includeFeatures && featuresPending > 0) ||
    (includeExtras && extrasPending > 0);

  const handleApply = async () => {
    try {
      const result = await apply({
        includeGroups,
        includeFeatures,
        includeExtras,
      });
      if (result.status === "migrated") {
        toast.success(formatImportSummary(result.imported));
        if (!result.preview.hasPendingData) {
          onClose();
        }
      } else if (result.status === "nothing-to-migrate") {
        toast.message("Everything selected is already in Harbor.");
      }
    } catch {
      // Inline error state in useNestMigration handles presentation cleanly.
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Migrate from Nest"
      subtitle="Preview & import groups, features (in-place), colors, and thread shelves"
      icon="FolderSync"
      width="33rem"
      busy={busy}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onClose}
            className="h-7 text-xs"
          >
            {preview?.hasPendingData ? "Cancel" : "Close"}
          </Button>
          {preview?.sourceFound && preview.hasPendingData ? (
            <Button
              type="button"
              size="sm"
              disabled={busy || !selectedHasPending}
              onClick={() => void handleApply()}
              className="h-7 text-xs"
            >
              {busy ? "Migrating..." : "Migrate selected"}
            </Button>
          ) : null}
        </div>
      }
    >
      <div data-harbor-nest-migration-modal="" className="space-y-3 text-xs">
        {loading && preview === null ? (
          <div className="py-6 text-center text-muted-foreground">
            Scanning Nest database...
          </div>
        ) : preview === null || !preview.sourceFound ? (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-muted-foreground">
            No local Nest database was detected alongside Harbor. Nothing to import.
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              <Icon name="Info" className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                Non-destructive import: existing Harbor records stay untouched. Nest Features stay in
                their original folders with zero file copying.
              </span>
            </div>

            {!preview.hasPendingData ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-xs text-foreground">
                <Icon name="Check" className="harbor-text-success size-4 shrink-0" aria-hidden />
                <span>All detected Nest groups, features, and preferences are already in Harbor.</span>
              </div>
            ) : null}

            {/* Section 1: Project groups & manual order */}
            <section className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor={groupsCheckboxId}
                  className={cn(
                    "flex items-center gap-2 font-medium",
                    groupsDisabled ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer text-foreground",
                  )}
                >
                  <Checkbox
                    id={groupsCheckboxId}
                    checked={includeGroups && groupsPending > 0}
                    disabled={groupsDisabled}
                    onCheckedChange={(checked) => setIncludeGroups(checked === true)}
                    className={disabledCheckboxClass}
                  />
                  <span>Groups & sorting order</span>
                </label>
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                    groupsPending > 0
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {groupsPending > 0
                    ? preview.pending.groups === 0 && preview.pending.memberships === 0
                      ? plural(preview.pending.manualOrders, "order")
                      : `${plural(preview.pending.groups, "group")} · ${plural(preview.pending.memberships, "project")}`
                    : "Already synced"}
                </span>
              </div>

              {preview.groups.length === 0 ? (
                <p className="mt-2 pl-6 text-[11px] text-muted-foreground">
                  No project groups found in Nest.
                </p>
              ) : (
                <div className="mt-2.5 space-y-1.5 pl-6">
                  {preview.groups.map((group) => (
                    <div
                      key={group.id}
                      className="flex items-center gap-2 rounded-md border border-border/40 bg-background/50 px-2.5 py-1.5"
                    >
                      <GroupIcon name={group.icon} className="size-3.5" ariaHidden />
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                        {group.name}
                      </span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {plural(group.memberCount, "project")}
                      </span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] leading-none",
                          group.willImport
                            ? "harbor-badge-success"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {group.alreadyExists ? "Existing" : "Import"}
                      </span>
                    </div>
                  ))}
                  {preview.pending.manualOrders > 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      + {plural(preview.pending.manualOrders, "custom manual ordering scope")}
                    </p>
                  ) : null}
                </div>
              )}
            </section>

            {/* Section 2: Features (in-place zero-copy) */}
            <section className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor={featuresCheckboxId}
                  className={cn(
                    "flex items-center gap-2 font-medium",
                    featuresDisabled ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer text-foreground",
                  )}
                >
                  <Checkbox
                    id={featuresCheckboxId}
                    checked={includeFeatures && featuresPending > 0}
                    disabled={featuresDisabled}
                    onCheckedChange={(checked) => setIncludeFeatures(checked === true)}
                    className={disabledCheckboxClass}
                  />
                  <span>Features (in-place folders)</span>
                </label>
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                    featuresPending > 0
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {featuresPending > 0
                    ? preview.pending.features === 0 && preview.pending.featureDecisions === 0
                      ? plural(featuresPending, "item")
                      : `${plural(preview.pending.features, "feature")} · ${plural(preview.pending.featureDecisions, "decision")}`
                    : preview.features.length > 0
                      ? "Already synced"
                      : "None in Nest"}
                </span>
              </div>

              {preview.features.length === 0 ? (
                <p className="mt-2 pl-6 text-[11px] text-muted-foreground">
                  No features found in Nest database.
                </p>
              ) : (
                <div className="mt-2.5 space-y-1.5 pl-6">
                  {preview.features.map((feature) => (
                    <div
                      key={feature.id}
                      className="rounded-md border border-border/40 bg-background/50 px-2.5 py-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <Icon
                          name="Puzzle"
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                          {feature.name}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
                          {feature.state}
                        </span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] leading-none",
                            feature.willImport
                              ? "harbor-badge-success"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {feature.alreadyExists ? "Existing" : "Import"}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                        {feature.rootPath ? (
                          <span className="max-w-full truncate font-mono" title={feature.rootPath}>
                            {feature.rootPath}
                          </span>
                        ) : null}
                        {feature.branchCount > 0 ? (
                          <span>{plural(feature.branchCount, "branch", "branches")}</span>
                        ) : null}
                        {feature.hasBrief ? <span>brief</span> : null}
                        {feature.decisionCount > 0 ? (
                          <span>{plural(feature.decisionCount, "decision")}</span>
                        ) : null}
                        {feature.refCount > 0 ? <span>{plural(feature.refCount, "ref")}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Section 3: Badge colors & settled/snoozed threads */}
            <section className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor={extrasCheckboxId}
                  className={cn(
                    "flex items-center gap-2 font-medium",
                    extrasDisabled ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer text-foreground",
                  )}
                >
                  <Checkbox
                    id={extrasCheckboxId}
                    checked={includeExtras && extrasPending > 0}
                    disabled={extrasDisabled}
                    onCheckedChange={(checked) => setIncludeExtras(checked === true)}
                    className={disabledCheckboxClass}
                  />
                  <span>Custom colors & thread shelves</span>
                </label>
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                    extrasPending > 0
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {extrasPending > 0
                    ? `${plural(preview.pending.badgeColors, "color")} · ${plural(preview.pending.lifecycle, "thread")}`
                    : "Already synced"}
                </span>
              </div>
              <p className="mt-1.5 pl-6 text-[11px] text-muted-foreground">
                Preserves project badge hex overrides plus settled and snoozed thread states.
              </p>
            </section>
          </>
        )}

        {error !== null ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
