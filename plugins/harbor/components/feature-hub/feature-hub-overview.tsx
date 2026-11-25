import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { formatWakeLabel, parkReasonLabel } from "@/components/inbox/feature-parked-shelf";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BriefInput, FeaturesApi } from "@/hooks/use-features";
import type { FeatureGitSummary } from "@/lib/domain/feature-git";
import { EMPTY_BRIEF, type FeatureRef } from "@/lib/domain/feature-meta";
import {
  PARK_REASON_PRESETS,
  type Feature,
  type FeatureMember,
  type FeatureRefLink,
} from "@/lib/domain/features";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import { cn } from "@/lib/ui/utils";

type HubWakePreset = "none" | "tomorrow" | "3d" | "7d";

function wakeTimestampFor(preset: HubWakePreset): number | null {
  if (preset === "none") return null;
  if (preset === "tomorrow") {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    return next.getTime();
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
  const [parkReason, setParkReason] = useState("waiting-qa");
  const [parkNote, setParkNote] = useState("");
  const [parkWakePreset, setParkWakePreset] = useState<HubWakePreset>("none");
  const [parkWakeActivity, setParkWakeActivity] = useState(true);
  const [parking, setParking] = useState(false);

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
        setSavedSignature(
          `${EMPTY_BRIEF.goal}\u0000${EMPTY_BRIEF.nonGoals}\u0000${EMPTY_BRIEF.acceptance}\u0000${EMPTY_BRIEF.notes}\u0000\u0000`,
        );
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

  const handleAddRef = () => {
    const url = newRefUrl.trim();
    const title = newRefTitle.trim();
    if (url.length === 0 || addingRef) return;
    setAddingRef(true);
    void api
      .addRef(feature.id, {
        url,
        ...(title ? { title } : {}),
      })
      .then((added) => {
        setRefs((prev) => [...prev, added]);
        setNewRefTitle("");
        setNewRefUrl("");
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not add link."),
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
        toast.error(err instanceof Error ? err.message : "Could not remove link."),
      );
  };

  const handlePark = () => {
    if (parking) return;
    setParking(true);
    void api
      .park({
        featureId: feature.id,
        reason: parkReason.trim() || null,
        note: parkNote.trim() || null,
        wakeAt: wakeTimestampFor(parkWakePreset),
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
      .then(() => toast.success(`Woke "${feature.name}".`))
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

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      {/* Status & quick workspace paths */}
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
          <div className="flex items-center gap-1">
            {feature.state === "parked" ? (
              <Button size="sm" className="h-6 px-2 text-2xs" disabled={parking} onClick={handleUnpark}>
                Wake feature
              </Button>
            ) : feature.state === "archived" ? (
              <Button size="sm" className="h-6 px-2 text-2xs" disabled={parking} onClick={handleReopen}>
                Reopen feature
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-2xs"
                onClick={() => setParkFormOpen((v) => !v)}
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
        {feature.state === "parked" && feature.parkedNote ? (
          <p className="text-2xs text-muted-foreground">{feature.parkedNote}</p>
        ) : null}
        {parkFormOpen && feature.state === "active" ? (
          <div className="grid gap-2 border-t border-border/70 pt-2">
            <div className="flex flex-wrap gap-1">
              {PARK_REASON_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setParkReason(preset)}
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px]",
                    parkReason === preset
                      ? "border-foreground/40 bg-accent text-foreground"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {parkReasonLabel(preset)}
                </button>
              ))}
            </div>
            <Input
              value={parkNote}
              maxLength={240}
              placeholder="Optional note while parked…"
              onChange={(e) => setParkNote(e.currentTarget.value)}
              className="h-7 text-2xs"
            />
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[10px] text-muted-foreground">Remind:</span>
              {(
                [
                  ["none", "No timer"],
                  ["tomorrow", "Tomorrow 9:00"],
                  ["3d", "+3 days"],
                  ["7d", "+1 week"],
                ] as const
              ).map(([presetKey, presetLabel]) => (
                <button
                  key={presetKey}
                  type="button"
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
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={`${baseId}-wake-act`}
                className="flex cursor-pointer items-center gap-1.5 text-2xs text-muted-foreground"
              >
                <Checkbox
                  id={`${baseId}-wake-act`}
                  checked={parkWakeActivity}
                  onCheckedChange={(v) => setParkWakeActivity(v === true)}
                />
                Auto-wake on thread activity
              </label>
              <Button size="sm" className="h-6 px-2.5 text-2xs" disabled={parking} onClick={handlePark}>
                Confirm Park
              </Button>
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
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
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
          <p className="text-2xs text-muted-foreground">No links attached yet.</p>
        ) : (
          <ul className="grid gap-1">
            {refs.map((ref) => (
              <li
                key={ref.id}
                className="flex items-center justify-between gap-2 rounded bg-muted/30 px-2 py-1 text-2xs"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="mr-1.5 rounded bg-muted px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {ref.kind}
                  </span>
                  {ref.url ? (
                    <a
                      href={ref.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground underline-offset-2 hover:underline"
                    >
                      {ref.title}
                    </a>
                  ) : (
                    ref.title
                  )}
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
        <div className="flex items-center gap-1.5">
          <Input
            value={newRefTitle}
            placeholder="Title"
            onChange={(e) => setNewRefTitle(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleAddRef();
              }
            }}
            className="h-6 w-28 text-2xs"
          />
          <Input
            value={newRefUrl}
            placeholder="https://…"
            onChange={(e) => setNewRefUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleAddRef();
              }
            }}
            className="h-6 flex-1 font-mono text-2xs"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-2xs disabled:opacity-65"
            disabled={addingRef || newRefUrl.trim().length === 0}
            onClick={handleAddRef}
          >
            {addingRef ? "Linking…" : "Link"}
          </Button>
        </div>
      </div>
    </div>
  );
}
