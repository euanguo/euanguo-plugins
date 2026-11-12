/**
 * Where a feature's requirement, references and decision log are stored.
 *
 * One row per feature in `feature_briefs`, one row per reference, one row per
 * decision. The decision log is keyed by `(feature_id, seq)` and never rewrites
 * a confirmed record: superseding one updates its status and `superseded_by`,
 * then writes a new row. That is what keeps the chain readable after the fact.
 *
 * Every read is validated rather than trusted. A row written by an older build,
 * or edited by hand, degrades to an empty field instead of reaching the UI or
 * `AGENTS.md` as something that cannot be rendered.
 */

import type Database from "better-sqlite3";

import {
  EMPTY_BRIEF,
  MAX_DECISIONS,
  MAX_REFS,
  summaryOf,
  validDecisionAuthor,
  validDecisionStatus,
  validRefKind,
  validUrl,
  type DecisionAuthor,
  type DecisionInput,
  type DecisionStatus,
  type FeatureBrief,
  type FeatureDecision,
  type FeatureMeta,
  type FeatureMetaSummary,
  type FeatureRef,
  type RefInput,
} from "./feature-meta.ts";

export const FEATURE_BRIEF_MIGRATION = `CREATE TABLE IF NOT EXISTS feature_briefs (
  feature_id     TEXT PRIMARY KEY,
  goal           TEXT NOT NULL DEFAULT '',
  non_goals      TEXT NOT NULL DEFAULT '',
  acceptance     TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  open_questions TEXT NOT NULL DEFAULT '[]',
  blockers       TEXT NOT NULL DEFAULT '[]',
  updated_at     INTEGER NOT NULL
)`;

export const FEATURE_REF_MIGRATION = `CREATE TABLE IF NOT EXISTS feature_refs (
  id         TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  ref_id     TEXT,
  url        TEXT,
  title      TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;

export const FEATURE_REF_INDEX_MIGRATION = `CREATE INDEX IF NOT EXISTS feature_refs_feature_idx
  ON feature_refs (feature_id, created_at)`;

export const FEATURE_DECISION_MIGRATION = `CREATE TABLE IF NOT EXISTS feature_decisions (
  id             TEXT PRIMARY KEY,
  feature_id     TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  title          TEXT NOT NULL,
  choice         TEXT NOT NULL,
  rationale      TEXT NOT NULL DEFAULT '',
  alternatives   TEXT NOT NULL DEFAULT '[]',
  impact         TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL,
  author         TEXT NOT NULL,
  thread_id      TEXT,
  supersedes     INTEGER,
  superseded_by  INTEGER,
  created_at     INTEGER NOT NULL,
  UNIQUE (feature_id, seq)
)`;

export const FEATURE_DECISION_INDEX_MIGRATION = `CREATE INDEX IF NOT EXISTS feature_decisions_feature_idx
  ON feature_decisions (feature_id, seq)`;

/** Appended to the feature journal; never inserted above an applied statement. */
export const FEATURE_META_MIGRATIONS = [
  FEATURE_BRIEF_MIGRATION,
  FEATURE_REF_MIGRATION,
  FEATURE_REF_INDEX_MIGRATION,
  FEATURE_DECISION_MIGRATION,
  FEATURE_DECISION_INDEX_MIGRATION,
] as const;

interface BriefRow {
  goal: unknown;
  non_goals: unknown;
  acceptance: unknown;
  notes: unknown;
  open_questions: unknown;
  blockers: unknown;
  updated_at: unknown;
}

interface RefRow {
  id: unknown;
  feature_id: unknown;
  kind: unknown;
  ref_id: unknown;
  url: unknown;
  title: unknown;
  created_at: unknown;
}

interface DecisionRow {
  id: unknown;
  feature_id: unknown;
  seq: unknown;
  title: unknown;
  choice: unknown;
  rationale: unknown;
  alternatives: unknown;
  impact: unknown;
  status: unknown;
  author: unknown;
  thread_id: unknown;
  supersedes: unknown;
  superseded_by: unknown;
  created_at: unknown;
}

export interface FeatureMetaStore {
  brief(featureId: string): FeatureBrief;
  setBrief(featureId: string, brief: Omit<FeatureBrief, "updatedAt">): boolean;
  refs(featureId: string): FeatureRef[];
  addRef(featureId: string, input: RefInput): FeatureRef | null;
  removeRef(featureId: string, refId: string): boolean;
  decisions(featureId: string): FeatureDecision[];
  addDecision(input: {
    featureId: string;
    decision: DecisionInput;
    status: DecisionStatus;
    author: DecisionAuthor;
    threadId: string | null;
  }): FeatureDecision | null;
  confirmDecision(featureId: string, decisionId: string): boolean;
  removeDraft(featureId: string, decisionId: string): boolean;
  meta(featureId: string): FeatureMeta;
  summary(featureId: string): FeatureMetaSummary;
  summaries(featureIds: readonly string[]): Record<string, FeatureMetaSummary>;
}

export function createFeatureMetaStore(db: Database.Database): FeatureMetaStore {
  const brief = (featureId: string): FeatureBrief => {
    const row = db
      .prepare(
        `SELECT goal, non_goals, acceptance, notes, open_questions, blockers, updated_at
           FROM feature_briefs WHERE feature_id = ?`,
      )
      .get(featureId) as BriefRow | undefined;
    if (row === undefined) return EMPTY_BRIEF;
    return {
      goal: textOf(row.goal),
      nonGoals: textOf(row.non_goals),
      acceptance: textOf(row.acceptance),
      notes: textOf(row.notes),
      openQuestions: listOf(row.open_questions),
      blockers: listOf(row.blockers),
      updatedAt:
        typeof row.updated_at === "number" && Number.isFinite(row.updated_at)
          ? row.updated_at
          : null,
    };
  };

  const setBrief: FeatureMetaStore["setBrief"] = (featureId, input) => {
    if (featureId.trim().length === 0) return false;
    db.prepare(
      `INSERT INTO feature_briefs
         (feature_id, goal, non_goals, acceptance, notes, open_questions, blockers, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(feature_id) DO UPDATE SET
         goal = excluded.goal,
         non_goals = excluded.non_goals,
         acceptance = excluded.acceptance,
         notes = excluded.notes,
         open_questions = excluded.open_questions,
         blockers = excluded.blockers,
         updated_at = excluded.updated_at`,
    ).run(
      featureId,
      input.goal,
      input.nonGoals,
      input.acceptance,
      input.notes,
      JSON.stringify(input.openQuestions),
      JSON.stringify(input.blockers),
      Date.now(),
    );
    return true;
  };

  const refs = (featureId: string): FeatureRef[] => {
    const rows = db
      .prepare(
        `SELECT id, feature_id, kind, ref_id, url, title, created_at
           FROM feature_refs WHERE feature_id = ? ORDER BY created_at ASC`,
      )
      .all(featureId) as RefRow[];
    return rows.flatMap((row) => {
      if (typeof row.id !== "string" || typeof row.title !== "string") return [];
      return [
        {
          id: row.id,
          featureId,
          // A hand-edited or older row keeps its link; only the label degrades.
          kind: validRefKind(row.kind) ? row.kind : "link",
          refId: typeof row.ref_id === "string" ? row.ref_id : null,
          url:
            typeof row.url === "string" && validUrl(row.url) ? row.url : null,
          title: row.title,
          createdAt:
            typeof row.created_at === "number" ? row.created_at : Date.now(),
        },
      ];
    });
  };

  const addRef: FeatureMetaStore["addRef"] = (featureId, input) => {
    if (featureId.trim().length === 0) return null;
    if (refs(featureId).length >= MAX_REFS) return null;
    const id = newId();
    db.prepare(
      `INSERT INTO feature_refs (id, feature_id, kind, ref_id, url, title, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      featureId,
      input.kind,
      input.refId,
      input.url,
      input.title,
      Date.now(),
    );
    return refs(featureId).find((ref) => ref.id === id) ?? null;
  };

  const removeRef: FeatureMetaStore["removeRef"] = (featureId, refId) => {
    const result = db
      .prepare(`DELETE FROM feature_refs WHERE feature_id = ? AND id = ?`)
      .run(featureId, refId);
    return result.changes > 0;
  };

  const decisions = (featureId: string): FeatureDecision[] => {
    const rows = db
      .prepare(
        `SELECT id, feature_id, seq, title, choice, rationale, alternatives, impact,
                status, author, thread_id, supersedes, superseded_by, created_at
           FROM feature_decisions WHERE feature_id = ? ORDER BY seq ASC`,
      )
      .all(featureId) as DecisionRow[];
    return rows.flatMap((row) => {
      if (
        typeof row.id !== "string" ||
        typeof row.seq !== "number" ||
        typeof row.title !== "string" ||
        typeof row.choice !== "string" ||
        !validDecisionStatus(row.status) ||
        !validDecisionAuthor(row.author)
      ) {
        return [];
      }
      return [
        {
          id: row.id,
          featureId,
          seq: row.seq,
          title: row.title,
          choice: row.choice,
          rationale: textOf(row.rationale),
          alternativesRejected: listOf(row.alternatives),
          impact: textOf(row.impact),
          status: row.status,
          author: row.author,
          threadId: typeof row.thread_id === "string" ? row.thread_id : null,
          supersedes:
            typeof row.supersedes === "number" ? row.supersedes : null,
          supersededBy:
            typeof row.superseded_by === "number" ? row.superseded_by : null,
          createdAt:
            typeof row.created_at === "number" ? row.created_at : Date.now(),
        },
      ];
    });
  };

  /**
   * The next free sequence number.
   *
   * Read inside the write transaction, so two writers cannot both see the same
   * "next" and collide on `(feature_id, seq)`.
   */
  const nextSeq = (featureId: string): number => {
    const row = db
      .prepare(
        `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM feature_decisions WHERE feature_id = ?`,
      )
      .get(featureId) as { next: number } | undefined;
    return row?.next ?? 1;
  };

  const decisionCount = (featureId: string): number => {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM feature_decisions WHERE feature_id = ?`,
      )
      .get(featureId) as { count: number } | undefined;
    return row?.count ?? 0;
  };

  const supersedable = (featureId: string, seq: number): boolean => {
    const row = db
      .prepare(
        `SELECT status, superseded_by FROM feature_decisions
          WHERE feature_id = ? AND seq = ?`,
      )
      .get(featureId, seq) as
      | { status: unknown; superseded_by: unknown }
      | undefined;
    return (
      row !== undefined &&
      row.status === "confirmed" &&
      row.superseded_by === null
    );
  };

  const markSuperseded = (featureId: string, seq: number, by: number): void => {
    db.prepare(
      `UPDATE feature_decisions
          SET status = 'superseded', superseded_by = ?
        WHERE feature_id = ? AND seq = ?`,
    ).run(by, featureId, seq);
  };

  const addDecision: FeatureMetaStore["addDecision"] = (input) => {
    const { featureId, decision, status, author, threadId } = input;
    if (!validDecisionStatus(status) || !validDecisionAuthor(author)) return null;
    if (decisionCount(featureId) >= MAX_DECISIONS) return null;
    const id = newId();
    const write = db.transaction(() => {
      if (
        status === "confirmed" &&
        decision.supersedes !== null &&
        !supersedable(featureId, decision.supersedes)
      ) {
        return false;
      }
      const seq = nextSeq(featureId);
      db.prepare(
        `INSERT INTO feature_decisions
           (id, feature_id, seq, title, choice, rationale, alternatives, impact,
            status, author, thread_id, supersedes, superseded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      ).run(
        id,
        featureId,
        seq,
        decision.title,
        decision.choice,
        decision.rationale,
        JSON.stringify(decision.alternativesRejected),
        decision.impact,
        status,
        author,
        threadId,
        decision.supersedes,
        Date.now(),
      );
      if (status === "confirmed" && decision.supersedes !== null) {
        markSuperseded(featureId, decision.supersedes, seq);
      }
      return true;
    });
    if (!write()) return null;
    return decisions(featureId).find((entry) => entry.id === id) ?? null;
  };

  const confirmDecision: FeatureMetaStore["confirmDecision"] = (
    featureId,
    decisionId,
  ) => {
    const draft = decisions(featureId).find(
      (decision) => decision.id === decisionId,
    );
    if (draft === undefined || draft.status !== "draft") return false;
    const write = db.transaction(() => {
      if (
        draft.supersedes !== null &&
        !supersedable(featureId, draft.supersedes)
      ) {
        return false;
      }
      db.prepare(
        `UPDATE feature_decisions SET status = 'confirmed' WHERE feature_id = ? AND id = ?`,
      ).run(featureId, decisionId);
      if (draft.supersedes !== null) {
        markSuperseded(featureId, draft.supersedes, draft.seq);
      }
      return true;
    });
    return write();
  };

  const removeDraft: FeatureMetaStore["removeDraft"] = (
    featureId,
    decisionId,
  ) => {
    const result = db
      .prepare(
        `DELETE FROM feature_decisions
          WHERE feature_id = ? AND id = ? AND status = 'draft'`,
      )
      .run(featureId, decisionId);
    return result.changes > 0;
  };

  const meta = (featureId: string): FeatureMeta => ({
    brief: brief(featureId),
    refs: refs(featureId),
    decisions: decisions(featureId),
  });

  const summary = (featureId: string): FeatureMetaSummary =>
    summaryOf(meta(featureId));

  const summaries = (
    featureIds: readonly string[],
  ): Record<string, FeatureMetaSummary> => {
    const out: Record<string, FeatureMetaSummary> = {};
    for (const featureId of featureIds) out[featureId] = summary(featureId);
    return out;
  };

  return {
    brief,
    setBrief,
    refs,
    addRef,
    removeRef,
    decisions,
    addDecision,
    confirmDecision,
    removeDraft,
    meta,
    summary,
    summaries,
  };
}

/** Parsed from `readRefInput`, so the caller never stores an unchecked shape. */
function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function listOf(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}
