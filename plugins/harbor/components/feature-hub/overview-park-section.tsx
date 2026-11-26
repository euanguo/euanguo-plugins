import { useState } from "react";
import { toast } from "sonner";

import {
  ParkFeatureFields,
  toDatetimeLocalValue,
  wakeTimestampFor,
  type ParkWakePreset,
} from "@/components/inbox/feature-park-dialog";
import { formatWakeLabel, parkReasonLabel } from "@/components/inbox/feature-parked-shelf";
import { Button } from "@bb-ui/button";
import { Icon } from "@bb-ui/icon";
import type { FeaturesApi } from "@/hooks/use-features";
import type { Feature } from "@/lib/domain/features";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import { cn } from "@/lib/ui/utils";

/**
 * Status badges, Park/Wake/Reopen actions, and quick copy path buttons.
 */
export function OverviewParkSection({
  feature,
  api,
}: {
  readonly feature: Feature;
  readonly api: FeaturesApi;
}) {
  const [parkFormOpen, setParkFormOpen] = useState(false);
  const [parkReason, setParkReason] = useState(feature.parkedReason ?? "waiting-qa");
  const [parkNote, setParkNote] = useState(feature.parkedNote ?? "");
  const [parkWakePreset, setParkWakePreset] = useState<ParkWakePreset>(
    feature.wakeAt ? "custom" : "none",
  );
  const [parkCustomWake, setParkCustomWake] = useState(() =>
    toDatetimeLocalValue(feature.wakeAt ?? Date.now() + 24 * 60 * 60 * 1000),
  );
  const [parkWakeActivity, setParkWakeActivity] = useState(feature.wakeOnActivity ?? true);
  const [parking, setParking] = useState(false);

  const openParkEditor = () => {
    if (!parkFormOpen) {
      setParkReason(feature.parkedReason ?? "waiting-qa");
      setParkNote(feature.parkedNote ?? "");
      setParkWakePreset(feature.wakeAt ? "custom" : "none");
      setParkCustomWake(
        toDatetimeLocalValue(feature.wakeAt ?? Date.now() + 24 * 60 * 60 * 1000),
      );
      setParkWakeActivity(feature.wakeOnActivity ?? true);
    }
    setParkFormOpen((prev) => !prev);
  };

  const parkWakeAt = wakeTimestampFor(parkWakePreset, parkCustomWake);
  const parkWakeInvalid =
    parkWakePreset === "custom" && (parkWakeAt === null || parkWakeAt <= Date.now());

  const runParkAction = (action: Promise<unknown>, successMessage: string, fallback: string, closeForm: boolean) => {
    setParking(true);
    void action
      .then(() => {
        if (closeForm) setParkFormOpen(false);
        toast.success(successMessage);
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : fallback))
      .finally(() => setParking(false));
  };

  const handlePark = () => {
    if (parking || parkWakeInvalid) return;
    runParkAction(
      api.park({
        featureId: feature.id,
        reason: parkReason.trim() || null,
        note: parkNote.trim() || null,
        wakeAt: parkWakeAt,
        wakeOnActivity: parkWakeActivity,
      }),
      `Parked "${feature.name}".`,
      "Could not park feature.",
      true,
    );
  };

  const handleUnpark = () => {
    if (parking) return;
    runParkAction(api.unpark(feature.id), `Woke "${feature.name}".`, "Could not wake feature.", true);
  };

  const handleReopen = () => {
    if (parking) return;
    runParkAction(api.reopen(feature.id), `Reopened "${feature.name}".`, "Could not reopen feature.", false);
  };

  const codeWorkspacePath =
    feature.rootPath === null ? null : `${feature.rootPath}/${feature.slug}.code-workspace`;

  return (
    <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              feature.state === "parked"
                ? "harbor-badge-warning"
                : feature.state === "archived"
                  ? "bg-muted text-muted-foreground"
                  : "harbor-badge-success",
            )}
          >
            {feature.state === "archived" ? "finished" : feature.state}
          </span>
          {feature.state === "parked" && feature.parkedReason ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {parkReasonLabel(feature.parkedReason)}
            </span>
          ) : null}
          {feature.state === "parked" && feature.wakeAt ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {formatWakeLabel(feature.wakeAt, Date.now())}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {feature.state === "parked" ? (
            <>
              <Button size="sm" className="h-6 px-2 text-2xs" disabled={parking} onClick={handleUnpark}>
                Wake feature
              </Button>
              <Button variant="outline" size="sm" className="h-6 px-2 text-2xs" disabled={parking} onClick={openParkEditor}>
                Edit park
              </Button>
            </>
          ) : feature.state === "archived" ? (
            <Button size="sm" className="h-6 px-2 text-2xs" disabled={parking} onClick={handleReopen}>
              Reopen feature
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-6 px-2 text-2xs" onClick={openParkEditor}>
              <Icon name="Clock" className="mr-1 size-3" aria-hidden />
              Park
            </Button>
          )}
          {feature.rootPath ? (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-2xs"
              onClick={() => {
                if (feature.rootPath) void copyWithAnnouncement(feature.rootPath, "Feature folder path");
              }}
            >
              <Icon name="Copy" className="mr-1 size-3" aria-hidden />
              Copy folder
            </Button>
          ) : null}
          {codeWorkspacePath ? (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-2xs"
              onClick={() => void copyWithAnnouncement(codeWorkspacePath, ".code-workspace path")}
            >
              <Icon name="Copy" className="mr-1 size-3" aria-hidden />
              .code-workspace
            </Button>
          ) : null}
        </div>
      </div>
      {feature.state === "parked" && feature.parkedNote && !parkFormOpen ? (
        <p className="text-2xs text-muted-foreground">{feature.parkedNote}</p>
      ) : null}
      {parkFormOpen && feature.state !== "archived" ? (
        <div className="grid gap-2 border-t border-border/70 pt-2">
          <ParkFeatureFields
            reason={parkReason}
            note={parkNote}
            wakePreset={parkWakePreset}
            customWake={parkCustomWake}
            wakeActivity={parkWakeActivity}
            wakeInvalid={parkWakeInvalid}
            disabled={parking}
            onReasonChange={setParkReason}
            onNoteChange={setParkNote}
            onWakePresetChange={setParkWakePreset}
            onCustomWakeChange={setParkCustomWake}
            onWakeActivityChange={setParkWakeActivity}
          />
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-2xs"
              disabled={parking}
              onClick={() => setParkFormOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 px-2.5 text-2xs"
              disabled={parking || parkWakeInvalid}
              onClick={handlePark}
            >
              {feature.state === "parked" ? "Update Park" : "Confirm Park"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
