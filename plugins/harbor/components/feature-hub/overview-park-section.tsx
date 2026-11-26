import { useId, useState } from "react";
import { toast } from "sonner";

import { formatWakeLabel, parkReasonLabel } from "@/components/inbox/feature-parked-shelf";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FeaturesApi } from "@/hooks/use-features";
import {
  MAX_PARK_NOTE_LENGTH,
  MAX_PARK_REASON_LENGTH,
  PARK_REASON_PRESETS,
  type Feature,
} from "@/lib/domain/features";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import { cn } from "@/lib/ui/utils";

type HubWakePreset = "none" | "tomorrow" | "3d" | "7d" | "custom";

function toDatetimeLocalValue(ts: number): string {
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function wakeTimestampFor(preset: HubWakePreset, customIso: string): number | null {
  if (preset === "none") return null;
  if (preset === "tomorrow") {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    return next.getTime();
  }
  if (preset === "custom") {
    const parsed = Date.parse(customIso);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return Date.now() + (preset === "3d" ? 3 : 7) * 24 * 60 * 60 * 1000;
}

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
  const wakeActId = useId();
  const [parkFormOpen, setParkFormOpen] = useState(false);
  const [parkReason, setParkReason] = useState(feature.parkedReason ?? "waiting-qa");
  const [parkNote, setParkNote] = useState(feature.parkedNote ?? "");
  const [parkWakePreset, setParkWakePreset] = useState<HubWakePreset>(
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
  const isPresetReason = PARK_REASON_PRESETS.includes(
    parkReason.trim() as (typeof PARK_REASON_PRESETS)[number],
  );

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
          <div className="grid gap-1.5">
            <div className="flex flex-wrap gap-1">
              {PARK_REASON_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={parking}
                  onClick={() => setParkReason(preset)}
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px]",
                    parkReason.trim() === preset
                      ? "border-foreground/40 bg-accent text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {parkReasonLabel(preset)}
                </button>
              ))}
            </div>
            <Input
              value={isPresetReason ? "" : parkReason}
              maxLength={MAX_PARK_REASON_LENGTH}
              disabled={parking}
              placeholder={
                isPresetReason
                  ? `Preset selected: ${parkReasonLabel(parkReason.trim())} — or type custom status`
                  : "Custom status (e.g. Waiting API deploy)"
              }
              onChange={(e) => setParkReason(e.currentTarget.value)}
              className="h-7 text-2xs"
            />
          </div>
          <Textarea
            rows={2}
            value={parkNote}
            maxLength={MAX_PARK_NOTE_LENGTH}
            disabled={parking}
            placeholder="Where this left off, who we are waiting on, or next step when waking…"
            onChange={(e) => setParkNote(e.currentTarget.value)}
            className="min-h-0 resize-none text-2xs"
          />
          <div className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[10px] text-muted-foreground">Remind:</span>
              {(
                [
                  ["none", "No timer"],
                  ["tomorrow", "Tomorrow 9:00"],
                  ["3d", "+3 days"],
                  ["7d", "+1 week"],
                  ["custom", "Custom…"],
                ] as const
              ).map(([presetKey, presetLabel]) => (
                <button
                  key={presetKey}
                  type="button"
                  disabled={parking}
                  onClick={() => setParkWakePreset(presetKey)}
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px]",
                    parkWakePreset === presetKey
                      ? "border-foreground/40 bg-accent text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {presetLabel}
                </button>
              ))}
            </div>
            {parkWakePreset === "custom" ? (
              <Input
                type="datetime-local"
                value={parkCustomWake}
                disabled={parking}
                aria-label="Custom wake date and time"
                onChange={(e) => setParkCustomWake(e.currentTarget.value)}
                className="h-7 font-mono text-2xs"
              />
            ) : null}
            {parkWakeInvalid ? (
              <p className="text-[10px] text-destructive">Pick a future date and time.</p>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={wakeActId}
              className="flex cursor-pointer items-center gap-1.5 text-2xs text-muted-foreground"
            >
              <Checkbox
                id={wakeActId}
                checked={parkWakeActivity}
                disabled={parking}
                onCheckedChange={(v) => setParkWakeActivity(v === true)}
              />
              Auto-wake on thread activity
            </label>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-6 px-2 text-2xs" disabled={parking} onClick={() => setParkFormOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" className="h-6 px-2.5 text-2xs" disabled={parking || parkWakeInvalid} onClick={handlePark}>
                {feature.state === "parked" ? "Update Park" : "Confirm Park"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
