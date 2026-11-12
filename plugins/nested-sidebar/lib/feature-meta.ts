/**
 * What a feature knows about the work besides where it lives.
 *
 * A feature is a directory, and every fact about *which* worktrees and threads
 * belong to it is read from disk. The four things here are the opposite kind of
 * fact: they cannot be derived from anywhere, because they exist only in
 * someone's head until they are written down.
 *
 * - the requirement: what this work is for, and what would make it done;
 * - the references: the ticket or document the work answers to;
 * - the decisions: what was chosen, why, and what was rejected;
 * - the open questions and blockers: what is still unresolved.
 *
 * The decision log is append-only in the way that matters. A confirmed record is
 * never edited; overturning it writes a new record that points at the old one,
 * so the reasoning stays readable in order. Agents may write drafts, because a
 * model can notice a decision point; only a person confirms one, because only a
 * person can say the decision is theirs.
 *
 * Everything is bounded. These strings end up in `AGENTS.md`, which every
 * conversation in the feature reads, so an unbounded field is context spent
 * before the work starts.
 */

export const MAX_BRIEF_FIELD_LENGTH = 4_000;
export const MAX_BRIEF_ITEM_LENGTH = 500;
export const MAX_BRIEF_ITEMS = 20;
export const MAX_REF_TITLE_LENGTH = 300;
export const MAX_REF_ID_LENGTH = 200;
export const MAX_REF_URL_LENGTH = 2_000;
export const MAX_REFS = 20;
export const MAX_DECISION_TITLE_LENGTH = 200;
export const MAX_DECISION_CHOICE_LENGTH = 4_000;
export const MAX_DECISION_RATIONALE_LENGTH = 8_000;
export const MAX_DECISION_IMPACT_LENGTH = 2_000;
export const MAX_DECISION_ALTERNATIVE_LENGTH = 500;
export const MAX_DECISION_ALTERNATIVES = 10;
export const MAX_DECISIONS = 200;

/** How much of a feature's story is written into `AGENTS.md`. */
export const SUMMARY_DECISION_LIMIT = 8;
export const SUMMARY_QUESTION_LIMIT = 6;
export const SUMMARY_BLOCKER_LIMIT = 4;
export const SUMMARY_REF_LIMIT = 6;
export const SUMMARY_TEXT_LIMIT = 700;
export const SUMMARY_TOTAL_LIMIT = 6_000;

/** Everything but tab and newline: those are how a multi-line field is read. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

/** One field of the requirement. Empty string means "not written yet". */
export interface FeatureBrief {
  readonly goal: string;
  readonly nonGoals: string;
  readonly acceptance: string;
  readonly notes: string;
  readonly openQuestions: readonly string[];
  readonly blockers: readonly string[];
  readonly updatedAt: number | null;
}

export const EMPTY_BRIEF: FeatureBrief = {
  goal: "",
  nonGoals: "",
  acceptance: "",
  notes: "",
  openQuestions: [],
  blockers: [],
  updatedAt: null,
};

export const REF_KINDS = ["ticket", "document", "link"] as const;
export type RefKind = (typeof REF_KINDS)[number];

export interface FeatureRef {
  readonly id: string;
  readonly featureId: string;
  readonly kind: RefKind;
  /** The ticket or document number, when the URL carries one. */
  readonly refId: string | null;
  readonly url: string | null;
  readonly title: string;
  readonly createdAt: number;
}

export const DECISION_STATUSES = ["draft", "confirmed", "superseded"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const DECISION_AUTHORS = ["human", "agent"] as const;
export type DecisionAuthor = (typeof DECISION_AUTHORS)[number];

export interface FeatureDecision {
  readonly id: string;
  readonly featureId: string;
  /** Per-feature and permanent: the handle a later record supersedes. */
  readonly seq: number;
  readonly title: string;
  readonly choice: string;
  readonly rationale: string;
  readonly alternativesRejected: readonly string[];
  readonly impact: string;
  readonly status: DecisionStatus;
  readonly author: DecisionAuthor;
  /** The conversation that recorded it, when an agent did. */
  readonly threadId: string | null;
  readonly supersedes: number | null;
  readonly supersededBy: number | null;
  readonly createdAt: number;
}

/** Everything the feature carries besides its folder. */
export interface FeatureMeta {
  readonly brief: FeatureBrief;
  readonly refs: readonly FeatureRef[];
  readonly decisions: readonly FeatureDecision[];
}

export const EMPTY_META: FeatureMeta = {
  brief: EMPTY_BRIEF,
  refs: [],
  decisions: [],
};

/**
 * The compact form the sidebar draws.
 *
 * A feature row cannot hold every record, and opening the dialog should be the
 * only thing that reads them. This is what the row and the hover card need.
 */
export interface FeatureMetaSummary {
  readonly decisionCount: number;
  /** Confirmed and not superseded: the decisions that still stand. */
  readonly activeDecisionCount: number;
  readonly draftCount: number;
  readonly refCount: number;
  readonly openQuestionCount: number;
  readonly blockerCount: number;
  /** A goal or an acceptance note exists. */
  readonly hasRequirement: boolean;
  readonly acceptanceSet: boolean;
  readonly lastDecisionAt: number | null;
}

export const EMPTY_META_SUMMARY: FeatureMetaSummary = {
  decisionCount: 0,
  activeDecisionCount: 0,
  draftCount: 0,
  refCount: 0,
  openQuestionCount: 0,
  blockerCount: 0,
  hasRequirement: false,
  acceptanceSet: false,
  lastDecisionAt: null,
};

/** The decisions that still stand: confirmed and not superseded. */
export function activeDecisions(
  decisions: readonly FeatureDecision[],
): FeatureDecision[] {
  return decisions.filter(
    (decision) =>
      decision.status === "confirmed" && decision.supersededBy === null,
  );
}

export function summaryOf(input: {
  readonly brief: FeatureBrief;
  readonly refs: readonly FeatureRef[];
  readonly decisions: readonly FeatureDecision[];
}): FeatureMetaSummary {
  const active = activeDecisions(input.decisions);
  const draftCount = input.decisions.filter(
    (decision) => decision.status === "draft",
  ).length;
  const lastDecisionAt = input.decisions.reduce<number | null>(
    (latest, decision) =>
      latest === null || decision.createdAt > latest
        ? decision.createdAt
        : latest,
    null,
  );
  return {
    decisionCount: input.decisions.length,
    activeDecisionCount: active.length,
    draftCount,
    refCount: input.refs.length,
    openQuestionCount: input.brief.openQuestions.length,
    blockerCount: input.brief.blockers.length,
    hasRequirement:
      input.brief.goal.trim().length > 0 ||
      input.brief.acceptance.trim().length > 0 ||
      input.brief.nonGoals.trim().length > 0,
    acceptanceSet: input.brief.acceptance.trim().length > 0,
    lastDecisionAt,
  };
}

/** Trimmed text with control characters removed, capped at `max`. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\r\n?/gu, "\n")
    .trim()
    .slice(0, max);
}

/** A list typed one item per line, or an array, cleaned and deduplicated. */
export function cleanList(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] {
  const raw =
    typeof value === "string"
      ? value.split("\n")
      : Array.isArray(value)
        ? value
        : [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of raw) {
    const text = cleanText(entry, maxLength);
    if (text.length === 0 || seen.has(text)) continue;
    seen.add(text);
    items.push(text);
    if (items.length === maxItems) break;
  }
  return items;
}

/** A brief from whatever the caller sent, with each field bounded. */
export function readBriefInput(input: {
  readonly goal?: unknown;
  readonly nonGoals?: unknown;
  readonly acceptance?: unknown;
  readonly notes?: unknown;
  readonly openQuestions?: unknown;
  readonly blockers?: unknown;
}): Omit<FeatureBrief, "updatedAt"> {
  return {
    goal: cleanText(input.goal, MAX_BRIEF_FIELD_LENGTH),
    nonGoals: cleanText(input.nonGoals, MAX_BRIEF_FIELD_LENGTH),
    acceptance: cleanText(input.acceptance, MAX_BRIEF_FIELD_LENGTH),
    notes: cleanText(input.notes, MAX_BRIEF_FIELD_LENGTH),
    openQuestions: cleanList(
      input.openQuestions,
      MAX_BRIEF_ITEMS,
      MAX_BRIEF_ITEM_LENGTH,
    ),
    blockers: cleanList(input.blockers, MAX_BRIEF_ITEMS, MAX_BRIEF_ITEM_LENGTH),
  };
}

export function newMetaId(): string {
  return globalThis.crypto.randomUUID();
}

export function validRefKind(value: unknown): value is RefKind {
  return (
    typeof value === "string" && (REF_KINDS as readonly string[]).includes(value)
  );
}

export function validDecisionStatus(value: unknown): value is DecisionStatus {
  return (
    typeof value === "string" &&
    (DECISION_STATUSES as readonly string[]).includes(value)
  );
}

export function validDecisionAuthor(value: unknown): value is DecisionAuthor {
  return (
    typeof value === "string" &&
    (DECISION_AUTHORS as readonly string[]).includes(value)
  );
}

/** An http(s) URL, as the one thing a reference is allowed to point at. */
export function validUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export interface RefInput {
  readonly kind: RefKind;
  readonly refId: string | null;
  readonly url: string | null;
  readonly title: string;
}

/**
 * A reference, or null when it could not be one.
 *
 * A URL is optional so a ticket number can be filed before someone has the
 * link, but a reference with neither a URL nor a ticket number is a title with
 * nothing to follow. The kind is the caller's; nothing is inferred from a host
 * name, because the same product can live on any domain.
 */
export function readRefInput(input: {
  readonly kind?: unknown;
  readonly refId?: unknown;
  readonly url?: unknown;
  readonly title?: unknown;
}): RefInput | null {
  const urlText = cleanText(input.url, MAX_REF_URL_LENGTH);
  const refId = cleanText(input.refId, MAX_REF_ID_LENGTH);
  if (urlText.length > 0 && !validUrl(urlText)) return null;
  if (urlText.length === 0 && refId.length === 0) return null;
  const kind = validRefKind(input.kind) ? input.kind : "link";
  const title = cleanText(input.title, MAX_REF_TITLE_LENGTH);
  return {
    kind,
    refId: refId.length > 0 ? refId : null,
    url: urlText.length > 0 ? urlText : null,
    title:
      title.length > 0
        ? title
        : refId.length > 0
          ? refId
          : urlText,
  };
}

export interface DecisionInput {
  readonly title: string;
  readonly choice: string;
  readonly rationale: string;
  readonly alternativesRejected: readonly string[];
  readonly impact: string;
  readonly supersedes: number | null;
}

/** A decision's content, or null when the required halves are missing. */
export function readDecisionInput(input: {
  readonly title?: unknown;
  readonly choice?: unknown;
  readonly rationale?: unknown;
  readonly alternatives?: unknown;
  readonly impact?: unknown;
  readonly supersedes?: unknown;
}): DecisionInput | null {
  const title = cleanText(input.title, MAX_DECISION_TITLE_LENGTH);
  const choice = cleanText(input.choice, MAX_DECISION_CHOICE_LENGTH);
  if (title.length === 0 || choice.length === 0) return null;
  const supersedes =
    typeof input.supersedes === "number" &&
    Number.isInteger(input.supersedes) &&
    input.supersedes > 0
      ? input.supersedes
      : null;
  return {
    title,
    choice,
    rationale: cleanText(input.rationale, MAX_DECISION_RATIONALE_LENGTH),
    alternativesRejected: cleanList(
      input.alternatives,
      MAX_DECISION_ALTERNATIVES,
      MAX_DECISION_ALTERNATIVE_LENGTH,
    ),
    impact: cleanText(input.impact, MAX_DECISION_IMPACT_LENGTH),
    supersedes,
  };
}

/**
 * Block markers made harmless.
 *
 * A decision is written by whoever is doing the work, and it lands inside
 * `AGENTS.md` between Nest's markers. A title that happens to contain the end
 * marker would otherwise close the block early, and the next rewrite would
 * treat everything after it as the person's text. Escaping the two sequences is
 * enough; Markdown renders them back as the characters that were typed.
 */
export function neutralizeBlockMarkers(value: string): string {
  return value.replaceAll("<!--", "&lt;!--").replaceAll("-->", "--&gt;");
}
