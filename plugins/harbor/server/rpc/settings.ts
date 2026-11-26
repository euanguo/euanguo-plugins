/**
 * Consolidated settings, preferences, agent access, project badge colors, and
 * project icon RPC handlers.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { AGENT_ACCESS_CHANNEL } from "../../lib/domain/agent-access.ts";
import {
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
      input: { path: string },
      options: { hostId: string; timeoutMs: number },
    ): Promise<
      | { status: "found"; src: string; label: string; source: "favicon" | "file" }
      | { status: "none" }
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
): HarborRpcHandlers<"listProjectIcons" | "detectProjectIcon"> {
  const { bb, projectIcons, worktreeHost, appearance, projectSource } = deps;

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
      const source = await projectSource(projectId);
      const cached = projectIcons.get(projectId);
      const missExpired =
        cached !== undefined &&
        cached.icon === null &&
        Date.now() - cached.updatedAt >= PROJECT_ICON_MISS_TTL_MS;
      const cachedMatches =
        cached !== undefined &&
        source !== null &&
        cached.sourcePath === source.path &&
        cached.sourceHostId === source.hostId &&
        !missExpired;
      if (cachedMatches) return { projectId, icon: cached.icon };

      const values = await appearance.get();
      if (values.autoProjectIcons !== true || source === null) {
        return { projectId, icon: null };
      }

      const attempt = await worktreeHost
        .call(
          "detectProjectIcon",
          { path: source.path },
          { hostId: source.hostId, timeoutMs: PROJECT_ICON_DETECT_TIMEOUT_MS },
        )
        .catch(() => ({ status: "failed" as const, message: "unreachable" }));

      if (attempt.status === "none") {
        const stored = projectIcons.set({
          projectId,
          icon: null,
          sourcePath: source.path,
          sourceHostId: source.hostId,
        });
        bb.realtime.publish(PROJECT_ICON_CHANNEL, { projectId });
        return { projectId, icon: stored.icon };
      }
      if (attempt.status === "failed") return { projectId, icon: null };

      const icon = canonicalProjectIcon({
        src: attempt.src,
        label: attempt.label,
        source: attempt.source,
      });
      if (icon === null) return { projectId, icon: null };
      const stored = projectIcons.set({
        projectId,
        icon,
        sourcePath: source.path,
        sourceHostId: source.hostId,
      });
      bb.realtime.publish(PROJECT_ICON_CHANNEL, { projectId });
      return { projectId, icon: stored.icon };
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
