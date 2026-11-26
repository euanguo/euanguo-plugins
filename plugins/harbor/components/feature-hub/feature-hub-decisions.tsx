import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Button } from "@bb-ui/button";
import { Input } from "@bb-ui/input";
import { Textarea } from "@bb-ui/textarea";
import type { FeaturesApi } from "@/hooks/use-features";
import type { FeatureDecision } from "@/lib/domain/feature-meta";
import { cn } from "@/lib/ui/utils";

export function FeatureHubDecisions({
  featureId,
  metaVersion,
  api,
}: {
  readonly featureId: string;
  readonly metaVersion?: string;
  readonly api: FeaturesApi;
}) {
  const [decisions, setDecisions] = useState<readonly FeatureDecision[]>([]);
  const [title, setTitle] = useState("");
  const [choice, setChoice] = useState("");
  const [rationale, setRationale] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [impact, setImpact] = useState("");
  const [supersedesSeq, setSupersedesSeq] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const editorRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const { getMeta } = api;

  const loadDecisions = () => {
    void getMeta(featureId)
      .then((meta) => setDecisions(meta.decisions))
      .catch(() => undefined);
  };

  useEffect(() => {
    let cancelled = false;
    void getMeta(featureId)
      .then((meta) => {
        if (!cancelled) setDecisions(meta.decisions);
      })
      .catch(() => {
        if (!cancelled) setDecisions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [featureId, getMeta, metaVersion]);

  const handleConfirm = (decisionId: string) => {
    setBusy(true);
    void api
      .confirmDecision(featureId, decisionId)
      .then(() => {
        toast.success("Decision confirmed.");
        loadDecisions();
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not confirm decision."),
      )
      .finally(() => setBusy(false));
  };

  const handleDeleteDraft = (decisionId: string) => {
    setBusy(true);
    void api
      .deleteDraft(featureId, decisionId)
      .then(() => {
        toast.success("Draft discarded.");
        loadDecisions();
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not discard draft."),
      )
      .finally(() => setBusy(false));
  };

  const canCreate = title.trim().length > 0 && choice.trim().length > 0 && !busy;

  const handleCreate = () => {
    if (!canCreate) return;
    setBusy(true);
    const rejected = alternatives
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    void api
      .addDecision(featureId, {
        title: title.trim(),
        choice: choice.trim(),
        rationale: rationale.trim(),
        alternatives: rejected,
        impact: impact.trim(),
        supersedes: supersedesSeq,
      })
      .then(() => {
        setTitle("");
        setChoice("");
        setRationale("");
        setAlternatives("");
        setImpact("");
        setSupersedesSeq(null);
        toast.success("Decision recorded.");
        loadDecisions();
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not record decision."),
      )
      .finally(() => setBusy(false));
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === "Enter" &&
      !event.nativeEvent.isComposing &&
      canCreate
    ) {
      event.preventDefault();
      handleCreate();
    }
  };

  const handleSupersede = (decision: FeatureDecision) => {
    setSupersedesSeq(decision.seq);
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      titleInputRef.current?.focus();
    });
  };

  const supersededDecision =
    supersedesSeq === null
      ? null
      : (decisions.find((entry) => entry.seq === supersedesSeq) ?? null);

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div className="grid gap-1.5">
        <h3 className="text-xs font-semibold text-foreground">
          Decision Log ({decisions.length})
        </h3>
        {decisions.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-2xs text-muted-foreground">
            No architecture or contract decisions recorded yet.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {[...decisions]
              .sort((a, b) => {
                if (a.status === "draft" && b.status !== "draft") return -1;
                if (a.status !== "draft" && b.status === "draft") return 1;
                return b.seq - a.seq;
              })
              .map((decision) => (
                <li
                  key={decision.id}
                  className={cn(
                    "grid gap-1 rounded-md border p-2.5",
                    decision.status === "draft"
                      ? "harbor-draft-card"
                      : "border-border",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-foreground">
                      #{decision.seq} {decision.title}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-medium",
                          decision.status === "draft"
                            ? "harbor-badge-warning"
                            : decision.status === "superseded"
                              ? "bg-muted text-muted-foreground"
                              : "harbor-badge-success",
                        )}
                      >
                        {decision.status}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {decision.author}
                      </span>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-2xs text-foreground/90">
                    {decision.choice}
                  </p>
                  {decision.rationale ? (
                    <p className="whitespace-pre-wrap text-2xs text-muted-foreground">
                      Why: {decision.rationale}
                    </p>
                  ) : null}
                  {decision.alternativesRejected.length > 0 ? (
                    <p className="whitespace-pre-wrap text-2xs text-muted-foreground">
                      Rejected: {decision.alternativesRejected.join(" · ")}
                    </p>
                  ) : null}
                  {decision.impact ? (
                    <p className="whitespace-pre-wrap text-2xs text-muted-foreground">
                      Impact: {decision.impact}
                    </p>
                  ) : null}
                  {decision.supersedes !== null || decision.supersededBy !== null ? (
                    <p className="text-[10px] text-muted-foreground">
                      {decision.supersedes !== null ? `Supersedes #${decision.supersedes}` : ""}
                      {decision.supersedes !== null && decision.supersededBy !== null ? " · " : ""}
                      {decision.supersededBy !== null ? `Superseded by #${decision.supersededBy}` : ""}
                    </p>
                  ) : null}
                  {decision.status === "draft" ? (
                    <div className="flex items-center gap-1.5 pt-1">
                      <Button
                        size="sm"
                        className="h-6 px-2 text-2xs"
                        disabled={busy}
                        onClick={() => handleConfirm(decision.id)}
                      >
                        Confirm decision
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-2xs text-destructive"
                        disabled={busy}
                        onClick={() => handleDeleteDraft(decision.id)}
                      >
                        Discard
                      </Button>
                    </div>
                  ) : decision.status === "confirmed" && decision.supersededBy === null ? (
                    <div className="flex items-center justify-end pt-0.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          "h-6 px-2 text-[10px]",
                          supersedesSeq === decision.seq &&
                            "harbor-badge-warning border-current/30 disabled:opacity-100",
                        )}
                        disabled={busy || supersedesSeq === decision.seq}
                        onClick={() => handleSupersede(decision)}
                      >
                        {supersedesSeq === decision.seq
                          ? "Superseding…"
                          : `Supersede #${decision.seq}`}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
          </ul>
        )}
      </div>

      <div
        ref={editorRef}
        className="grid gap-2 rounded-md border border-border bg-muted/20 p-2.5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs font-medium text-foreground">
            Record Standing Decision
          </span>
          {supersedesSeq !== null ? (
            <span className="harbor-badge-warning inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]">
              Superseding #{supersedesSeq}
              <button
                type="button"
                aria-label="Clear supersede target"
                onClick={() => setSupersedesSeq(null)}
                className="ml-0.5 hover:opacity-75"
              >
                ×
              </button>
            </span>
          ) : null}
        </div>
        {supersededDecision !== null ? (
          <blockquote className="rounded border-l-2 border-amber-500/60 bg-muted/40 px-2.5 py-1.5 text-2xs text-muted-foreground">
            <span className="font-medium text-foreground">
              #{supersededDecision.seq} {supersededDecision.title}
            </span>
            <span className="mt-0.5 block line-clamp-2">
              {supersededDecision.choice}
            </span>
          </blockquote>
        ) : null}
        <Input
          ref={titleInputRef}
          value={title}
          maxLength={200}
          placeholder="Decision summary…"
          onChange={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={handleEditorKeyDown}
          className="h-7 text-2xs"
        />
        <Textarea
          rows={2}
          value={choice}
          maxLength={4000}
          placeholder="What was chosen…"
          onChange={(e) => setChoice(e.currentTarget.value)}
          onKeyDown={handleEditorKeyDown}
          className="text-2xs"
        />
        <Input
          value={rationale}
          maxLength={2000}
          placeholder="Rationale / constraint (optional)"
          onChange={(e) => setRationale(e.currentTarget.value)}
          onKeyDown={handleEditorKeyDown}
          className="h-7 text-2xs"
        />
        <Textarea
          rows={2}
          value={alternatives}
          maxLength={2000}
          placeholder="Alternatives rejected, 1 per line (optional)"
          onChange={(e) => setAlternatives(e.currentTarget.value)}
          onKeyDown={handleEditorKeyDown}
          className="min-h-0 resize-none text-2xs"
        />
        <Input
          value={impact}
          maxLength={1000}
          placeholder="Downstream impact (optional)"
          onChange={(e) => setImpact(e.currentTarget.value)}
          onKeyDown={handleEditorKeyDown}
          className="h-7 text-2xs"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            ⌘/Ctrl+Enter to confirm
          </span>
          <Button
            size="sm"
            className="h-7 px-3 text-2xs disabled:opacity-60"
            disabled={!canCreate}
            onClick={handleCreate}
          >
            Confirm Decision
          </Button>
        </div>
      </div>
    </div>
  );
}
