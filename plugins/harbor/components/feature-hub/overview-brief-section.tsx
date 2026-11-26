import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Textarea } from "@/components/ui/textarea";
import type { BriefInput } from "@/hooks/use-features";
import { EMPTY_BRIEF, type FeatureBrief } from "@/lib/domain/feature-meta";
import { cn } from "@/lib/ui/utils";

const EMPTY_BRIEF_SIGNATURE = `${EMPTY_BRIEF.goal}\u0000${EMPTY_BRIEF.nonGoals}\u0000${EMPTY_BRIEF.acceptance}\u0000${EMPTY_BRIEF.notes}\u0000\u0000`;

function signatureFor(brief: FeatureBrief): string {
  const q = brief.openQuestions.join("\n");
  const b = brief.blockers.join("\n");
  return `${brief.goal}\u0000${brief.nonGoals}\u0000${brief.acceptance}\u0000${brief.notes}\u0000${q}\u0000${b}`;
}

/**
 * Editable requirement brief (Goal, Acceptance Criteria, Open Questions, Blockers, notes).
 */
export function OverviewBriefSection({
  featureId,
  initialBrief,
  metaLoaded,
  switchedFeature,
  onSave,
}: {
  readonly featureId: string;
  readonly initialBrief: FeatureBrief;
  readonly metaLoaded: boolean;
  readonly switchedFeature: boolean;
  readonly onSave: (featureId: string, brief: BriefInput) => Promise<unknown>;
}) {
  const baseId = useId();
  const [goal, setGoal] = useState("");
  const [nonGoals, setNonGoals] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [notes, setNotes] = useState("");
  const [questionsText, setQuestionsText] = useState("");
  const [blockersText, setBlockersText] = useState("");
  const [savedSignature, setSavedSignature] = useState(EMPTY_BRIEF_SIGNATURE);
  const [saving, setSaving] = useState(false);
  const [extraNotesOpen, setExtraNotesOpen] = useState(false);

  const currentSignature = `${goal}\u0000${nonGoals}\u0000${acceptance}\u0000${notes}\u0000${questionsText}\u0000${blockersText}`;
  const briefDirty = metaLoaded && currentSignature !== savedSignature;
  const dirtyRef = useRef(false);
  dirtyRef.current = briefDirty;

  useEffect(() => {
    if (!metaLoaded) return;
    if (!switchedFeature && dirtyRef.current) return;
    setGoal(initialBrief.goal);
    setNonGoals(initialBrief.nonGoals);
    setAcceptance(initialBrief.acceptance);
    setNotes(initialBrief.notes);
    setQuestionsText(initialBrief.openQuestions.join("\n"));
    setBlockersText(initialBrief.blockers.join("\n"));
    setSavedSignature(signatureFor(initialBrief));
  }, [initialBrief, metaLoaded, switchedFeature]);

  const handleSaveBrief = () => {
    if (saving) return;
    setSaving(true);
    const brief: BriefInput = {
      goal,
      nonGoals,
      acceptance,
      notes,
      openQuestions: questionsText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0),
      blockers: blockersText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0),
    };
    void onSave(featureId, brief)
      .then(() => {
        setSavedSignature(currentSignature);
        toast.success("Requirement brief saved.");
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not save brief."),
      )
      .finally(() => setSaving(false));
  };

  return (
    <div className="grid gap-2 rounded-md border border-border p-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground">Requirement Brief</h3>
        <Button
          variant={briefDirty ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-6 px-2.5 text-2xs",
            !briefDirty &&
              !saving &&
              "border-border bg-muted/50 text-foreground/75 disabled:opacity-100",
          )}
          disabled={saving || !briefDirty}
          onClick={handleSaveBrief}
        >
          {saving ? "Saving…" : briefDirty ? "Save Brief" : "Saved"}
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
  );
}
