import type DatabaseType from "better-sqlite3";
import {
  readFeatureState,
  validFeatureId,
  validFeatureName,
  validFeatureSlug,
  type FeatureState,
} from "../domain/features.ts";
import { canonicalGroupIcon, type GroupIconName } from "../domain/group-icons.ts";
import { validGroupId, validGroupName } from "../domain/groups.ts";
import {
  parseItemIds,
  serializeItemIds,
  validOrderId,
} from "../domain/manual-order.ts";
import { canonicalProjectColor, validProjectId } from "../domain/project-colors.ts";
import { MAX_GROUP_ID_LENGTH } from "../schemas/sidebar.ts";
import { parseJsonStringArray } from "./sqlite-helpers.ts";

const VALID_ORDER_SCOPE_KINDS = new Set([
  "group",
  "project",
  "pinned",
  "workspace",
]);

export interface ParsedSourceSnapshot {
  readonly groups: Array<{
    id: string;
    name: string;
    icon: GroupIconName;
    updatedAt: number;
  }>;
  readonly memberships: Array<{
    projectId: string;
    groupId: string;
    updatedAt: number;
  }>;
  readonly manualOrders: Array<{
    scopeKind: string;
    scopeId: string;
    itemIdsJson: string;
    updatedAt: number;
  }>;
  readonly badgeColors: Array<{
    projectId: string;
    color: string;
    updatedAt: number;
  }>;
  readonly lifecycle: Array<{
    threadId: string;
    settledAt: number | null;
    snoozedUntil: number | null;
    snoozedAt: number | null;
    archivedJson: string | null;
  }>;
  readonly features: Array<{
    id: string;
    name: string;
    slug: string;
    state: FeatureState;
    rootPath: string | null;
    hostId: string | null;
    createdAt: number | null;
    updatedAt: number;
  }>;
  readonly containers: Array<{ path: string; updatedAt: number }>;
  readonly featureBranches: Array<{
    featureId: string;
    repositoryPath: string;
    hostId: string;
    branch: string;
    createdAt: number;
  }>;
  readonly featureAdoptions: Array<{
    environmentId: string;
    featureId: string;
    updatedAt: number;
  }>;
  readonly featureBriefs: Array<{
    featureId: string;
    goal: string;
    nonGoals: string;
    acceptance: string;
    notes: string;
    openQuestions: string;
    blockers: string;
    updatedAt: number;
  }>;
  readonly featureDecisions: Array<{
    id: string;
    featureId: string;
    seq: number;
    title: string;
    choice: string;
    rationale: string;
    alternatives: string;
    impact: string;
    status: string;
    author: string;
    threadId: string | null;
    supersedes: number | null;
    supersededBy: number | null;
    createdAt: number;
  }>;
  readonly featureRefs: Array<{
    id: string;
    featureId: string;
    kind: string;
    refId: string | null;
    url: string | null;
    title: string;
    createdAt: number;
  }>;
}

export interface TargetMigrationIds {
  readonly existingGroupIds: Set<string>;
  readonly existingMemberProjects: Set<string>;
  readonly existingOrders: Set<string>;
  readonly existingColors: Set<string>;
  readonly existingLifecycle: Set<string>;
  readonly existingFeatureIds: Set<string>;
  readonly existingBranches: Set<string>;
  readonly existingAdoptions: Set<string>;
  readonly existingBriefs: Set<string>;
  readonly existingDecisions: Set<string>;
  readonly existingDecisionSeqs: Set<string>;
  readonly existingRefs: Set<string>;
}

export function hasTable(db: DatabaseType.Database, tableName: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
      )
      .get(tableName) !== undefined
  );
}

function hasColumn(
  db: DatabaseType.Database,
  tableName: string,
  columnName: string,
): boolean {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name?: unknown;
  }>;
  return cols.some((col) => col.name === columnName);
}

export function readPrefFlag(
  targetDb: DatabaseType.Database,
  key: string,
): boolean {
  if (!hasTable(targetDb, "view_preferences")) return false;
  return (
    targetDb
      .prepare(`SELECT 1 FROM view_preferences WHERE key = ? LIMIT 1`)
      .get(key) !== undefined
  );
}

const validUpdatedAt = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;

const validTimestampOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function readTableRows<Row>(
  db: DatabaseType.Database,
  tableName: string,
  sql: string,
): Row[] {
  return hasTable(db, tableName) ? (db.prepare(sql).all() as Row[]) : [];
}

/** Reads and validates all transferable Nest tables in read-only mode. */
export function readSourceSnapshot(
  sourceDb: DatabaseType.Database,
  now: number,
): ParsedSourceSnapshot {
  const iconExpr = hasColumn(sourceDb, "project_groups", "icon")
    ? "icon"
    : "NULL AS icon";
  const groups: ParsedSourceSnapshot["groups"] = [];
  for (const row of readTableRows<{
    id: unknown;
    name: unknown;
    updated_at: unknown;
    icon: unknown;
  }>(
    sourceDb,
    "project_groups",
    `SELECT id, name, position, updated_at, ${iconExpr} FROM project_groups ORDER BY position ASC, name ASC`,
  )) {
    if (!validGroupId(row.id) || !validGroupName(row.name)) continue;
    groups.push({
      id: row.id,
      name: row.name.trim(),
      icon: canonicalGroupIcon(row.icon),
      updatedAt: validUpdatedAt(row.updated_at, now),
    });
  }

  const memberships: ParsedSourceSnapshot["memberships"] = [];
  for (const row of readTableRows<{
    project_id: unknown;
    group_id: unknown;
    updated_at: unknown;
  }>(
    sourceDb,
    "project_group_members",
    `SELECT project_id, group_id, updated_at FROM project_group_members`,
  )) {
    if (
      !validProjectId(row.project_id) ||
      typeof row.group_id !== "string" ||
      row.group_id.length > MAX_GROUP_ID_LENGTH
    ) {
      continue;
    }
    memberships.push({
      projectId: row.project_id,
      groupId: row.group_id,
      updatedAt: validUpdatedAt(row.updated_at, now),
    });
  }

  const manualOrders: ParsedSourceSnapshot["manualOrders"] = [];
  for (const row of readTableRows<{
    scope_kind: unknown;
    scope_id: unknown;
    item_ids: unknown;
    updated_at: unknown;
  }>(
    sourceDb,
    "manual_order",
    `SELECT scope_kind, scope_id, item_ids, updated_at FROM manual_order`,
  )) {
    if (
      typeof row.scope_kind !== "string" ||
      !VALID_ORDER_SCOPE_KINDS.has(row.scope_kind) ||
      !validOrderId(row.scope_id)
    ) {
      continue;
    }
    const items = parseItemIds(
      typeof row.item_ids === "string" ? row.item_ids : null,
    );
    if (items === null) continue;
    manualOrders.push({
      scopeKind: row.scope_kind,
      scopeId: row.scope_id,
      itemIdsJson: serializeItemIds(items),
      updatedAt: validUpdatedAt(row.updated_at, now),
    });
  }

  const badgeColors: ParsedSourceSnapshot["badgeColors"] = [];
  for (const row of readTableRows<{
    project_id: unknown;
    color: unknown;
    updated_at: unknown;
  }>(
    sourceDb,
    "project_badge_colors",
    `SELECT project_id, color, updated_at FROM project_badge_colors`,
  )) {
    if (!validProjectId(row.project_id)) continue;
    const color = canonicalProjectColor(row.color);
    if (color === null) continue;
    badgeColors.push({
      projectId: row.project_id,
      color,
      updatedAt: validUpdatedAt(row.updated_at, now),
    });
  }

  const archivedExpr = hasColumn(
    sourceDb,
    "thread_lifecycle",
    "archived_thread_ids",
  )
    ? "archived_thread_ids"
    : "NULL AS archived_thread_ids";
  const lifecycle: ParsedSourceSnapshot["lifecycle"] = [];
  for (const row of readTableRows<{
    thread_id: unknown;
    settled_at: unknown;
    snoozed_until: unknown;
    snoozed_at: unknown;
    archived_thread_ids: unknown;
  }>(
    sourceDb,
    "thread_lifecycle",
    `SELECT thread_id, settled_at, snoozed_until, snoozed_at, ${archivedExpr} FROM thread_lifecycle`,
  )) {
    if (!nonEmptyString(row.thread_id)) continue;
    const archivedIds = parseJsonStringArray(row.archived_thread_ids);
    lifecycle.push({
      threadId: row.thread_id,
      settledAt: validTimestampOrNull(row.settled_at),
      snoozedUntil: validTimestampOrNull(row.snoozed_until),
      snoozedAt: validTimestampOrNull(row.snoozed_at),
      archivedJson: archivedIds.length > 0 ? JSON.stringify(archivedIds) : null,
    });
  }

  const rootExpr = hasColumn(sourceDb, "features", "root_path")
    ? "root_path"
    : "NULL AS root_path";
  const hostExpr = hasColumn(sourceDb, "features", "host_id")
    ? "host_id"
    : "NULL AS host_id";
  const createdExpr = hasColumn(sourceDb, "features", "created_at")
    ? "created_at"
    : "NULL AS created_at";
  const features: ParsedSourceSnapshot["features"] = [];
  for (const row of readTableRows<{
    id: unknown;
    name: unknown;
    slug: unknown;
    state: unknown;
    root_path: unknown;
    host_id: unknown;
    created_at: unknown;
    updated_at: unknown;
  }>(
    sourceDb,
    "features",
    `SELECT id, name, slug, state, position, ${rootExpr}, ${hostExpr}, ${createdExpr}, updated_at
       FROM features
      ORDER BY position ASC, updated_at DESC`,
  )) {
    if (
      !validFeatureId(row.id) ||
      !validFeatureName(row.name) ||
      !validFeatureSlug(row.slug)
    ) {
      continue;
    }
    features.push({
      id: row.id,
      name: row.name.trim(),
      slug: row.slug,
      state: readFeatureState(row.state),
      rootPath: nonEmptyString(row.root_path) ? row.root_path : null,
      hostId: nonEmptyString(row.host_id) ? row.host_id : null,
      createdAt: validTimestampOrNull(row.created_at),
      updatedAt: validUpdatedAt(row.updated_at, now),
    });
  }

  const containers: ParsedSourceSnapshot["containers"] = [];
  for (const row of readTableRows<{ path: unknown; updated_at: unknown }>(
    sourceDb,
    "feature_containers",
    `SELECT path, updated_at FROM feature_containers`,
  )) {
    if (!nonEmptyString(row.path)) continue;
    containers.push({
      path: row.path,
      updatedAt: validUpdatedAt(row.updated_at, now),
    });
  }

  const featureBranches: ParsedSourceSnapshot["featureBranches"] = [];
  for (const row of readTableRows<{
    feature_id: unknown;
    repository_path: unknown;
    host_id: unknown;
    branch: unknown;
    created_at: unknown;
  }>(
    sourceDb,
    "feature_branches",
    `SELECT feature_id, repository_path, host_id, branch, created_at FROM feature_branches`,
  )) {
    if (
      !nonEmptyString(row.feature_id) ||
      !nonEmptyString(row.repository_path) ||
      !nonEmptyString(row.host_id) ||
      !nonEmptyString(row.branch)
    ) {
      continue;
    }
    featureBranches.push({
      featureId: row.feature_id,
      repositoryPath: row.repository_path,
      hostId: row.host_id,
      branch: row.branch,
      createdAt: validUpdatedAt(row.created_at, now),
    });
  }

  const featureAdoptions: ParsedSourceSnapshot["featureAdoptions"] = [];
  for (const row of readTableRows<{
    environment_id: unknown;
    feature_id: unknown;
    updated_at: unknown;
  }>(
    sourceDb,
    "feature_workspace_labels",
    `SELECT environment_id, feature_id, updated_at FROM feature_workspace_labels`,
  )) {
    if (!nonEmptyString(row.environment_id) || !nonEmptyString(row.feature_id)) {
      continue;
    }
    featureAdoptions.push({
      environmentId: row.environment_id,
      featureId: row.feature_id,
      updatedAt: validUpdatedAt(row.updated_at, now),
    });
  }

  const featureBriefs: ParsedSourceSnapshot["featureBriefs"] = [];
  for (const row of readTableRows<{
    feature_id: unknown;
    goal: unknown;
    non_goals: unknown;
    acceptance: unknown;
    notes: unknown;
    open_questions: unknown;
    blockers: unknown;
    updated_at: unknown;
  }>(
    sourceDb,
    "feature_briefs",
    `SELECT feature_id, goal, non_goals, acceptance, notes, open_questions, blockers, updated_at FROM feature_briefs`,
  )) {
    if (!nonEmptyString(row.feature_id)) continue;
    featureBriefs.push({
      featureId: row.feature_id,
      goal: typeof row.goal === "string" ? row.goal : "",
      nonGoals: typeof row.non_goals === "string" ? row.non_goals : "",
      acceptance: typeof row.acceptance === "string" ? row.acceptance : "",
      notes: typeof row.notes === "string" ? row.notes : "",
      openQuestions:
        typeof row.open_questions === "string" ? row.open_questions : "[]",
      blockers: typeof row.blockers === "string" ? row.blockers : "[]",
      updatedAt: validUpdatedAt(row.updated_at, now),
    });
  }

  const featureDecisions: ParsedSourceSnapshot["featureDecisions"] = [];
  for (const row of readTableRows<{
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
  }>(
    sourceDb,
    "feature_decisions",
    `SELECT id, feature_id, seq, title, choice, rationale, alternatives, impact, status, author, thread_id, supersedes, superseded_by, created_at
       FROM feature_decisions
      ORDER BY seq ASC`,
  )) {
    if (
      !nonEmptyString(row.id) ||
      !nonEmptyString(row.feature_id) ||
      typeof row.seq !== "number" ||
      !Number.isInteger(row.seq) ||
      row.seq < 1 ||
      !nonEmptyString(row.title) ||
      !nonEmptyString(row.choice)
    ) {
      continue;
    }
    featureDecisions.push({
      id: row.id,
      featureId: row.feature_id,
      seq: row.seq,
      title: row.title,
      choice: row.choice,
      rationale: typeof row.rationale === "string" ? row.rationale : "",
      alternatives:
        typeof row.alternatives === "string" ? row.alternatives : "[]",
      impact: typeof row.impact === "string" ? row.impact : "",
      status: typeof row.status === "string" ? row.status : "confirmed",
      author: typeof row.author === "string" ? row.author : "human",
      threadId: typeof row.thread_id === "string" ? row.thread_id : null,
      supersedes:
        typeof row.supersedes === "number" && Number.isInteger(row.supersedes)
          ? row.supersedes
          : null,
      supersededBy:
        typeof row.superseded_by === "number" &&
        Number.isInteger(row.superseded_by)
          ? row.superseded_by
          : null,
      createdAt: validUpdatedAt(row.created_at, now),
    });
  }

  const featureRefs: ParsedSourceSnapshot["featureRefs"] = [];
  for (const row of readTableRows<{
    id: unknown;
    feature_id: unknown;
    kind: unknown;
    ref_id: unknown;
    url: unknown;
    title: unknown;
    created_at: unknown;
  }>(
    sourceDb,
    "feature_refs",
    `SELECT id, feature_id, kind, ref_id, url, title, created_at
       FROM feature_refs
      ORDER BY created_at ASC`,
  )) {
    if (
      !nonEmptyString(row.id) ||
      !nonEmptyString(row.feature_id) ||
      !nonEmptyString(row.kind) ||
      !nonEmptyString(row.title)
    ) {
      continue;
    }
    featureRefs.push({
      id: row.id,
      featureId: row.feature_id,
      kind: row.kind,
      refId: typeof row.ref_id === "string" ? row.ref_id : null,
      url: typeof row.url === "string" ? row.url : null,
      title: row.title,
      createdAt: validUpdatedAt(row.created_at, now),
    });
  }

  return {
    groups,
    memberships,
    manualOrders,
    badgeColors,
    lifecycle,
    features,
    containers,
    featureBranches,
    featureAdoptions,
    featureBriefs,
    featureDecisions,
    featureRefs,
  };
}

function queryKeySet(
  db: DatabaseType.Database,
  tableName: string,
  sql: string,
  mapRow: (row: Record<string, unknown>) => string | null,
): Set<string> {
  const out = new Set<string>();
  for (const row of readTableRows<Record<string, unknown>>(db, tableName, sql)) {
    const key = mapRow(row);
    if (key !== null) out.add(key);
  }
  return out;
}

/** Collects primary/unique keys already present in Harbor so previews stay accurate. */
export function readTargetIds(
  targetDb: DatabaseType.Database,
): TargetMigrationIds {
  const single = (tableName: string, col: string) =>
    queryKeySet(targetDb, tableName, `SELECT ${col} AS k FROM ${tableName}`, (r) =>
      typeof r.k === "string" ? r.k : null,
    );

  return {
    existingGroupIds: single("project_groups", "id"),
    existingMemberProjects: single("project_group_members", "project_id"),
    existingOrders: queryKeySet(
      targetDb,
      "manual_order",
      `SELECT scope_kind, scope_id FROM manual_order`,
      (r) =>
        typeof r.scope_kind === "string" && typeof r.scope_id === "string"
          ? `${r.scope_kind}\0${r.scope_id}`
          : null,
    ),
    existingColors: single("project_badge_colors", "project_id"),
    existingLifecycle: single("thread_lifecycle", "thread_id"),
    existingFeatureIds: single("features", "id"),
    existingBranches: queryKeySet(
      targetDb,
      "feature_branches",
      `SELECT feature_id, repository_path, branch FROM feature_branches`,
      (r) =>
        typeof r.feature_id === "string" &&
        typeof r.repository_path === "string" &&
        typeof r.branch === "string"
          ? `${r.feature_id}\0${r.repository_path}\0${r.branch}`
          : null,
    ),
    existingAdoptions: single("feature_workspace_labels", "environment_id"),
    existingBriefs: single("feature_briefs", "feature_id"),
    existingDecisions: single("feature_decisions", "id"),
    existingDecisionSeqs: queryKeySet(
      targetDb,
      "feature_decisions",
      `SELECT feature_id, seq FROM feature_decisions`,
      (r) =>
        typeof r.feature_id === "string" && typeof r.seq === "number"
          ? `${r.feature_id}\0${r.seq}`
          : null,
    ),
    existingRefs: single("feature_refs", "id"),
  };
}
