import { useEffect, useId, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialogFooter } from "@/components/ui/confirm-dialog-footer";
import { DialogError, Field } from "@/components/ui/control";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { useDialogTask } from "@/hooks/use-dialog-task";
import type { ParkFeatureInput } from "@/hooks/use-features";
import { parkReasonLabel } from "@/components/inbox/feature-parked-shelf";
import {
  MAX_PARK_NOTE_LENGTH,
  MAX_PARK_REASON_LENGTH,
  PARK_REASON_PRESETS,
  type Feature,
} from "@/lib/domain/features";
import { cn } from "@/lib/ui/utils";

type WakePreset = "none" | "tomorrow" | "3d" | "7d" | "custom";

function computePresetWakeAt(preset: WakePreset, customIso: string): number | null {
  const now = new Date();
  if (preset === "none") return null;
  if (preset === "tomorrow") {
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    return next.getTime();
  }
  if (preset === "3d") return Date.now() + 3 * 24 * 60 * 60 * 1000;
  if (preset === "7d") return Date.now() + 7 * 24 * 60 * 60 * 1000;
  const parsed = Date.parse(customIso);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDatetimeLocalValue(ts: number): string {
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function FeatureParkDialog({
  open,
  feature,
  onPark,
  onClose,
}: {
  readonly open: boolean;
  readonly feature: Feature | null;
  readonly onPark: (input: ParkFeatureInput) => Promise<Feature>;
  readonly onClose: () => void;
}) {
  const wakeActivityId = useId();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [wakePreset, setWakePreset] = useState<WakePreset>("none");
  const [customWake, setCustomWake] = useState(() =>
    toDatetimeLocalValue(Date.now() + 24 * 60 * 60 * 1000),
  );
  const [wakeOnActivity, setWakeOnActivity] = useState(true);
  const task = useDialogTask<unknown>();

  useEffect(() => {
    if (!open) return;
    setReason(feature?.parkedReason ?? "waiting-qa");
    setNote(feature?.parkedNote ?? "");
    setWakePreset(feature?.wakeAt ? "custom" : "none");
    setCustomWake(
      toDatetimeLocalValue(feature?.wakeAt ?? Date.now() + 24 * 60 * 60 * 1000),
    );
    setWakeOnActivity(feature?.wakeOnActivity ?? true);
    task.reset();
  }, [open, feature?.id]);

  if (!open || feature === null) return null;

  const wakeAt = computePresetWakeAt(wakePreset, customWake);
  const wakeInvalid =
    wakePreset === "custom" && (wakeAt === null || wakeAt <= Date.now());

  const submit = () => {
    if (task.busy || wakeInvalid) return;
    void task.run(async () => {
      await onPark({
        featureId: feature.id,
        reason: reason.trim() || null,
        note: note.trim() || null,
        wakeAt,
        wakeOnActivity,
      });
      onClose();
    }, "Could not park feature.");
  };

  return (
    <Modal
      open
      onClose={() => {
        if (!task.busy) onClose();
      }}
      title="Park feature"
      subtitle={`${feature.name} — keeps all worktrees and threads intact until resumed`}
      icon="Clock"
      busy={task.busy}
      width="30rem"
      footer={
        <ConfirmDialogFooter
          cancelLabel="Cancel"
          submitLabel={task.busy ? "Parking…" : "Park feature"}
          busy={task.busy}
          disabled={wakeInvalid}
          onSubmit={submit}
          onCancel={onClose}
        />
      }
    >
      <div className="grid gap-3">
        <Field label="Reason">
          <div className="grid gap-1.5">
            <div className="flex flex-wrap gap-1">
              {PARK_REASON_PRESETS.map((preset) => {
                const selected = reason.trim() === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    disabled={task.busy}
                    onClick={() => setReason(preset)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-2xs transition-colors",
                      selected
                        ? "border-foreground/40 bg-accent text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    {parkReasonLabel(preset)}
                  </button>
                );
              })}
            </div>
            <Input
              value={reason}
              maxLength={MAX_PARK_REASON_LENGTH}
              disabled={task.busy}
              placeholder="Or type a custom status (e.g. Waiting API deploy)"
              onChange={(event) => setReason(event.currentTarget.value)}
            />
          </div>
        </Field>
        <Field label="Note (optional)">
          <Textarea
            rows={2}
            value={note}
            maxLength={MAX_PARK_NOTE_LENGTH}
            disabled={task.busy}
            placeholder="Where this left off, who we are waiting on, or next step when waking…"
            onChange={(event) => setNote(event.currentTarget.value)}
          />
        </Field>
        <Field label="Wake reminder">
          <div className="grid gap-1.5">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["none", "No timer"],
                  ["tomorrow", "Tomorrow 9:00"],
                  ["3d", "+3 days"],
                  ["7d", "+1 week"],
                  ["custom", "Custom…"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  disabled={task.busy}
                  onClick={() => setWakePreset(key)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-2xs transition-colors",
                    wakePreset === key
                      ? "border-foreground/40 bg-accent text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {wakePreset === "custom" ? (
              <Input
                type="datetime-local"
                value={customWake}
                disabled={task.busy}
                onChange={(event) => setCustomWake(event.currentTarget.value)}
                className="font-mono text-2xs"
              />
            ) : null}
            {wakeInvalid ? (
              <p className="text-2xs text-destructive">
                Pick a future date and time.
              </p>
            ) : null}
          </div>
        </Field>
        <label
          htmlFor={wakeActivityId}
          className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
        >
          <Checkbox
            id={wakeActivityId}
            checked={wakeOnActivity}
            disabled={task.busy}
            onCheckedChange={(value) => setWakeOnActivity(value === true)}
          />
          Wake automatically when any thread in this feature becomes active
        </label>
        {task.error === null ? null : <DialogError>{task.error}</DialogError>}
      </div>
    </Modal>
  );
}
