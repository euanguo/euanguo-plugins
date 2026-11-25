import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { parkReasonLabel } from "@/components/inbox/feature-parked-shelf";
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

export function FeatureHubOverview({
  feature,
  members,
  refLinks,
  gitSummary,
  api,
}: {
  readonly feature: Feature;
  readonly members: readonly FeatureMember[];
  readonly refLinks: readonly FeatureRefLink[];
  readonly gitSummary: FeatureGitSummary | null;
  readonly api: FeaturesApi;
}) {
  const baseId = useId();
  const [goal, setGoal] = useState("");
  const [nonGoals, setNonGoals] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [notes, setNotes] = useState("");
  const [questionsText, setQuestionsText] = useState("");
  const [blockersText, setBlockersText] = useState("");
  const [savedSignature, setSavedSignature] = useState("");
  const [refs, setRefs] = useState<readonly FeatureRef[]>([]);
  const [savingBrief, setSavingBrief] = useState(false);

  const currentSignature = `${goal}\u0000${nonGoals}\u0000${acceptance}\u0000${notes}\u0000${questionsText}\u0000${blockersText}`;
  const briefDirty = currentSignature !== savedSignature;

  const [parkFormOpen, setParkFormOpen] = useState(false);
  const [parkReason, setParkReason] = useState("waiting-qa");
  const [parkNote, setParkNote] = useState("");
  const [parkWakeActivity, setParkWakeActivity] = useState(true);
  const [parking, setParking] = useState(false);

  const [newRefTitle, setNewRefTitle] = useState("");
  const [newRefUrl, setNewRefUrl] = useState("");

  const { getMeta } = api;

  useEffect(() => {
    let cancelled = false;
    void getMeta(feature.id)
      .then((meta) => {
        if (cancelled) return;
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
        setRefs(meta.refs);
      })
      .catch(() => {
        if (cancelled) return;
        setGoal(EMPTY_BRIEF.goal);
        setNonGoals(EMPTY_BRIEF.nonGoals);
        setAcceptance(EMPTY_BRIEF.acceptance);
        setNotes(EMPTY_BRIEF.notes);
        setSavedSignature(
          `${EMPTY_BRIEF.goal}\u0000${EMPTY_BRIEF.nonGoals}\u0000${EMPTY_BRIEF.acceptance}\u0000${EMPTY_BRIEF.notes}\u0000\u0000`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [getMeta, feature.id]);

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
    if (url.length === 0 && title.length === 0) return;
    void api
      .addRef(feature.id, {
        ...(url ? { url } : {}),
        ...(title ? { title } : {}),
      })
      .then((added) => {
        setRefs((prev) => [...prev, added]);
        setNewRefTitle("");
        setNewRefUrl("");
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not add link."),
      );
  };

  const handleRemoveRef = (refId: string) => {
    void api
      .removeRef(feature.id, refId)
      .then((ok) => {
        if (ok) setRefs((prev) => prev.filter((item) => item.id !== refId));
      })
      .catch(() => undefined);
  };

  const handlePark = () => {
    if (parking) return;
    setParking(true);
    void api
      .park({
        featureId: feature.id,
        reason: parkReason.trim() || null,
        note: parkNote.trim() || null,
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
                  ? "bg-amber-500/15 text-amber-500"
                  : "bg-emerald-500/15 text-emerald-500",
              )}
            >
              {feature.state}
            </span>
            {feature.state === "parked" && feature.parkedReason ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {parkReasonLabel(feature.parkedReason)}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {feature.state === "parked" ? (
              <Button size="sm" className="h-6 px-2 text-2xs" disabled={parking} onClick={handleUnpark}>
                Wake feature
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
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-2xs"
                onClick={() => {
                  if (feature.rootPath) void copyWithAnnouncement(feature.rootPath, "Feature folder path");
                }}
              >
                Copy folder
              </Button>
            ) : null}
            {codeWorkspacePath ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-2xs"
                onClick={() =>
                  void copyWithAnnouncement(codeWorkspacePath, ".code-workspace path")
                }
              >
                .code-workspace
              </Button>
            ) : null}
          </div>
        </div>
        {feature.state === "parked" && feature.parkedNote ? (
          <p className="text-2xs text-muted-foreground">{feature.parkedNote}</p>
        ) : null}
        {parkFormOpen ? (
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
                <span className="text-emerald-500">+{gitSummary.additions}</span>{" "}
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
            className="h-6 px-2.5 text-2xs"
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
                onChange={(e) => setBlockersText(e.currentTarget.value)}
                className="min-h-0 resize-none text-2xs"
              />
            </div>
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
            className="h-6 w-28 text-2xs"
          />
          <Input
            value={newRefUrl}
            placeholder="https://…"
            onChange={(e) => setNewRefUrl(e.currentTarget.value)}
            className="h-6 flex-1 font-mono text-2xs"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-2xs"
            disabled={newRefTitle.trim().length === 0 && newRefUrl.trim().length === 0}
            onClick={handleAddRef}
          >
            Link
          </Button>
        </div>
      </div>
    </div>
  );
}
