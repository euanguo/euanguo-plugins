/**
 * The writes on what a feature knows, separate from what it contains.
 *
 * The feature service owns folders, worktrees and threads; this owns the four
 * things that exist only because someone wrote them down. They share one rule:
 * the database is written first, then `AGENTS.md` is rewritten from it, then
 * the sidebar is told to re-read. A host that cannot be reached is logged by
 * `writeContext` and never rolls the record back.
 *
 * The decision rule lives here as well. A confirmed record is never edited;
 * superseding one updates its status and writes a new record. An agent may add
 * a record, but it arrives as a draft — the confirmation is a person's act, and
 * this is the seam that enforces it.
 */

import type { Feature, FeatureMember } from "../lib/features.ts";
import {
  readBriefInput,
  readDecisionInput,
  readRefInput,
  type DecisionAuthor,
  type DecisionStatus,
  type FeatureBrief,
  type FeatureDecision,
  type FeatureMeta,
  type FeatureMetaSummary,
  type FeatureRef,
} from "../lib/feature-meta.ts";
import type { FeatureMetaStore } from "../lib/feature-meta-store.ts";

export class FeatureMetaError extends Error {}

export interface FeatureMetaServiceDeps {
  readonly metaStore: FeatureMetaStore;
  /** The feature, or undefined when it was deleted between two calls. */
  readonly findFeature: (featureId: string) => Feature | undefined;
  readonly membersOf: (featureId: string) => readonly FeatureMember[];
  readonly writeContext: (
    feature: Feature,
    members: readonly FeatureMember[],
  ) => Promise<boolean>;
  readonly publish: () => void;
  /** Update the sidebar's counts without a host scan. */
  readonly setSummary: (featureId: string, summary: FeatureMetaSummary) => void;
}

export function createFeatureMetaService(deps: FeatureMetaServiceDeps) {
  const { metaStore, findFeature, membersOf, writeContext, publish, setSummary } =
    deps;

  const afterWrite = async (featureId: string): Promise<void> => {
    const feature = findFeature(featureId);
    if (feature !== undefined) await writeContext(feature, membersOf(featureId));
    setSummary(featureId, metaStore.summary(featureId));
    publish();
  };

  const requireFeature = (featureId: string): void => {
    if (findFeature(featureId) === undefined) {
      throw new FeatureMetaError("That feature no longer exists.");
    }
  };

  const meta = (featureId: string): FeatureMeta => {
    requireFeature(featureId);
    return metaStore.meta(featureId);
  };

  const setBrief = async (
    featureId: string,
    input: Parameters<typeof readBriefInput>[0],
  ): Promise<FeatureBrief> => {
    requireFeature(featureId);
    const brief = readBriefInput(input);
    if (!metaStore.setBrief(featureId, brief)) {
      throw new FeatureMetaError("That requirement could not be saved.");
    }
    await afterWrite(featureId);
    return metaStore.brief(featureId);
  };

  const addRef = async (
    featureId: string,
    input: Parameters<typeof readRefInput>[0],
  ): Promise<FeatureRef> => {
    requireFeature(featureId);
    const ref = readRefInput(input);
    if (ref === null) {
      throw new FeatureMetaError(
        "A reference needs an http(s) link or a ticket number.",
      );
    }
    const added = metaStore.addRef(featureId, ref);
    if (added === null) {
      throw new FeatureMetaError(
        "That feature already has the most references it can hold.",
      );
    }
    await afterWrite(featureId);
    return added;
  };

  const removeRef = async (
    featureId: string,
    refId: string,
  ): Promise<boolean> => {
    requireFeature(featureId);
    const removed = metaStore.removeRef(featureId, refId);
    if (removed) await afterWrite(featureId);
    return removed;
  };

  const addDecision = async (input: {
    readonly featureId: string;
    readonly title: string;
    readonly choice: string;
    readonly rationale: string;
    readonly alternatives: unknown;
    readonly impact: string;
    readonly supersedes: number | null;
    readonly status: DecisionStatus;
    readonly author: DecisionAuthor;
    readonly threadId: string | null;
  }): Promise<FeatureDecision> => {
    requireFeature(input.featureId);
    const decision = readDecisionInput(input);
    if (decision === null) {
      throw new FeatureMetaError(
        "A decision needs a title and the choice that was made.",
      );
    }
    // An agent may find the decision point; only a person can make the
    // decision. Forcing the status here means a caller cannot opt out by
    // passing `confirmed`.
    const status: DecisionStatus =
      input.author === "agent" ? "draft" : input.status;
    const added = metaStore.addDecision({
      featureId: input.featureId,
      decision,
      status,
      author: input.author,
      threadId: input.threadId,
    });
    if (added === null) {
      throw new FeatureMetaError(
        "That decision could not be saved: the log is full, or the decision it supersedes has already been superseded.",
      );
    }
    await afterWrite(input.featureId);
    return added;
  };

  const confirmDecision = async (
    featureId: string,
    decisionId: string,
  ): Promise<boolean> => {
    requireFeature(featureId);
    const confirmed = metaStore.confirmDecision(featureId, decisionId);
    if (confirmed) await afterWrite(featureId);
    return confirmed;
  };

  const removeDraft = async (
    featureId: string,
    decisionId: string,
  ): Promise<boolean> => {
    requireFeature(featureId);
    const removed = metaStore.removeDraft(featureId, decisionId);
    if (removed) await afterWrite(featureId);
    return removed;
  };

  return {
    meta,
    setBrief,
    addRef,
    removeRef,
    addDecision,
    confirmDecision,
    removeDraft,
  };
}

export type FeatureMetaService = ReturnType<typeof createFeatureMetaService>;
