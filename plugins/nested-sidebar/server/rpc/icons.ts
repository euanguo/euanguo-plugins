/**
 * Project icons: what this build can still stand behind, and one probe.
 *
 * Two halves that share a store and nothing else. The read is a filtered list —
 * a row whose checkout the project no longer points at is dropped, and a miss
 * ages out so a favicon added later still turns up. The probe is the one call
 * that reaches a machine, and it is deliberately on demand rather than at load.
 */
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { nestRpcContract } from "../contract.ts";

/** This module's slice of the contract, with every other method omitted. */
type Handlers<Method extends keyof typeof nestRpcContract> = Pick<
  PluginRpcHandlers<typeof nestRpcContract>,
  Method
>;
import { PROJECT_ICON_CHANNEL } from "../../lib/realtime-channels.ts";
import type { createProjectIconStore } from "../../lib/project-icon-store.ts";
import {
  MAX_PROJECT_ICON_ROWS,
  canonicalProjectIcon,
  type ProjectIcon,
} from "../../lib/project-icons.ts";

/** How long a "this checkout has no icon" answer is trusted. */
export const PROJECT_ICON_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** One probe's ceiling. A machine that does not answer in this long is asleep. */
export const PROJECT_ICON_DETECT_TIMEOUT_MS = 10_000;

export interface ProjectIconDeps {
  readonly bb: BbPluginApi;
  readonly projectIcons: ReturnType<typeof createProjectIconStore>;
  /**
   * The one host call this module makes. Typed structurally rather than as the
   * SDK's client so the module says what it needs instead of what it is given.
   */
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
  /**
   * The appearance record, not `bb.settings`. The toggle stopped being a
   * descriptor when the settings page took over drawing it, so this is where
   * the answer lives now.
   */
  readonly appearance: { get(): Promise<{ autoProjectIcons: boolean }> };
  readonly projectSource: (
    projectId: string,
  ) => Promise<{ path: string; hostId: string } | null>;
}

export function projectIconHandlers(
  deps: ProjectIconDeps,
): Handlers<"listProjectIcons" | "detectProjectIcon"> {
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
        // A project bb no longer has, or one that now points at a different
        // checkout: the row describes something this project is not.
        if (current === undefined) continue;
        if (
          current.path !== row.sourcePath ||
          current.hostId !== row.sourceHostId
        ) {
          continue;
        }
        // An aged miss is left out rather than returned, which is what puts
        // that project back in front of the detector.
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
      const cachedMatches =
        cached !== undefined &&
        source !== null &&
        cached.sourcePath === source.path &&
        cached.sourceHostId === source.hostId;
      // A stored answer that still describes this checkout is the answer, even
      // with detection switched off — turning the toggle back on must not cost
      // a probe it already paid for.
      if (cachedMatches) return { projectId, icon: cached.icon };

      // Off means off: no probe, nothing stored, and the row keeps its letter.
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
        // An unreachable machine is not a checkout without an icon. Storing it
        // as one would hide the project's icon for a week for a reason that had
        // nothing to do with the project.
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
