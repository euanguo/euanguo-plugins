import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DialogActions, Field } from "@/components/ui/control";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { BriefInput, FeaturesApi } from "@/hooks/use-features";
import type {
  FeatureBrief,
  FeatureDecision,
  FeatureMeta,
  FeatureRef,
  RefKind,
} from "@/lib/feature-meta";
import type { Feature } from "@/lib/features";

type Tab = "requirement" | "decisions" | "references";

/** What a text field holds before it is split into the list the server stores. */
interface BriefDraft {
  goal: string;
  nonGoals: string;
  acceptance: string;
  notes: string;
  openQuestions: string;
  blockers: string;
}

interface DecisionDraft {
  title: string;
  choice: string;
  rationale: string;
  alternatives: string;
  impact: string;
  supersedes: number | null;
}

interface RefDraft {
  kind: RefKind;
  url: string;
  refId: string;
  title: string;
}

const EMPTY_BRIEF_DRAFT: BriefDraft = {
  goal: "",
  nonGoals: "",
  acceptance: "",
  notes: "",
  openQuestions: "",
  blockers: "",
};

const EMPTY_DECISION: DecisionDraft = {
  title: "",
  choice: "",
  rationale: "",
  alternatives: "",
  impact: "",
  supersedes: null,
};

const EMPTY_REF: RefDraft = {
  kind: "link",
  url: "",
  refId: "",
  title: "",
};

/**
 * The requirement, the decision log and the external references of one feature.
 *
 * One dialog with three panes rather than three menus, because these are three
 * views of the same question: what is this work, why is it this shape, and
 * where did it come from. Opening it from a feature row is the way in every
 * time.
 *
 * Decisions are append-only. A confirmed record has no edit control; the way to
 * change one is to record the change and supersede it, which keeps the reason
 * the first choice was made. An agent's draft is the one thing that waits for a
 * person: Confirm is the act that turns it into a decision.
 */
export function FeatureBriefDialog({
  open,
  feature,
  initialTab,
  api,
  onClose,
}: {
  open: boolean;
  feature: Feature | null;
  initialTab?: Tab;
  api: FeaturesApi;
  onClose: () => void;
}) {
  const featureId = feature?.id ?? null;
  /**
   * The reader, taken off the API object.
   *
   * `FeaturesApi` is rebuilt whenever the sidebar re-reads, and this dialog must
   * not reset what someone is typing because a clock tick refreshed features
   * somewhere else. `getMeta` is the only member the load depends on, and it is
   * stable for the life of the hook.
   */
  const getMeta = api.getMeta;
  const [tab, setTab] = useState<Tab>(initialTab ?? "requirement");
  const [meta, setMeta] = useState<FeatureMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [brief, setBrief] = useState<BriefDraft>(EMPTY_BRIEF_DRAFT);
  const [briefLoadedFor, setBriefLoadedFor] = useState<string | null>(null);
  const [decisionDraft, setDecisionDraft] = useState<DecisionDraft>(EMPTY_DECISION);
  const [addingDecision, setAddingDecision] = useState(false);
  const [refDraft, setRefDraft] = useState<RefDraft>(EMPTY_REF);

  const load = useCallback(() => {
    if (featureId === null) return;
    setLoadError(null);
    getMeta(featureId)
      .then((next) => setMeta(next))
      .catch((failure: unknown) => setLoadError(messageOf(failure)));
  }, [getMeta, featureId]);

  useEffect(() => {
    if (!open || featureId === null) return;
    setTab(initialTab ?? "requirement");
    setMeta(null);
    setBriefLoadedFor(null);
    setBrief(EMPTY_BRIEF_DRAFT);
    setAddingDecision(false);
    setDecisionDraft(EMPTY_DECISION);
    setRefDraft(EMPTY_REF);
    setError(null);
    load();
  }, [open, featureId, initialTab, load]);

  // The saved brief seeds the fields once. A later refresh from a decision
  // write must not overwrite what someone is still typing.
  useEffect(() => {
    if (meta === null || featureId === null || briefLoadedFor === featureId) return;
    setBrief(toBriefDraft(meta.brief));
    setBriefLoadedFor(featureId);
  }, [meta, featureId, briefLoadedFor]);

  const savedBrief = useMemo(
    () => (meta === null ? null : toBriefDraft(meta.brief)),
    [meta],
  );
  const briefDirty =
    savedBrief !== null && JSON.stringify(brief) !== JSON.stringify(savedBrief);

  const confirmed = useMemo(
    () =>
      meta === null
        ? []
        : meta.decisions.filter(
            (decision) =>
              decision.status === "confirmed" && decision.supersededBy === null,
          ),
    [meta],
  );

  if (!open || feature === null) return null;

  const run = (task: () => Promise<unknown>, after: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    task()
      .then(after)
      .catch((failure: unknown) => setError(messageOf(failure)))
      .finally(() => setBusy(false));
  };

  const saveBrief = () => {
    if (featureId === null) return;
    run(
      () => api.saveBrief(featureId, toBriefInput(brief)),
      () => {
        setBriefLoadedFor(null);
        load();
      },
    );
  };

  const recordDecision = () => {
    if (featureId === null) return;
    run(
      () =>
        api.addDecision(featureId, {
          title: decisionDraft.title,
          choice: decisionDraft.choice,
          rationale: decisionDraft.rationale,
          alternatives: linesOf(decisionDraft.alternatives),
          impact: decisionDraft.impact,
          supersedes: decisionDraft.supersedes,
        }),
      () => {
        setAddingDecision(false);
        setDecisionDraft(EMPTY_DECISION);
        load();
      },
    );
  };

  const confirmDecision = (decision: FeatureDecision) => {
    if (featureId === null) return;
    run(
      () => api.confirmDecision(featureId, decision.id),
      () => load(),
    );
  };

  const discardDraft = (decision: FeatureDecision) => {
    if (featureId === null) return;
    run(
      () => api.deleteDraft(featureId, decision.id),
      () => load(),
    );
  };

  const addReference = () => {
    if (featureId === null) return;
    run(
      () =>
        api.addRef(featureId, {
          kind: refDraft.kind,
          ...(refDraft.url.trim().length === 0 ? {} : { url: refDraft.url.trim() }),
          ...(refDraft.refId.trim().length === 0
            ? {}
            : { refId: refDraft.refId.trim() }),
          ...(refDraft.title.trim().length === 0
            ? {}
            : { title: refDraft.title.trim() }),
        }),
      () => {
        setRefDraft(EMPTY_REF);
        load();
      },
    );
  };

  const removeReference = (ref: FeatureRef) => {
    if (featureId === null) return;
    run(
      () => api.removeRef(featureId, ref.id),
      () => load(),
    );
  };

  const decisionCount = meta?.decisions.length ?? 0;
  const refCount = meta?.refs.length ?? 0;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={feature.name}
      subtitle="What this work is for, the decisions that stand, and where it came from."
      icon="FileText"
      busy={busy}
      width="46rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Close
          </Button>
        </DialogActions>
      }
    >
      {loadError !== null ? (
        <p className="text-xs text-destructive">{loadError}</p>
      ) : meta === null ? (
        <p className="text-xs text-muted-foreground">Reading the requirement…</p>
      ) : (
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="requirement">Requirement</TabsTrigger>
            <TabsTrigger value="decisions">
              Decisions{decisionCount > 0 ? ` · ${decisionCount}` : ""}
            </TabsTrigger>
            <TabsTrigger value="references">
              References{refCount > 0 ? ` · ${refCount}` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="requirement">
            <div className="grid gap-3">
              <Field label="Goal">
                <Textarea
                  rows={3}
                  value={brief.goal}
                  placeholder="What this work is for, in the user's words."
                  onChange={(event) =>
                    setBrief((current) => ({ ...current, goal: event.target.value }))
                  }
                />
              </Field>
              <Field label="Not this work">
                <Textarea
                  rows={2}
                  value={brief.nonGoals}
                  placeholder="What is deliberately out of scope, when saying so prevents a wrong turn."
                  onChange={(event) =>
                    setBrief((current) => ({
                      ...current,
                      nonGoals: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Acceptance">
                <Textarea
                  rows={3}
                  value={brief.acceptance}
                  placeholder="What has to be true before this is done."
                  onChange={(event) =>
                    setBrief((current) => ({
                      ...current,
                      acceptance: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Open questions (one per line)">
                <Textarea
                  rows={3}
                  value={brief.openQuestions}
                  placeholder="What still needs an answer."
                  onChange={(event) =>
                    setBrief((current) => ({
                      ...current,
                      openQuestions: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Blockers (one per line)">
                <Textarea
                  rows={2}
                  value={brief.blockers}
                  placeholder="What is stopping progress right now."
                  onChange={(event) =>
                    setBrief((current) => ({
                      ...current,
                      blockers: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Notes">
                <Textarea
                  rows={3}
                  value={brief.notes}
                  placeholder="Anything else worth carrying into every conversation."
                  onChange={(event) =>
                    setBrief((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </Field>
              <div className="flex items-center justify-end gap-2">
                {briefDirty ? (
                  <span className="text-2xs text-muted-foreground">
                    Unsaved changes
                  </span>
                ) : null}
                <Button
                  size="sm"
                  disabled={busy || !briefDirty}
                  onClick={saveBrief}
                >
                  Save requirement
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="decisions">
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
                  onClick={() => {
                    setDecisionDraft(EMPTY_DECISION);
                    setAddingDecision(true);
                  }}
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
                      onChange={(event) =>
                        setDecisionDraft((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="What was chosen">
                    <Textarea
                      rows={3}
                      value={decisionDraft.choice}
                      placeholder="Concretely enough that a reader can act on it."
                      onChange={(event) =>
                        setDecisionDraft((current) => ({
                          ...current,
                          choice: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Why">
                    <Textarea
                      rows={3}
                      value={decisionDraft.rationale}
                      placeholder="The constraint that made this the right choice."
                      onChange={(event) =>
                        setDecisionDraft((current) => ({
                          ...current,
                          rationale: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Alternatives rejected (one per line)">
                    <Textarea
                      rows={2}
                      value={decisionDraft.alternatives}
                      placeholder="What else was considered, and what ruled it out."
                      onChange={(event) =>
                        setDecisionDraft((current) => ({
                          ...current,
                          alternatives: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Impact">
                    <Textarea
                      rows={2}
                      value={decisionDraft.impact}
                      placeholder="What this changes downstream."
                      onChange={(event) =>
                        setDecisionDraft((current) => ({
                          ...current,
                          impact: event.target.value,
                        }))
                      }
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
                        setDecisionDraft((current) => ({
                          ...current,
                          supersedes: value === "none" ? null : Number(value),
                        }))
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
                      onClick={() => setAddingDecision(false)}
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
                      onClick={recordDecision}
                    >
                      Save decision
                    </Button>
                  </DialogActions>
                </div>
              ) : null}

              {meta.decisions.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  No decisions recorded yet.
                </p>
              ) : (
                <div className="grid gap-2">
                  {[...meta.decisions]
                    .reverse()
                    .map((decision) => (
                      <DecisionCard
                        key={decision.id}
                        decision={decision}
                        busy={busy}
                        onConfirm={() => confirmDecision(decision)}
                        onDiscard={() => discardDraft(decision)}
                        onSupersede={() => {
                          setDecisionDraft({
                            ...EMPTY_DECISION,
                            supersedes: decision.seq,
                          });
                          setAddingDecision(true);
                        }}
                      />
                    ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="references">
            <div className="grid gap-3">
              {meta.refs.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  No references yet.
                </p>
              ) : (
                <ul className="grid gap-1.5">
                  {meta.refs.map((ref) => (
                    <li
                      key={ref.id}
                      className="flex items-center gap-2 rounded-md border border-border/70 px-2 py-1.5"
                    >
                      <Pill variant="outline" size="sm">
                        {refKindLabel(ref.kind)}
                      </Pill>
                      {ref.url === null ? (
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {ref.title}
                        </span>
                      ) : (
                        <a
                          href={ref.url}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 flex-1 truncate text-xs text-primary hover:underline"
                          title={ref.url}
                        >
                          {ref.title}
                        </a>
                      )}
                      {ref.refId !== null ? (
                        <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                          {ref.refId}
                        </span>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => removeReference(ref)}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3">
                <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
                  <FieldBlock label="Kind">
                    <Select
                      value={refDraft.kind}
                      onValueChange={(value) =>
                        setRefDraft((current) => ({
                          ...current,
                          kind: value as RefDraft["kind"],
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ticket">Ticket</SelectItem>
                        <SelectItem value="document">Document</SelectItem>
                        <SelectItem value="link">Link</SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldBlock>
                  <Field label="Link">
                    <Input
                      value={refDraft.url}
                      placeholder="https://…"
                      maxLength={2000}
                      onChange={(event) =>
                        setRefDraft((current) => ({
                          ...current,
                          url: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Ticket or document id">
                    <Input
                      value={refDraft.refId}
                      placeholder="TICKET-123"
                      maxLength={200}
                      onChange={(event) =>
                        setRefDraft((current) => ({
                          ...current,
                          refId: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Title">
                    <Input
                      value={refDraft.title}
                      placeholder="Optional; defaults to the id or link."
                      maxLength={300}
                      onChange={(event) =>
                        setRefDraft((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy ||
                      (refDraft.url.trim().length === 0 &&
                        refDraft.refId.trim().length === 0)
                    }
                    onClick={addReference}
                  >
                    Add reference
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
      {error !== null ? (
        <p className="mt-3 text-xs text-destructive">{error}</p>
      ) : null}
    </Modal>
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
function FieldBlock({
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

function toBriefDraft(brief: FeatureBrief): BriefDraft {
  return {
    goal: brief.goal,
    nonGoals: brief.nonGoals,
    acceptance: brief.acceptance,
    notes: brief.notes,
    openQuestions: brief.openQuestions.join("\n"),
    blockers: brief.blockers.join("\n"),
  };
}

function toBriefInput(draft: BriefDraft): BriefInput {
  return {
    goal: draft.goal,
    nonGoals: draft.nonGoals,
    acceptance: draft.acceptance,
    notes: draft.notes,
    openQuestions: linesOf(draft.openQuestions),
    blockers: linesOf(draft.blockers),
  };
}

function linesOf(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function refKindLabel(kind: RefKind): string {
  if (kind === "ticket") return "Ticket";
  if (kind === "document") return "Doc";
  return "Link";
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
