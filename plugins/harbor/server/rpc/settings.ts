/**
 * Consolidated settings, preferences, agent access, project badge colors, and
 * project icon RPC handlers.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { AGENT_ACCESS_CHANNEL } from "../../lib/domain/agent-access.ts";
import {
  MAX_PROJECT_ICON_BYTES,
  MAX_PROJECT_ICON_ROWS,
  canonicalProjectIcon,
  type ProjectIcon,
} from "../../lib/domain/project-icons.ts";
import {
  APPEARANCE_CHANNEL,
  FEATURE_CHANNEL,
  GROUP_CHANNEL,
  LIFECYCLE_CHANNEL,
  NEST_MIGRATION_CHANNEL,
  ORDER_CHANNEL,
  PROJECT_COLOR_CHANNEL,
  PROJECT_ICON_CHANNEL,
  VIEW_PREFERENCE_CHANNEL,
} from "../../lib/realtime-channels.ts";
import type { AgentAccessStore } from "../../lib/stores/agent-access-store.ts";
import type { AppearanceStore } from "../../lib/stores/appearance-store.ts";
import {
  dismissNestMigrationTip,
  inspectNestMigration,
  migrateFromNestDatabase,
} from "../../lib/stores/nest-migration.ts";
import type { createProjectColorStore } from "../../lib/stores/project-color-store.ts";
import type { createProjectIconStore } from "../../lib/stores/project-icon-store.ts";
import type { createViewPreferenceStore } from "../../lib/stores/view-preference-store.ts";
import type { HarborRpcHandlers } from "../contract.ts";

export const PROJECT_ICON_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PROJECT_ICON_DETECT_TIMEOUT_MS = 10_000;

export interface AgentAccessHandlerDeps {
  readonly bb: BbPluginApi;
  readonly agentAccess: AgentAccessStore;
}

export function agentAccessHandlers(
  deps: AgentAccessHandlerDeps,
): HarborRpcHandlers<"getAgentAccess" | "setAgentAccess"> {
  const { bb, agentAccess } = deps;

  return {
    async getAgentAccess() {
      return { tier: await agentAccess.get() };
    },

    async setAgentAccess({ tier }) {
      const next = await agentAccess.set(tier);
      bb.realtime.publish(AGENT_ACCESS_CHANNEL, { tier: next });
      bb.rpc?.experimental_invalidate?.(["agentAccess"]);
      return { tier: next };
    },
  };
}

export interface ProjectIconDeps {
  readonly bb: BbPluginApi;
  readonly projectIcons: ReturnType<typeof createProjectIconStore>;
  readonly worktreeHost: {
    call(
      method: "detectProjectIcon",
      input: {
        path: string;
        knownLabel?: string | null;
        knownMtimeMs?: number | null;
      },
      options: { hostId: string; timeoutMs: number },
    ): Promise<
      | {
          status: "found";
          src: string;
          label: string;
          source: "favicon" | "file";
          mtimeMs: number | null;
        }
      | { status: "unchanged" }
      | { status: "none"; reason?: string }
      | { status: "too-large"; label: string; size: number }
      | { status: "failed"; message: string }
    >;
  };
  readonly appearance: { get(): Promise<{ autoProjectIcons: boolean }> };
  readonly projectSource: (
    projectId: string,
  ) => Promise<{ path: string; hostId: string } | null>;
}

export function projectIconHandlers(
  deps: ProjectIconDeps,
): HarborRpcHandlers<
  "listProjectIcons" | "detectProjectIcon" | "refreshProjectIcons"
> {
  const { bb, projectIcons, worktreeHost, appearance, projectSource } = deps;

  /**
   * One project's probe. A local icon whose mtime still matches the cached row
   * is answered by the host with `unchanged` after a single stat; everything
   * else is re-read and written back. `force` is the settings-page refresh.
   */
  const probeOne = async (
    projectId: string,
    force: boolean,
  ): Promise<{
    entry: { projectId: string; icon: ProjectIcon | null };
    outcome: "refreshed" | "unchanged" | "skipped";
    diagnostic?: string;
  }> => {
    const source = await projectSource(projectId);
    const cached = projectIcons.get(projectId);
    const usable =
      cached !== undefined &&
      source !== null &&
      cached.sourcePath === source.path &&
      cached.sourceHostId === source.hostId
        ? cached
        : undefined;
    if (
      source === null ||
      (await appearance.get()).autoProjectIcons !== true
    ) {
      return {
        entry: { projectId, icon: usable?.icon ?? null },
        outcome: "skipped",
      };
    }
    // Rows with no mtime (remote favicons, or written by an older build) fall
    // back to the age schedule; local files use the exact mtime fast path.
    const ageExpired =
      usable !== undefined &&
      usable.sourceMtime == null &&
      Date.now() - usable.updatedAt >= PROJECT_ICON_MISS_TTL_MS;
    const missExpired =
      usable !== undefined &&
      usable.icon === null &&
      Date.now() - usable.updatedAt >= PROJECT_ICON_MISS_TTL_MS;
    // A recent "no icon here" is still worth believing without a host round
    // trip; an icon that IS cached always gets the cheap mtime check below.
    if (!force && usable?.icon === null && !missExpired) {
      return {
        entry: { projectId, icon: null },
        outcome: "unchanged",
      };
    }
    const useKnown = !force && !ageExpired && !missExpired;
    const attempt = await worktreeHost
      .call(
        "detectProjectIcon",
        {
          path: source.path,
          knownLabel: useKnown ? (usable?.icon?.label ?? null) : null,
          knownMtimeMs: useKnown ? (usable?.sourceMtime ?? null) : null,
        },
        { hostId: source.hostId, timeoutMs: PROJECT_ICON_DETECT_TIMEOUT_MS },
      )
      .catch(() => ({ status: "failed" as const, message: "unreachable" }));

    switch (attempt.status) {
      case "unchanged":
        return {
          entry: { projectId, icon: usable?.icon ?? null },
          outcome: "unchanged",
        };
      case "failed":
        return {
          entry: { projectId, icon: usable?.icon ?? null },
          outcome: "skipped",
        };
      case "too-large":
        return {
          entry: { projectId, icon: usable?.icon ?? null },
          outcome: "skipped",
          diagnostic: `${attempt.label} is ${Math.round(attempt.size / 1024)} KB; the limit is ${Math.round(MAX_PROJECT_ICON_BYTES / 1024)} KB`,
        };
      case "none": {
        projectIcons.set({
          projectId,
          icon: null,
          sourcePath: source.path,
          sourceHostId: source.hostId,
          sourceMtime: null,
        });
        bb.realtime.publish(PROJECT_ICON_CHANNEL, { projectId });
        return {
          entry: { projectId, icon: null },
          outcome: "refreshed",
          ...(attempt.reason === undefined
            ? {}
            : { diagnostic: attempt.reason }),
        };
      }
      case "found": {
        const icon = canonicalProjectIcon({
          src: attempt.src,
          label: attempt.label,
          source: attempt.source,
        });
        if (icon === null) {
          return {
            entry: { projectId, icon: usable?.icon ?? null },
            outcome: "skipped",
          };
        }
        const stored = projectIcons.set({
          projectId,
          icon,
          sourcePath: source.path,
          sourceHostId: source.hostId,
          sourceMtime: attempt.mtimeMs,
        });
        bb.realtime.publish(PROJECT_ICON_CHANNEL, { projectId });
        return {
          entry: { projectId, icon: stored.icon },
          outcome: "refreshed",
        };
      }
    }
  };

  return {
    async listProjectIcons() {
      const projects = await bb.sdk.projects.list({});
      const sources = new Map<
        string,
        { path: string | null; hostId: string | null }
      >();
      for (const project of projects) {
        const source =
          project.sources.find((candidate) => candidate.isDefault) ??
          project.sources[0];
        sources.set(project.id, {
          path: source?.path ?? null,
          hostId: source?.hostId ?? null,
        });
      }
      const now = Date.now();
      const icons: Array<{ projectId: string; icon: ProjectIcon | null }> = [];
      for (const row of projectIcons.list()) {
        const current = sources.get(row.projectId);
        if (current === undefined) continue;
        if (
          current.path !== row.sourcePath ||
          current.hostId !== row.sourceHostId
        ) {
          continue;
        }
        if (row.icon === null && now - row.updatedAt >= PROJECT_ICON_MISS_TTL_MS) {
          continue;
        }
        icons.push({ projectId: row.projectId, icon: row.icon });
        if (icons.length === MAX_PROJECT_ICON_ROWS) break;
      }
      return { icons };
    },

    async detectProjectIcon({ projectId }) {
      const result = await probeOne(projectId, false);
      return result.diagnostic === undefined
        ? result.entry
        : { ...result.entry, diagnostic: result.diagnostic };
    },

    async refreshProjectIcons() {
      const projects = await bb.sdk.projects.list({});
      let refreshed = 0;
      let unchanged = 0;
      const diagnostics: string[] = [];
      for (const project of projects) {
        const result = await probeOne(project.id, true);
        if (result.outcome === "refreshed") refreshed += 1;
        if (result.outcome === "unchanged") unchanged += 1;
        if (result.diagnostic !== undefined) {
          diagnostics.push(`${project.id}: ${result.diagnostic}`);
        }
      }
      return { refreshed, unchanged, diagnostics };
    },
  };
}

export interface SettingsHandlerDeps {
  readonly bb: BbPluginApi;
  readonly db: Database.Database;
  readonly appearance: AppearanceStore;
  readonly viewPreferences: ReturnType<typeof createViewPreferenceStore>;
  readonly agentAccess: AgentAccessStore;
  readonly projectColors: ReturnType<typeof createProjectColorStore>;
  readonly projectIcons: ReturnType<typeof createProjectIconStore>;
  readonly worktreeHost: ProjectIconDeps["worktreeHost"];
  readonly projectSource: ProjectIconDeps["projectSource"];
  readonly refreshFeatures: () => Promise<unknown>;
  readonly refreshSidebarIndex: () => Promise<unknown>;
}

export function settingsHandlers(
  deps: SettingsHandlerDeps,
): HarborRpcHandlers<
  | "getAppearance"
  | "setAppearance"
  | "previewNestMigration"
  | "applyNestMigration"
  | "dismissNestMigrationTip"
  | "getViewPreferences"
  | "setViewPreferences"
  | "getAgentAccess"
  | "setAgentAccess"
  | "listProjectColors"
  | "setProjectColor"
  | "resetProjectColor"
  | "listProjectIcons"
  | "detectProjectIcon"
  | "refreshProjectIcons"
> {
  const {
    bb,
    db,
    appearance,
    viewPreferences,
    projectColors,
    refreshFeatures,
    refreshSidebarIndex,
  } = deps;

  return {
    async getAppearance() {
      return appearance.get();
    },

    async setAppearance(patch) {
      const next = await appearance.set(patch);
      bb.realtime.publish(APPEARANCE_CHANNEL, {});
      bb.rpc?.experimental_invalidate?.(["appearance"]);
      return next;
    },

    async previewNestMigration() {
      return inspectNestMigration(db);
    },

    async applyNestMigration(input) {
      const result = migrateFromNestDatabase(db, {
        ...input,
        force: true,
        log: (message) => bb.log.info(message),
      });
      if (result.status === "migrated") {
        if (
          result.imported.features > 0 ||
          result.imported.featureBranches > 0 ||
          result.imported.featureAdoptions > 0 ||
          result.imported.featureBriefs > 0 ||
          result.imported.featureDecisions > 0 ||
          result.imported.featureRefs > 0
        ) {
          await refreshFeatures().catch(() => {});
        }
        void refreshSidebarIndex();
        bb.realtime.publish(GROUP_CHANNEL, {});
        bb.realtime.publish(ORDER_CHANNEL, {});
        bb.realtime.publish(FEATURE_CHANNEL, {});
        bb.realtime.publish(LIFECYCLE_CHANNEL, {});
        bb.realtime.publish(PROJECT_COLOR_CHANNEL, {});
        bb.realtime.publish(NEST_MIGRATION_CHANNEL, {});
        bb.rpc?.experimental_invalidate?.([
          "groups",
          "features",
          "nestMigration",
        ]);
      }
      return result;
    },

    async dismissNestMigrationTip() {
      dismissNestMigrationTip(db);
      bb.realtime.publish(NEST_MIGRATION_CHANNEL, {});
      bb.rpc?.experimental_invalidate?.(["nestMigration"]);
      return { ok: true };
    },

    async getViewPreferences() {
      return viewPreferences.get();
    },

    async setViewPreferences(patch) {
      const next = viewPreferences.set(patch);
      bb.realtime.publish(VIEW_PREFERENCE_CHANNEL, {});
      bb.rpc?.experimental_invalidate?.(["prefs"]);
      return next;
    },

    ...agentAccessHandlers(deps),

    async listProjectColors() {
      return { colors: projectColors.list() };
    },

    async setProjectColor({ projectId, color }) {
      await bb.sdk.projects.get({ projectId });
      const stored = projectColors.set(projectId, color);
      bb.realtime.publish(PROJECT_COLOR_CHANNEL, { projectId });
      return stored;
    },

    async resetProjectColor({ projectId }) {
      await bb.sdk.projects.get({ projectId });
      const reset = projectColors.reset(projectId);
      bb.realtime.publish(PROJECT_COLOR_CHANNEL, { projectId });
      return { projectId, reset };
    },

    ...projectIconHandlers(deps),
  };
}
