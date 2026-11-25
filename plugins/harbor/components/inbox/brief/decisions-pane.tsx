import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DialogActions, Field } from "@/components/ui/control";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  activeDecisions,
  type FeatureDecision,
} from "@/lib/domain/feature-meta";

export interface DecisionDraft {
  title: string;
  choice: string;
  rationale: string;
  alternatives: string;
  impact: string;
  supersedes: number | null;
}

export const EMPTY_DECISION: DecisionDraft = {
  title: "",
  choice: "",
  rationale: "",
  alternatives: "",
  impact: "",
  supersedes: null,
};

export function DecisionsPane({
  decisions,
  decisionDraft,
  addingDecision,
  busy,
  onDraftChange,
  onStart,
  onCancel,
  onSubmit,
  onConfirm,
  onDiscard,
  onSupersede,
}: {
  decisions: readonly FeatureDecision[];
  decisionDraft: DecisionDraft;
  addingDecision: boolean;
  busy: boolean;
  onDraftChange: (patch: Partial<DecisionDraft>) => void;
  onStart: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  onConfirm: (decision: FeatureDecision) => void;
  onDiscard: (decision: FeatureDecision) => void;
  onSupersede: (decision: FeatureDecision) => void;
}) {
  const confirmed = activeDecisions(decisions);

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xs text-muted-foreground">
          A decision is written once and never edited. To change one,
          record the change and supersede it, so the reasoning stays in
          order.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || addingDecision}
          onClick={onStart}
        >
          Record a decision
        </Button>
      </div>

      {addingDecision ? (
        <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3">
          <Field label="Decision">
            <Input
              value={decisionDraft.title}
              placeholder="The decision in one line."
              maxLength={200}
              onChange={(event) => onDraftChange({ title: event.target.value })}
            />
          </Field>
          <Field label="What was chosen">
            <Textarea
              rows={3}
              value={decisionDraft.choice}
              placeholder="Concretely enough that a reader can act on it."
              onChange={(event) => onDraftChange({ choice: event.target.value })}
            />
          </Field>
          <Field label="Why">
            <Textarea
              rows={3}
              value={decisionDraft.rationale}
              placeholder="The constraint that made this the right choice."
              onChange={(event) =>
                onDraftChange({ rationale: event.target.value })
              }
            />
          </Field>
          <Field label="Alternatives rejected (one per line)">
            <Textarea
              rows={2}
              value={decisionDraft.alternatives}
              placeholder="What else was considered, and what ruled it out."
              onChange={(event) =>
                onDraftChange({ alternatives: event.target.value })
              }
            />
          </Field>
          <Field label="Impact">
            <Textarea
              rows={2}
              value={decisionDraft.impact}
              placeholder="What this changes downstream."
              onChange={(event) => onDraftChange({ impact: event.target.value })}
            />
          </Field>
          <FieldBlock label="Supersedes">
            <Select
              value={
                decisionDraft.supersedes === null
                  ? "none"
                  : String(decisionDraft.supersedes)
              }
              onValueChange={(value) =>
                onDraftChange({
                  supersedes: value === "none" ? null : Number(value),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nothing</SelectItem>
                {confirmed.map((decision) => (
                  <SelectItem
                    key={decision.id}
                    value={String(decision.seq)}
                  >
                    {`#${decision.seq} ${decision.title}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>
          <DialogActions>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={
                busy ||
                decisionDraft.title.trim().length === 0 ||
                decisionDraft.choice.trim().length === 0
              }
              onClick={onSubmit}
            >
              Save decision
            </Button>
          </DialogActions>
        </div>
      ) : null}

      {decisions.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          No decisions recorded yet.
        </p>
      ) : (
        <div className="grid gap-2">
          {[...decisions]
            .reverse()
            .map((decision) => (
              <DecisionCard
                key={decision.id}
                decision={decision}
                busy={busy}
                onConfirm={() => onConfirm(decision)}
                onDiscard={() => onDiscard(decision)}
                onSupersede={() => onSupersede(decision)}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function DecisionCard({
  decision,
  busy,
  onConfirm,
  onDiscard,
  onSupersede,
}: {
  decision: FeatureDecision;
  busy: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
  onSupersede: () => void;
}) {
  const canSupersede =
    decision.status === "confirmed" && decision.supersededBy === null;
  return (
    <section className="rounded-md border border-border/70 p-3">
      <header className="flex items-start gap-2">
        <span className="shrink-0 font-mono text-2xs text-muted-foreground">
          #{decision.seq}
        </span>
        <span className="min-w-0 flex-1 text-xs font-semibold text-foreground">
          {decision.title}
        </span>
        <Pill
          size="sm"
          variant={decision.status === "draft" ? "outline" : "secondary"}
        >
          {decision.status}
        </Pill>
      </header>
      <p className="mt-1 whitespace-pre-wrap text-xs text-foreground/90">
        {decision.choice}
      </p>
      {decision.rationale.length > 0 ? (
        <p className="mt-1.5 whitespace-pre-wrap text-2xs text-muted-foreground">
          Why: {decision.rationale}
        </p>
      ) : null}
      {decision.alternativesRejected.length > 0 ? (
        <p className="mt-1 whitespace-pre-wrap text-2xs text-muted-foreground">
          Rejected: {decision.alternativesRejected.join(" · ")}
        </p>
      ) : null}
      {decision.impact.length > 0 ? (
        <p className="mt-1 whitespace-pre-wrap text-2xs text-muted-foreground">
          Impact: {decision.impact}
        </p>
      ) : null}
      <footer className="mt-2 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        <span>
          {decision.author === "agent" ? "Recorded by an agent" : "Recorded by you"}
          {` · ${formatDate(decision.createdAt)}`}
        </span>
        {decision.supersedes !== null ? (
          <span>supersedes #{decision.supersedes}</span>
        ) : null}
        {decision.supersededBy !== null ? (
          <span>superseded by #{decision.supersededBy}</span>
        ) : null}
        <span className="flex-1" />
        {decision.status === "draft" ? (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={onConfirm}
            >
              Confirm
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onDiscard}
            >
              Discard
            </Button>
          </>
        ) : null}
        {canSupersede ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onSupersede}
          >
            Supersede
          </Button>
        ) : null}
      </footer>
    </section>
  );
}

/**
 * A field whose control cannot live inside a `<label>`.
 *
 * `Field` wraps its children in a label, which is right for a text input and
 * wrong for a button-based Select. This keeps the same layout without the
 * wrapping element.
 */
export function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
