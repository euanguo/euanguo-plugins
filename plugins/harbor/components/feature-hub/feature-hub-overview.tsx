import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { formatWakeLabel, parkReasonLabel } from "@/components/inbox/feature-parked-shelf";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { BriefInput, FeaturesApi } from "@/hooks/use-features";
import type { FeatureGitSummary } from "@/lib/domain/feature-git";
import {
  EMPTY_BRIEF,
  MAX_REF_ID_LENGTH,
  MAX_REF_TITLE_LENGTH,
  MAX_REF_URL_LENGTH,
  refKindLabel,
  type FeatureRef,
  type RefKind,
} from "@/lib/domain/feature-meta";
import {
  MAX_PARK_NOTE_LENGTH,
  MAX_PARK_REASON_LENGTH,
  PARK_REASON_PRESETS,
  type Feature,
  type FeatureMember,
  type FeatureRefLink,
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

const EMPTY_BRIEF_SIGNATURE = `${EMPTY_BRIEF.goal}\u0000${EMPTY_BRIEF.nonGoals}\u0000${EMPTY_BRIEF.acceptance}\u0000${EMPTY_BRIEF.notes}\u0000\u0000`;

export function FeatureHubOverview({
  feature,
  members,
  refLinks,
  gitSummary,
  metaVersion,
  api,
}: {
  readonly feature: Feature;
  readonly members: readonly FeatureMember[];
  readonly refLinks: readonly FeatureRefLink[];
  readonly gitSummary: FeatureGitSummary | null;
  readonly metaVersion?: string;
  readonly api: FeaturesApi;
}) {
  const baseId = useId();
  const [goal, setGoal] = useState("");
  const [nonGoals, setNonGoals] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [notes, setNotes] = useState("");
  const [questionsText, setQuestionsText] = useState("");
  const [blockersText, setBlockersText] = useState("");
  const [metaLoaded, setMetaLoaded] = useState(false);
  const [savedSignature, setSavedSignature] = useState(EMPTY_BRIEF_SIGNATURE);
  const [refs, setRefs] = useState<readonly FeatureRef[]>([]);
  const [addingRef, setAddingRef] = useState(false);
  const [savingBrief, setSavingBrief] = useState(false);

  const currentSignature = `${goal}\u0000${nonGoals}\u0000${acceptance}\u0000${notes}\u0000${questionsText}\u0000${blockersText}`;
  const briefDirty = metaLoaded && currentSignature !== savedSignature;
  const briefDirtyRef = useRef(false);
  briefDirtyRef.current = briefDirty;
  const loadedFeatureRef = useRef<string | null>(null);

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

  const [newRefKind, setNewRefKind] = useState<RefKind>("link");
  const [newRefId, setNewRefId] = useState("");
  const [newRefTitle, setNewRefTitle] = useState("");
  const [newRefUrl, setNewRefUrl] = useState("");
  const [extraNotesOpen, setExtraNotesOpen] = useState(false);

  const { getMeta } = api;

  useEffect(() => {
    let cancelled = false;
    const switchedFeature = loadedFeatureRef.current !== feature.id;
    if (switchedFeature) setMetaLoaded(false);
    void getMeta(feature.id)
      .then((meta) => {
        if (cancelled) return;
        loadedFeatureRef.current = feature.id;
        setRefs(meta.refs);
        setMetaLoaded(true);
        if (!switchedFeature && briefDirtyRef.current) return;
        setGoal(meta.brief.goal);
        setNonGoals(meta.brief.nonGoals);
        setAcceptance(meta.brief.acceptance);
        setNotes(meta.brief.notes);
        const qText = meta.brief.openQuestions.join("\n");
        const bText = meta.brief.blockers.join("\n");
        setQuestionsText(qText);
        setBlockersText(bText);
        setSavedSignature(
          `${meta.brief.goal}\u0000${meta.brief.nonGoals}\u0000${meta.brief.acceptance}\u0000${meta.brief.notes}\u0000${qText}\u0000${bText}`,
        );
      })
      .catch(() => {
        if (cancelled) return;
        setMetaLoaded(true);
        if (!switchedFeature && briefDirtyRef.current) return;
        setGoal(EMPTY_BRIEF.goal);
        setNonGoals(EMPTY_BRIEF.nonGoals);
        setAcceptance(EMPTY_BRIEF.acceptance);
        setNotes(EMPTY_BRIEF.notes);
        setQuestionsText("");
        setBlockersText("");
        setRefs([]);
        setSavedSignature(EMPTY_BRIEF_SIGNATURE);
      });
    return () => {
      cancelled = true;
    };
  }, [getMeta, feature.id, metaVersion]);

  const handleSaveBrief = () => {
    if (savingBrief) return;
    setSavingBrief(true);
    const brief: BriefInput = {
      goal,
      nonGoals,
      acceptance,
      notes,
      openQuestions: questionsText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      blockers: blockersText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    };
    void api
      .saveBrief(feature.id, brief)
      .then(() => {
        setSavedSignature(currentSignature);
        toast.success("Requirement brief saved.");
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not save brief."),
      )
      .finally(() => setSavingBrief(false));
  };

  const canAddRef =
    !addingRef &&
    (newRefUrl.trim().length > 0 || newRefId.trim().length > 0);

  const handleAddRef = () => {
    const url = newRefUrl.trim();
    const refId = newRefId.trim();
    const title = newRefTitle.trim();
    if (!canAddRef) return;
    setAddingRef(true);
    void api
      .addRef(feature.id, {
        kind: newRefKind,
        ...(url.length > 0 ? { url } : {}),
        ...(refId.length > 0 ? { refId } : {}),
        ...(title.length > 0 ? { title } : {}),
      })
      .then((added) => {
        setRefs((prev) => [...prev, added]);
        setNewRefId("");
        setNewRefTitle("");
        setNewRefUrl("");
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not add reference."),
      )
      .finally(() => setAddingRef(false));
  };

  const handleRemoveRef = (refId: string) => {
    void api
      .removeRef(feature.id, refId)
      .then((ok) => {
        if (ok) setRefs((prev) => prev.filter((item) => item.id !== refId));
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not remove reference."),
      );
  };

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

  const handlePark = () => {
    if (parking || parkWakeInvalid) return;
    setParking(true);
    void api
      .park({
        featureId: feature.id,
        reason: parkReason.trim() || null,
        note: parkNote.trim() || null,
        wakeAt: parkWakeAt,
        wakeOnActivity: parkWakeActivity,
      })
      .then(() => {
        setParkFormOpen(false);
        toast.success(`Parked "${feature.name}".`);
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not park feature."),
      )
      .finally(() => setParking(false));
  };

  const handleUnpark = () => {
    if (parking) return;
    setParking(true);
    void api
      .unpark(feature.id)
      .then(() => {
        setParkFormOpen(false);
        toast.success(`Woke "${feature.name}".`);
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not wake feature."),
      )
      .finally(() => setParking(false));
  };

  const handleReopen = () => {
    if (parking) return;
    setParking(true);
    void api
      .reopen(feature.id)
      .then(() => toast.success(`Reopened "${feature.name}".`))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not reopen feature."),
      )
      .finally(() => setParking(false));
  };

  const codeWorkspacePath =
    feature.rootPath === null
      ? null
      : `${feature.rootPath}/${feature.slug}.code-workspace`;
  const isPresetReason = PARK_REASON_PRESETS.includes(
    parkReason.trim() as (typeof PARK_REASON_PRESETS)[number],
  );

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      {/* Status, Park/Wake controls & quick workspace paths */}
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
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-2xs"
                  disabled={parking}
                  onClick={openParkEditor}
                >
                  Edit park
                </Button>
              </>
            ) : feature.state === "archived" ? (
              <Button size="sm" className="h-6 px-2 text-2xs" disabled={parking} onClick={handleReopen}>
                Reopen feature
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-2xs"
                onClick={openParkEditor}
              >
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
                onClick={() =>
                  void copyWithAnnouncement(codeWorkspacePath, ".code-workspace path")
                }
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
                <p className="text-[10px] text-destructive">
                  Pick a future date and time.
                </p>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={`${baseId}-wake-act`}
                className="flex cursor-pointer items-center gap-1.5 text-2xs text-muted-foreground"
              >
                <Checkbox
                  id={`${baseId}-wake-act`}
                  checked={parkWakeActivity}
                  disabled={parking}
                  onCheckedChange={(v) => setParkWakeActivity(v === true)}
                />
                Auto-wake on thread activity
              </label>
              <div className="flex items-center gap-1">
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
          </div>
        ) : null}
      </div>

      {/* Multi-Repo KPI strip */}
      <div className="grid grid-cols-4 gap-1.5">
        <div className="rounded-md border border-border px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">Repos</div>
          <div className="text-sm font-semibold tabular-nums">
            {members.length}
            {refLinks.length > 0 ? (
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                ({refLinks.length} ref)
              </span>
            ) : null}
          </div>
        </div>
        <div className="rounded-md border border-border px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">Changes</div>
          <div className="text-sm font-semibold tabular-nums">
            {gitSummary ? (
              <>
                <span className="harbor-text-success">+{gitSummary.additions}</span>{" "}
                <span className="text-destructive">-{gitSummary.deletions}</span>
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
        <div className="rounded-md border border-border px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">Dirty</div>
          <div className="text-sm font-semibold tabular-nums">
            {gitSummary ? gitSummary.dirtyRepoCount : "—"}
          </div>
        </div>
        <div className="rounded-md border border-border px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">Unpushed</div>
          <div className="text-sm font-semibold tabular-nums">
            {gitSummary ? gitSummary.unpushedRepoCount : "—"}
          </div>
        </div>
      </div>

      {/* Requirement Brief editor */}
      <div className="grid gap-2 rounded-md border border-border p-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground">Requirement Brief</h3>
          <Button
            variant={briefDirty ? "default" : "outline"}
            size="sm"
            className={cn(
              "h-6 px-2.5 text-2xs",
              !briefDirty &&
                !savingBrief &&
                "border-border bg-muted/50 text-foreground/75 disabled:opacity-100",
            )}
            disabled={savingBrief || !briefDirty}
            onClick={handleSaveBrief}
          >
            {savingBrief ? "Saving…" : briefDirty ? "Save Brief" : "Saved"}
          </Button>
        </div>
        <div className="grid gap-1.5">
          <div className="grid gap-1">
            <label htmlFor={`${baseId}-goal`} className="text-[11px] text-muted-foreground">
              Goal
            </label>
            <Textarea
              id={`${baseId}-goal`}
              rows={2}
              value={goal}
              placeholder="What this feature delivers across repositories…"
              onChange={(e) => setGoal(e.currentTarget.value)}
              className="min-h-0 resize-none text-2xs"
            />
          </div>
          <div className="grid gap-1">
            <label htmlFor={`${baseId}-acceptance`} className="text-[11px] text-muted-foreground">
              Acceptance Criteria
            </label>
            <Textarea
              id={`${baseId}-acceptance`}
              rows={2}
              value={acceptance}
              placeholder="How we verify the multi-repo contract works end-to-end…"
              onChange={(e) => setAcceptance(e.currentTarget.value)}
              className="min-h-0 resize-none text-2xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <label htmlFor={`${baseId}-questions`} className="text-[11px] text-muted-foreground">
                Open Questions (1 per line)
              </label>
              <Textarea
                id={`${baseId}-questions`}
                rows={2}
                value={questionsText}
                placeholder="Unresolved questions across repos…"
                onChange={(e) => setQuestionsText(e.currentTarget.value)}
                className="min-h-0 resize-none text-2xs"
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor={`${baseId}-blockers`} className="text-[11px] text-muted-foreground">
                Blockers (1 per line)
              </label>
              <Textarea
                id={`${baseId}-blockers`}
                rows={2}
                value={blockersText}
                placeholder="Active blockers or dependencies…"
                onChange={(e) => setBlockersText(e.currentTarget.value)}
                className="min-h-0 resize-none text-2xs"
              />
            </div>
          </div>
          <div className="pt-0.5">
            <button
              type="button"
              aria-expanded={extraNotesOpen}
              onClick={() => setExtraNotesOpen((prev) => !prev)}
              className="flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Icon
                name="ChevronRight"
                className={cn(
                  "size-3 transition-transform motion-reduce:transition-none",
                  extraNotesOpen && "rotate-90",
                )}
                aria-hidden
              />
              <span>
                Out of scope &amp; extra notes
                {nonGoals.trim() || notes.trim() ? " (filled)" : ""}
              </span>
            </button>
            {extraNotesOpen ? (
              <div className="mt-1.5 grid gap-1.5">
                <div className="grid gap-1">
                  <label htmlFor={`${baseId}-nongoals`} className="text-[11px] text-muted-foreground">
                    Not this work (Out of scope)
                  </label>
                  <Textarea
                    id={`${baseId}-nongoals`}
                    rows={2}
                    value={nonGoals}
                    placeholder="Deliberately excluded so agents don't overreach…"
                    onChange={(e) => setNonGoals(e.currentTarget.value)}
                    className="min-h-0 resize-none text-2xs"
                  />
                </div>
                <div className="grid gap-1">
                  <label htmlFor={`${baseId}-notes`} className="text-[11px] text-muted-foreground">
                    Notes
                  </label>
                  <Textarea
                    id={`${baseId}-notes`}
                    rows={2}
                    value={notes}
                    placeholder="Shared guidance written into AGENTS.md…"
                    onChange={(e) => setNotes(e.currentTarget.value)}
                    className="min-h-0 resize-none text-2xs"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* External References */}
      <div className="grid gap-2 rounded-md border border-border p-2.5">
        <h3 className="text-xs font-semibold text-foreground">References &amp; Tickets</h3>
        {refs.length === 0 ? (
          <p className="text-2xs text-muted-foreground">No references attached yet.</p>
        ) : (
          <ul className="grid gap-1">
            {refs.map((ref) => (
              <li
                key={ref.id}
                className="flex items-center justify-between gap-2 rounded bg-muted/30 px-2 py-1 text-2xs"
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                  <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {refKindLabel(ref.kind)}
                  </span>
                  {ref.url ? (
                    <a
                      href={ref.url}
                      target="_blank"
                      rel="noreferrer"
                      title={ref.url}
                      className="min-w-0 truncate text-foreground underline-offset-2 hover:underline"
                    >
                      {ref.title}
                    </a>
                  ) : (
                    <span className="min-w-0 truncate text-foreground">{ref.title}</span>
                  )}
                  {ref.refId !== null ? (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {ref.refId}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${ref.title}`}
                  onClick={() => handleRemoveRef(ref.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-1.5 rounded-md border border-border/70 bg-muted/15 p-2">
          <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-1.5">
            <Select
              value={newRefKind}
              onValueChange={(value) => setNewRefKind(value as RefKind)}
            >
              <SelectTrigger aria-label="Reference kind" className="h-7 px-2 text-2xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ticket" className="text-xs">Ticket</SelectItem>
                <SelectItem value="document" className="text-xs">Document</SelectItem>
                <SelectItem value="link" className="text-xs">Link</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={newRefUrl}
              maxLength={MAX_REF_URL_LENGTH}
              placeholder="https://… (optional if ticket/doc ID is set)"
              onChange={(e) => setNewRefUrl(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleAddRef();
                }
              }}
              className="h-7 font-mono text-2xs"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              value={newRefId}
              maxLength={MAX_REF_ID_LENGTH}
              placeholder="Ticket / doc ID (e.g. TICKET-123)"
              onChange={(e) => setNewRefId(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleAddRef();
                }
              }}
              className="h-7 w-44 font-mono text-2xs"
            />
            <Input
              value={newRefTitle}
              maxLength={MAX_REF_TITLE_LENGTH}
              placeholder="Title (optional)"
              onChange={(e) => setNewRefTitle(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleAddRef();
                }
              }}
              className="h-7 flex-1 text-2xs"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 px-2.5 text-2xs disabled:opacity-60"
              disabled={!canAddRef}
              onClick={handleAddRef}
            >
              {addingRef ? "Adding…" : "Add ref"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
