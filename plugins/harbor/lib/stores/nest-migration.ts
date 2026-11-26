import { existsSync } from "node:fs";
import path from "node:path";
import type DatabaseType from "better-sqlite3";
import Database from "better-sqlite3";
import { featureRootParent } from "../domain/feature-root.ts";
import { MAX_FEATURES } from "../domain/features.ts";
import { MAX_PROJECT_COLOR_ROWS } from "../domain/project-colors.ts";
import type {
  NestMigrationApplyResult,
  NestMigrationCounts,
  NestMigrationFeaturePreview,
  NestMigrationGroupPreview,
  NestMigrationPreview,
} from "../schemas/settings.ts";
import { MAX_GROUPS, MAX_ORDER_SCOPES } from "../schemas/sidebar.ts";
import {
  hasTable,
  readPrefFlag,
  readSourceSnapshot,
  readTargetIds,
} from "./nest-migration-snapshot.ts";
import { readTableCount } from "./sqlite-helpers.ts";

export const NEST_MIGRATION_PREF_KEY = "nestMigrationV1Done";
export const NEST_MIGRATION_DISMISSED_KEY = "nestMigrationTipDismissed";
export const LEGACY_NEST_PLUGIN_DIR = "nested-sidebar";

type MutableNestMigrationCounts = {
  -readonly [K in keyof NestMigrationCounts]: number;
};

function zeroCounts(): MutableNestMigrationCounts {
  return {
    groups: 0,
    memberships: 0,
    manualOrders: 0,
    badgeColors: 0,
    lifecycle: 0,
    features: 0,
    featureBranches: 0,
    featureAdoptions: 0,
    featureBriefs: 0,
    featureDecisions: 0,
    featureRefs: 0,
  };
}

function emptyPreview(input: {
  sourceFound: boolean;
  sourcePath: string | null;
  tipDismissed: boolean;
  migratedBefore: boolean;
}): NestMigrationPreview {
  return {
    ...input,
    hasPendingData: false,
    showTip: false,
    pending: zeroCounts(),
    existing: zeroCounts(),
    groups: [],
    features: [],
  };
}

/**
 * Derives the sibling Nest SQLite database path from Harbor's own DB path:
 * `<plugins-data-root>/harbor/data.db` -> `<plugins-data-root>/nested-sidebar/data.db`.
 */
export function resolveSiblingNestDbPath(targetDbPath: string): string | null {
  if (targetDbPath.length === 0 || targetDbPath === ":memory:") return null;
  const resolvedTarget = path.resolve(targetDbPath);
  const pluginDir = path.dirname(resolvedTarget);
  const pluginsRoot = path.dirname(pluginDir);
  const candidate = path.join(pluginsRoot, LEGACY_NEST_PLUGIN_DIR, "data.db");
  return candidate === resolvedTarget ? null : candidate;
}

/** Marks the sidebar Nest migration tip as dismissed so it stays hidden. */
export function dismissNestMigrationTip(targetDb: DatabaseType.Database): void {
  targetDb
    .prepare(
      `INSERT INTO view_preferences (key, value, updated_at)
       VALUES (?, '1', ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(NEST_MIGRATION_DISMISSED_KEY, Date.now());
}

function countByKey<Item>(
  items: readonly Item[],
  keyOf: (item: Item) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Inspects a sibling Nest SQLite database against Harbor's current database
 * without modifying either database, returning a dry-run migration preview.
 */
export function inspectNestMigration(
  targetDb: DatabaseType.Database,
  options?: { readonly sourceDbPath?: string | null },
): NestMigrationPreview {
  const tipDismissed = readPrefFlag(targetDb, NEST_MIGRATION_DISMISSED_KEY);
  const migratedBefore = readPrefFlag(targetDb, NEST_MIGRATION_PREF_KEY);
  const sourcePath =
    options?.sourceDbPath !== undefined
      ? options.sourceDbPath
      : resolveSiblingNestDbPath(targetDb.name);

  if (sourcePath === null || sourcePath.length === 0 || !existsSync(sourcePath)) {
    return emptyPreview({
      sourceFound: false,
      sourcePath: sourcePath ?? null,
      tipDismissed,
      migratedBefore,
    });
  }

  let sourceDb: DatabaseType.Database | null = null;
  try {
    sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true });
    const snapshot = readSourceSnapshot(sourceDb, Date.now());
    const target = readTargetIds(targetDb);

    const existing = zeroCounts();
    const pending = zeroCounts();

    const memberCounts = countByKey(snapshot.memberships, (m) => m.groupId);
    const availableGroupIds = new Set(target.existingGroupIds);
    let groupCapacity = Math.max(0, MAX_GROUPS - target.existingGroupIds.size);
    const groupsPreview: NestMigrationGroupPreview[] = [];

    for (const group of snapshot.groups) {
      const alreadyExists = target.existingGroupIds.has(group.id);
      const willImport = !alreadyExists && groupCapacity > 0;
      if (alreadyExists) existing.groups += 1;
      else if (willImport) {
        pending.groups += 1;
        groupCapacity -= 1;
        availableGroupIds.add(group.id);
      }
      groupsPreview.push({
        id: group.id,
        name: group.name,
        icon: group.icon,
        memberCount: memberCounts.get(group.id) ?? 0,
        alreadyExists,
        willImport,
      });
    }

    for (const member of snapshot.memberships) {
      if (!availableGroupIds.has(member.groupId)) continue;
      if (target.existingMemberProjects.has(member.projectId)) existing.memberships += 1;
      else pending.memberships += 1;
    }

    let orderCapacity = Math.max(0, MAX_ORDER_SCOPES - target.existingOrders.size);
    for (const order of snapshot.manualOrders) {
      if (target.existingOrders.has(`${order.scopeKind}\0${order.scopeId}`)) {
        existing.manualOrders += 1;
      } else if (orderCapacity > 0) {
        pending.manualOrders += 1;
        orderCapacity -= 1;
      }
    }

    let colorCapacity = Math.max(
      0,
      MAX_PROJECT_COLOR_ROWS - target.existingColors.size,
    );
    for (const entry of snapshot.badgeColors) {
      if (target.existingColors.has(entry.projectId)) existing.badgeColors += 1;
      else if (colorCapacity > 0) {
        pending.badgeColors += 1;
        colorCapacity -= 1;
      }
    }

    for (const row of snapshot.lifecycle) {
      if (target.existingLifecycle.has(row.threadId)) existing.lifecycle += 1;
      else pending.lifecycle += 1;
    }

    const availableFeatureIds = new Set(target.existingFeatureIds);
    let featureCapacity = Math.max(0, MAX_FEATURES - target.existingFeatureIds.size);
    const branchCounts = countByKey(snapshot.featureBranches, (b) => b.featureId);
    const decisionCounts = countByKey(
      snapshot.featureDecisions,
      (d) => d.featureId,
    );
    const refCounts = countByKey(snapshot.featureRefs, (r) => r.featureId);
    const briefFeatures = new Set(snapshot.featureBriefs.map((b) => b.featureId));

    const featuresPreview: NestMigrationFeaturePreview[] = [];
    for (const feature of snapshot.features) {
      const alreadyExists = target.existingFeatureIds.has(feature.id);
      const willImport = !alreadyExists && featureCapacity > 0;
      if (alreadyExists) existing.features += 1;
      else if (willImport) {
        pending.features += 1;
        featureCapacity -= 1;
        availableFeatureIds.add(feature.id);
      }
      featuresPreview.push({
        id: feature.id,
        name: feature.name,
        slug: feature.slug,
        state: feature.state,
        rootPath: feature.rootPath,
        branchCount: branchCounts.get(feature.id) ?? 0,
        decisionCount: decisionCounts.get(feature.id) ?? 0,
        refCount: refCounts.get(feature.id) ?? 0,
        hasBrief: briefFeatures.has(feature.id),
        alreadyExists,
        willImport,
      });
    }

    for (const branch of snapshot.featureBranches) {
      if (!availableFeatureIds.has(branch.featureId)) continue;
      if (
        target.existingBranches.has(
          `${branch.featureId}\0${branch.repositoryPath}\0${branch.branch}`,
        )
      ) {
        existing.featureBranches += 1;
      } else {
        pending.featureBranches += 1;
      }
    }

    for (const adoption of snapshot.featureAdoptions) {
      if (!availableFeatureIds.has(adoption.featureId)) continue;
      if (target.existingAdoptions.has(adoption.environmentId)) {
        existing.featureAdoptions += 1;
      } else {
        pending.featureAdoptions += 1;
      }
    }

    for (const brief of snapshot.featureBriefs) {
      if (!availableFeatureIds.has(brief.featureId)) continue;
      if (target.existingBriefs.has(brief.featureId)) existing.featureBriefs += 1;
      else pending.featureBriefs += 1;
    }

    for (const decision of snapshot.featureDecisions) {
      if (!availableFeatureIds.has(decision.featureId)) continue;
      if (
        target.existingDecisions.has(decision.id) ||
        target.existingDecisionSeqs.has(`${decision.featureId}\0${decision.seq}`)
      ) {
        existing.featureDecisions += 1;
      } else {
        pending.featureDecisions += 1;
      }
    }

    for (const ref of snapshot.featureRefs) {
      if (!availableFeatureIds.has(ref.featureId)) continue;
      if (target.existingRefs.has(ref.id)) existing.featureRefs += 1;
      else pending.featureRefs += 1;
    }

    const hasPendingData = Object.values(pending).some((value) => value > 0);
    return {
      sourceFound: true,
      sourcePath,
      tipDismissed,
      migratedBefore,
      hasPendingData,
      showTip: hasPendingData && !tipDismissed,
      pending,
      existing,
      groups: groupsPreview,
      features: featuresPreview,
    };
  } catch {
    return emptyPreview({
      sourceFound: false,
      sourcePath,
      tipDismissed,
      migratedBefore,
    });
  } finally {
    sourceDb?.close();
  }
}

/**
 * Imports selected Nest data (groups & ordering, in-place features & metadata,
 * badge colors & thread shelves) into Harbor idempotently inside one transaction.
 * Existing Harbor rows are never overwritten (`INSERT OR IGNORE`).
 */
export function migrateFromNestDatabase(
  targetDb: DatabaseType.Database,
  options?: {
    readonly sourceDbPath?: string | null;
    readonly includeGroups?: boolean;
    readonly includeFeatures?: boolean;
    readonly includeExtras?: boolean;
    readonly force?: boolean;
    readonly log?: (message: string) => void;
  },
): NestMigrationApplyResult {
  const includeGroups = options?.includeGroups ?? true;
  const includeFeatures = options?.includeFeatures ?? true;
  const includeExtras = options?.includeExtras ?? true;

  const sourcePath =
    options?.sourceDbPath !== undefined
      ? options.sourceDbPath
      : resolveSiblingNestDbPath(targetDb.name);

  if (sourcePath === null || sourcePath.length === 0 || !existsSync(sourcePath)) {
    return {
      status: "source-missing",
      imported: zeroCounts(),
      preview: inspectNestMigration(targetDb, { sourceDbPath: sourcePath }),
    };
  }

  let sourceDb: DatabaseType.Database | null = null;
  try {
    const now = Date.now();
    sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true });
    const snapshot = readSourceSnapshot(sourceDb, now);

    const imported = targetDb.transaction((): NestMigrationCounts => {
      const counts = zeroCounts();

      if (includeGroups) {
        let totalGroups = readTableCount(targetDb, "project_groups");
        const maxPosRow = targetDb
          .prepare(`SELECT COALESCE(MAX(position), -1) AS max FROM project_groups`)
          .get() as { max: number };
        let nextPosition =
          typeof maxPosRow.max === "number" && Number.isFinite(maxPosRow.max)
            ? maxPosRow.max + 1
            : 0;

        const insertGroup = targetDb.prepare(
          `INSERT OR IGNORE INTO project_groups (id, name, position, updated_at, icon)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const group of snapshot.groups) {
          if (totalGroups >= MAX_GROUPS) break;
          const result = insertGroup.run(
            group.id,
            group.name,
            nextPosition,
            group.updatedAt,
            group.icon,
          );
          if (result.changes > 0) {
            counts.groups += 1;
            totalGroups += 1;
            nextPosition += 1;
          }
        }

        const knownGroupIds = new Set(
          (targetDb.prepare(`SELECT id FROM project_groups`).all() as Array<{ id: unknown }>)
            .map((row) => row.id)
            .filter((id): id is string => typeof id === "string"),
        );

        const insertMember = targetDb.prepare(
          `INSERT OR IGNORE INTO project_group_members (project_id, group_id, updated_at)
           VALUES (?, ?, ?)`,
        );
        for (const member of snapshot.memberships) {
          if (!knownGroupIds.has(member.groupId)) continue;
          if (insertMember.run(member.projectId, member.groupId, member.updatedAt).changes > 0) {
            counts.memberships += 1;
          }
        }

        let orderScopes = readTableCount(targetDb, "manual_order");
        const insertOrder = targetDb.prepare(
          `INSERT OR IGNORE INTO manual_order (scope_kind, scope_id, item_ids, updated_at)
           VALUES (?, ?, ?, ?)`,
        );
        for (const order of snapshot.manualOrders) {
          if (orderScopes >= MAX_ORDER_SCOPES) break;
          if (
            insertOrder.run(
              order.scopeKind,
              order.scopeId,
              order.itemIdsJson,
              order.updatedAt,
            ).changes > 0
          ) {
            counts.manualOrders += 1;
            orderScopes += 1;
          }
        }
        if (counts.manualOrders > 0) {
          targetDb
            .prepare(`UPDATE manual_order_revision SET revision = revision + 1 WHERE id = 0`)
            .run();
        }
      }

      if (includeFeatures && hasTable(targetDb, "features")) {
        let totalFeatures = readTableCount(targetDb, "features");
        const maxFeatPosRow = targetDb
          .prepare(`SELECT COALESCE(MAX(position), -1) AS max FROM features`)
          .get() as { max: number };
        let nextFeaturePos =
          typeof maxFeatPosRow.max === "number" && Number.isFinite(maxFeatPosRow.max)
            ? maxFeatPosRow.max + 1
            : 0;

        const insertFeature = targetDb.prepare(
          `INSERT OR IGNORE INTO features
             (id, name, slug, state, position, root_path, host_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const insertContainer = hasTable(targetDb, "feature_containers")
          ? targetDb.prepare(
              `INSERT OR IGNORE INTO feature_containers (path, updated_at) VALUES (?, ?)`,
            )
          : null;

        for (const container of snapshot.containers) {
          insertContainer?.run(container.path, container.updatedAt);
        }

        for (const feature of snapshot.features) {
          if (totalFeatures >= MAX_FEATURES) break;
          const result = insertFeature.run(
            feature.id,
            feature.name,
            feature.slug,
            feature.state,
            nextFeaturePos,
            feature.rootPath,
            feature.hostId,
            feature.createdAt,
            feature.updatedAt,
          );
          if (result.changes > 0) {
            counts.features += 1;
            totalFeatures += 1;
            nextFeaturePos += 1;
            if (feature.rootPath !== null) {
              insertContainer?.run(featureRootParent(feature.rootPath), now);
            }
          }
        }

        const knownFeatureIds = new Set(
          (targetDb.prepare(`SELECT id FROM features`).all() as Array<{ id: unknown }>)
            .map((row) => row.id)
            .filter((id): id is string => typeof id === "string"),
        );

        if (hasTable(targetDb, "feature_branches")) {
          const insertBranch = targetDb.prepare(
            `INSERT OR IGNORE INTO feature_branches
               (feature_id, repository_path, host_id, branch, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          );
          for (const branch of snapshot.featureBranches) {
            if (!knownFeatureIds.has(branch.featureId)) continue;
            if (
              insertBranch.run(
                branch.featureId,
                branch.repositoryPath,
                branch.hostId,
                branch.branch,
                branch.createdAt,
              ).changes > 0
            ) {
              counts.featureBranches += 1;
            }
          }
        }

        if (hasTable(targetDb, "feature_workspace_labels")) {
          const insertAdoption = targetDb.prepare(
            `INSERT OR IGNORE INTO feature_workspace_labels
               (environment_id, feature_id, updated_at)
             VALUES (?, ?, ?)`,
          );
          for (const adoption of snapshot.featureAdoptions) {
            if (!knownFeatureIds.has(adoption.featureId)) continue;
            if (
              insertAdoption.run(
                adoption.environmentId,
                adoption.featureId,
                adoption.updatedAt,
              ).changes > 0
            ) {
              counts.featureAdoptions += 1;
            }
          }
        }

        if (hasTable(targetDb, "feature_briefs")) {
          const insertBrief = targetDb.prepare(
            `INSERT OR IGNORE INTO feature_briefs
               (feature_id, goal, non_goals, acceptance, notes, open_questions, blockers, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const brief of snapshot.featureBriefs) {
            if (!knownFeatureIds.has(brief.featureId)) continue;
            if (
              insertBrief.run(
                brief.featureId,
                brief.goal,
                brief.nonGoals,
                brief.acceptance,
                brief.notes,
                brief.openQuestions,
                brief.blockers,
                brief.updatedAt,
              ).changes > 0
            ) {
              counts.featureBriefs += 1;
            }
          }
        }

        if (hasTable(targetDb, "feature_decisions")) {
          const insertDecision = targetDb.prepare(
            `INSERT OR IGNORE INTO feature_decisions
               (id, feature_id, seq, title, choice, rationale, alternatives, impact, status, author, thread_id, supersedes, superseded_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const decision of snapshot.featureDecisions) {
            if (!knownFeatureIds.has(decision.featureId)) continue;
            if (
              insertDecision.run(
                decision.id,
                decision.featureId,
                decision.seq,
                decision.title,
                decision.choice,
                decision.rationale,
                decision.alternatives,
                decision.impact,
                decision.status,
                decision.author,
                decision.threadId,
                decision.supersedes,
                decision.supersededBy,
                decision.createdAt,
              ).changes > 0
            ) {
              counts.featureDecisions += 1;
            }
          }
        }

        if (hasTable(targetDb, "feature_refs")) {
          const insertRef = targetDb.prepare(
            `INSERT OR IGNORE INTO feature_refs
               (id, feature_id, kind, ref_id, url, title, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const ref of snapshot.featureRefs) {
            if (!knownFeatureIds.has(ref.featureId)) continue;
            if (
              insertRef.run(
                ref.id,
                ref.featureId,
                ref.kind,
                ref.refId,
                ref.url,
                ref.title,
                ref.createdAt,
              ).changes > 0
            ) {
              counts.featureRefs += 1;
            }
          }
        }
      }

      if (includeExtras) {
        let colorCount = readTableCount(targetDb, "project_badge_colors");
        const insertColor = targetDb.prepare(
          `INSERT OR IGNORE INTO project_badge_colors (project_id, color, updated_at)
           VALUES (?, ?, ?)`,
        );
        for (const color of snapshot.badgeColors) {
          if (colorCount >= MAX_PROJECT_COLOR_ROWS) break;
          if (insertColor.run(color.projectId, color.color, color.updatedAt).changes > 0) {
            counts.badgeColors += 1;
            colorCount += 1;
          }
        }

        const insertLifecycle = targetDb.prepare(
          `INSERT OR IGNORE INTO thread_lifecycle
             (thread_id, settled_at, snoozed_until, snoozed_at, archived_thread_ids)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const row of snapshot.lifecycle) {
          if (
            insertLifecycle.run(
              row.threadId,
              row.settledAt,
              row.snoozedUntil,
              row.snoozedAt,
              row.archivedJson,
            ).changes > 0
          ) {
            counts.lifecycle += 1;
          }
        }
      }

      if (Object.values(counts).some((value) => value > 0)) {
        targetDb
          .prepare(
            `INSERT INTO view_preferences (key, value, updated_at)
             VALUES (?, '1', ?)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value, updated_at = excluded.updated_at`,
          )
          .run(NEST_MIGRATION_PREF_KEY, now);
      }

      return counts;
    })();

    const anyImported = Object.values(imported).some((value) => value > 0);
    if (anyImported) {
      options?.log?.(
        `[harbor] Migrated Nest data: ${imported.groups} groups, ${imported.memberships} assignments, ${imported.features} features, ${imported.badgeColors} badge colors, ${imported.lifecycle} lifecycle rows.`,
      );
    }
    return {
      status: anyImported ? "migrated" : "nothing-to-migrate",
      imported,
      preview: inspectNestMigration(targetDb, { sourceDbPath: sourcePath }),
    };
  } catch (error) {
    options?.log?.(
      `[harbor] Skipped Nest migration (${sourcePath}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      status: "skipped-error",
      imported: zeroCounts(),
      preview: inspectNestMigration(targetDb, { sourceDbPath: sourcePath }),
    };
  } finally {
    sourceDb?.close();
  }
}
