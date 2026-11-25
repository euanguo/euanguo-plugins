import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogActions } from "@/components/ui/control";
import { Modal } from "@/components/ui/modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DecisionsPane,
  EMPTY_DECISION,
  type DecisionDraft,
} from "@/components/inbox/brief/decisions-pane";
import {
  ReferencesPane,
  EMPTY_REF,
  type RefDraft,
} from "@/components/inbox/brief/references-pane";
import { RequirementPane } from "@/components/inbox/brief/requirement-pane";
import type { FeaturesApi } from "@/hooks/use-features";
import {
  EMPTY_BRIEF_DRAFT,
  linesOf,
  toBriefDraft,
  toBriefInput,
  type BriefDraft,
  type FeatureDecision,
  type FeatureMeta,
  type FeatureRef,
} from "@/lib/domain/feature-meta";
import type { Feature } from "@/lib/domain/features";

type Tab = "requirement" | "decisions" | "references";

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
            <RequirementPane
              brief={brief}
              briefDirty={briefDirty}
              busy={busy}
              onChange={(patch) =>
                setBrief((current) => ({ ...current, ...patch }))
              }
              onSave={saveBrief}
            />
          </TabsContent>

          <TabsContent value="decisions">
            <DecisionsPane
              decisions={meta.decisions}
              decisionDraft={decisionDraft}
              addingDecision={addingDecision}
              busy={busy}
              onDraftChange={(patch) =>
                setDecisionDraft((current) => ({ ...current, ...patch }))
              }
              onStart={() => {
                setDecisionDraft(EMPTY_DECISION);
                setAddingDecision(true);
              }}
              onCancel={() => setAddingDecision(false)}
              onSubmit={recordDecision}
              onConfirm={confirmDecision}
              onDiscard={discardDraft}
              onSupersede={(decision) => {
                setDecisionDraft({
                  ...EMPTY_DECISION,
                  supersedes: decision.seq,
                });
                setAddingDecision(true);
              }}
            />
          </TabsContent>

          <TabsContent value="references">
            <ReferencesPane
              refs={meta.refs}
              refDraft={refDraft}
              busy={busy}
              onDraftChange={(patch) =>
                setRefDraft((current) => ({ ...current, ...patch }))
              }
              onAdd={addReference}
              onRemove={removeReference}
            />
          </TabsContent>
        </Tabs>
      )}
      {error !== null ? (
        <p className="mt-3 text-xs text-destructive">{error}</p>
      ) : null}
    </Modal>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
