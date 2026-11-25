import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FeaturesApi } from "@/hooks/use-features";
import type { FeatureDecision } from "@/lib/domain/feature-meta";
import { cn } from "@/lib/ui/utils";

export function FeatureHubDecisions({
  featureId,
  api,
}: {
  readonly featureId: string;
  readonly api: FeaturesApi;
}) {
  const [decisions, setDecisions] = useState<readonly FeatureDecision[]>([]);
  const [title, setTitle] = useState("");
  const [choice, setChoice] = useState("");
  const [rationale, setRationale] = useState("");
  const [impact, setImpact] = useState("");
  const [busy, setBusy] = useState(false);

  const loadDecisions = () => {
    void api
      .getMeta(featureId)
      .then((meta) => setDecisions(meta.decisions))
      .catch(() => undefined);
  };

  useEffect(() => {
    loadDecisions();
  }, [featureId]);

  const handleConfirm = (decisionId: string) => {
    setBusy(true);
    void api
      .confirmDecision(featureId, decisionId)
      .then(() => {
        toast.success("Decision confirmed.");
        loadDecisions();
      })
      .finally(() => setBusy(false));
  };

  const handleDeleteDraft = (decisionId: string) => {
    setBusy(true);
    void api
      .deleteDraft(featureId, decisionId)
      .then(() => loadDecisions())
      .finally(() => setBusy(false));
  };

  const handleCreate = () => {
    if (!title.trim() || !choice.trim() || busy) return;
    setBusy(true);
    void api
      .addDecision(featureId, {
        title: title.trim(),
        choice: choice.trim(),
        rationale: rationale.trim(),
        alternatives: [],
        impact: impact.trim(),
        supersedes: null,
      })
      .then(() => {
        setTitle("");
        setChoice("");
        setRationale("");
        setImpact("");
        toast.success("Decision recorded.");
        loadDecisions();
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not record decision."),
      )
      .finally(() => setBusy(false));
  };

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
            {decisions.map((decision) => (
              <li
                key={decision.id}
                className={cn(
                  "grid gap-1 rounded-md border p-2.5",
                  decision.status === "draft"
                    ? "border-amber-500/40 bg-amber-500/5"
                    : "border-border",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-foreground">
                    #{decision.seq} {decision.title}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
                      decision.status === "draft"
                        ? "bg-amber-500/15 text-amber-500"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {decision.status} · {decision.author}
                  </span>
                </div>
                <p className="text-2xs text-foreground/90">{decision.choice}</p>
                {decision.rationale ? (
                  <p className="text-2xs text-muted-foreground">Why: {decision.rationale}</p>
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
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-2.5">
        <span className="text-2xs font-medium text-foreground">
          Record Standing Decision
        </span>
        <Input
          value={title}
          maxLength={200}
          placeholder="Decision summary…"
          onChange={(e) => setTitle(e.currentTarget.value)}
          className="h-7 text-2xs"
        />
        <Textarea
          rows={2}
          value={choice}
          maxLength={4000}
          placeholder="What was chosen…"
          onChange={(e) => setChoice(e.currentTarget.value)}
          className="text-2xs"
        />
        <Input
          value={rationale}
          maxLength={2000}
          placeholder="Rationale / constraint (optional)"
          onChange={(e) => setRationale(e.currentTarget.value)}
          className="h-7 text-2xs"
        />
        <Input
          value={impact}
          maxLength={1000}
          placeholder="Downstream impact (optional)"
          onChange={(e) => setImpact(e.currentTarget.value)}
          className="h-7 text-2xs"
        />
        <Button
          size="sm"
          className="h-7 text-2xs"
          disabled={busy || !title.trim() || !choice.trim()}
          onClick={handleCreate}
        >
          Confirm Decision
        </Button>
      </div>
    </div>
  );
}
