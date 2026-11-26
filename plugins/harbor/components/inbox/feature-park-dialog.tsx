import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { parkReasonLabel } from "@/components/inbox/feature-parked-shelf";
import { ConfirmDialogFooter } from "@/components/ui/confirm-dialog-footer";
import { DialogError } from "@/components/ui/control";
import { Modal } from "@/components/ui/modal";
import { useDialogTask } from "@/hooks/use-dialog-task";
import type { ParkFeatureInput } from "@/hooks/use-features";
import {
  MAX_PARK_NOTE_LENGTH,
  MAX_PARK_REASON_LENGTH,
  PARK_REASON_PRESETS,
  type Feature,
} from "@/lib/domain/features";
import { cn } from "@/lib/ui/utils";
import { Checkbox } from "@bb-ui/checkbox";
import { Input } from "@bb-ui/input";
import { Textarea } from "@bb-ui/textarea";

export type ParkWakePreset = "none" | "tomorrow" | "3d" | "7d" | "custom";

export function toDatetimeLocalValue(ts: number): string {
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function wakeTimestampFor(
  preset: ParkWakePreset,
  customIso: string,
): number | null {
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

const REMINDER_OPTIONS: readonly (readonly [ParkWakePreset, string])[] = [
  ["none", "No timer"],
  ["tomorrow", "Tomorrow 9:00"],
  ["3d", "+3 days"],
  ["7d", "+1 week"],
  ["custom", "Custom…"],
];

/**
 * Shared reason, context note, wake reminder, and auto-wake fields used by
 * both the Feature Hub park editor and the quick right-click Park modal.
 */
export function ParkFeatureFields({
  reason,
  note,
  wakePreset,
  customWake,
  wakeActivity,
  wakeInvalid,
  disabled = false,
  onReasonChange,
  onNoteChange,
  onWakePresetChange,
  onCustomWakeChange,
  onWakeActivityChange,
}: {
  readonly reason: string;
  readonly note: string;
  readonly wakePreset: ParkWakePreset;
  readonly customWake: string;
  readonly wakeActivity: boolean;
  readonly wakeInvalid: boolean;
  readonly disabled?: boolean;
  readonly onReasonChange: (value: string) => void;
  readonly onNoteChange: (value: string) => void;
  readonly onWakePresetChange: (value: ParkWakePreset) => void;
  readonly onCustomWakeChange: (value: string) => void;
  readonly onWakeActivityChange: (value: boolean) => void;
}) {
  const wakeActId = useId();
  const isPresetReason = PARK_REASON_PRESETS.includes(
    reason.trim() as (typeof PARK_REASON_PRESETS)[number],
  );

  return (
    <div className="grid gap-2">
      <div className="grid gap-1.5">
        <div className="flex flex-wrap gap-1">
          {PARK_REASON_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              onClick={() => onReasonChange(preset)}
              className={cn(
                "rounded border px-1.5 py-0.5 text-[10px] transition-colors",
                reason.trim() === preset
                  ? "border-primary/45 bg-primary/10 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {parkReasonLabel(preset)}
            </button>
          ))}
        </div>
        <Input
          value={isPresetReason ? "" : reason}
          maxLength={MAX_PARK_REASON_LENGTH}
          disabled={disabled}
          placeholder={
            isPresetReason
              ? `Preset selected: ${parkReasonLabel(reason.trim())} — or type custom status`
              : "Custom status (e.g. Waiting API deploy)"
          }
          onChange={(e) => onReasonChange(e.currentTarget.value)}
          className="h-7 text-2xs"
        />
      </div>
      <Textarea
        rows={2}
        value={note}
        maxLength={MAX_PARK_NOTE_LENGTH}
        disabled={disabled}
        placeholder="Where this left off, who we are waiting on, or next step when waking…"
        onChange={(e) => onNoteChange(e.currentTarget.value)}
        className="min-h-0 resize-none text-2xs"
      />
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[10px] text-muted-foreground">Remind:</span>
          {REMINDER_OPTIONS.map(([presetKey, presetLabel]) => (
            <button
              key={presetKey}
              type="button"
              disabled={disabled}
              onClick={() => onWakePresetChange(presetKey)}
              className={cn(
                "rounded border px-1.5 py-0.5 text-[10px] transition-colors",
                wakePreset === presetKey
                  ? "border-primary/45 bg-primary/10 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {presetLabel}
            </button>
          ))}
        </div>
        {wakePreset === "custom" ? (
          <Input
            type="datetime-local"
            value={customWake}
            disabled={disabled}
            aria-label="Custom wake date and time"
            onChange={(e) => onCustomWakeChange(e.currentTarget.value)}
            className="h-7 font-mono text-2xs"
          />
        ) : null}
        {wakeInvalid ? (
          <p className="text-[10px] text-destructive">Pick a future date and time.</p>
        ) : null}
      </div>
      <label
        htmlFor={wakeActId}
        className="flex cursor-pointer items-center gap-1.5 text-2xs text-muted-foreground"
      >
        <Checkbox
          id={wakeActId}
          checked={wakeActivity}
          disabled={disabled}
          onCheckedChange={(v) => onWakeActivityChange(v === true)}
        />
        Auto-wake on thread activity
      </label>
    </div>
  );
}

/**
 * Right-click dialog for parking an active feature onto the Parked shelf
 * without deleting worktrees or archiving its threads.
 */
export function FeatureParkDialog({
  feature,
  onPark,
  onClose,
}: {
  readonly feature: Feature | null;
  readonly onPark: (input: ParkFeatureInput) => Promise<Feature>;
  readonly onClose: () => void;
}) {
  const open = feature !== null;
  const featureId = feature?.id ?? null;
  const [reason, setReason] = useState("waiting-qa");
  const [note, setNote] = useState("");
  const [wakePreset, setWakePreset] = useState<ParkWakePreset>("none");
  const [customWake, setCustomWake] = useState(() =>
    toDatetimeLocalValue(Date.now() + 24 * 60 * 60 * 1000),
  );
  const [wakeActivity, setWakeActivity] = useState(true);
  const task = useDialogTask<unknown>();
  const busy = task.busy;
  const resetTask = task.reset;

  useEffect(() => {
    if (!open || feature === null) return;
    setReason(feature.parkedReason ?? "waiting-qa");
    setNote(feature.parkedNote ?? "");
    setWakePreset(feature.wakeAt ? "custom" : "none");
    setCustomWake(
      toDatetimeLocalValue(feature.wakeAt ?? Date.now() + 24 * 60 * 60 * 1000),
    );
    setWakeActivity(feature.wakeOnActivity ?? true);
    resetTask();
  }, [feature, featureId, open, resetTask]);

  if (!open || feature === null) return null;

  const wakeAt = wakeTimestampFor(wakePreset, customWake);
  const wakeInvalid =
    wakePreset === "custom" && (wakeAt === null || wakeAt <= Date.now());

  const submit = () => {
    if (busy || wakeInvalid) return;
    void task.run(async () => {
      await onPark({
        featureId: feature.id,
        reason: reason.trim() || null,
        note: note.trim() || null,
        wakeAt,
        wakeOnActivity: wakeActivity,
      });
      toast.success(`Parked "${feature.name}".`);
      onClose();
    }, "Could not park feature.");
  };

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Park feature"
      subtitle={feature.name}
      icon="Clock"
      busy={busy}
      width="29rem"
      footer={
        <ConfirmDialogFooter
          cancelLabel="Cancel"
          submitLabel={busy ? "Parking…" : "Park feature"}
          busy={busy}
          disabled={wakeInvalid}
          onSubmit={submit}
          onCancel={onClose}
        />
      }
    >
      <div className="grid gap-3 text-xs">
        <p className="leading-relaxed text-muted-foreground">
          Moves this feature to the Parked shelf without removing worktrees or archiving conversations.
        </p>
        <ParkFeatureFields
          reason={reason}
          note={note}
          wakePreset={wakePreset}
          customWake={customWake}
          wakeActivity={wakeActivity}
          wakeInvalid={wakeInvalid}
          disabled={busy}
          onReasonChange={setReason}
          onNoteChange={setNote}
          onWakePresetChange={setWakePreset}
          onCustomWakeChange={setCustomWake}
          onWakeActivityChange={setWakeActivity}
        />
        {task.error ? <DialogError>{task.error}</DialogError> : null}
      </div>
    </Modal>
  );
}
