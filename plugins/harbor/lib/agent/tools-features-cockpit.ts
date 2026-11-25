/**
 * Agent tools for Harbor Feature Cockpit workflows: Park/Wake, Multi-repo Git
 * status, Read-only reference linking, and Worktree-to-Feature promotion.
 */
import { z } from "zod";

import { describeActionError } from "../domain/rpc-error.ts";
import { quoteName } from "./instructions.ts";
import type { AgentToolRegistry } from "./toolkit.ts";
import type { FeatureAgentPort } from "./tools-features.ts";

export function registerFeatureCockpitTools(
  registry: AgentToolRegistry,
  port: FeatureAgentPort,
): void {
  const resolveFeatureId = async (
    explicitId: string | undefined,
    threadId: string,
  ): Promise<{ featureId: string; name: string } | { error: string }> => {
    if (explicitId !== undefined) {
      let found = port.features().find((feature) => feature.id === explicitId);
      if (found === undefined) {
        await port.refresh().catch(() => undefined);
        found = port.features().find((feature) => feature.id === explicitId);
      }
      return found === undefined
        ? { error: `Feature ${explicitId} was not found.` }
        : { featureId: found.id, name: found.name };
    }
    await port.refresh().catch(() => undefined);
    const located = port.locate(await port.threadPath(threadId));
    if (located === null) {
      return {
        error:
          "This thread is not running inside a feature folder. Pass feature_id from harbor_feature_list.",
      };
    }
    return { featureId: located.feature.id, name: located.feature.name };
  };

  const resolveProjects = async (requested: readonly string[]) => {
    const projects = await port.projects();
    const resolved: { projectId: string; name: string }[] = [];
    const problems: string[] = [];
    for (const asked of requested) {
      const needle = asked.trim().toLowerCase();
      if (needle.length === 0) {
        problems.push(`${quoteName(asked)}: project name or id cannot be blank.`);
        continue;
      }
      const exact = projects.filter(
        (project) =>
          project.id === asked || project.name.toLowerCase() === needle,
      );
      const matches =
        exact.length > 0
          ? exact
          : projects.filter((project) =>
              project.name.toLowerCase().includes(needle),
            );
      if (matches.length === 1 && matches[0] !== undefined) {
        resolved.push({ projectId: matches[0].id, name: matches[0].name });
      } else if (matches.length === 0) {
        problems.push(`${quoteName(asked)}: no bb project by that name or id.`);
      } else {
        problems.push(
          `${quoteName(asked)}: matches ${matches.map((project) => quoteName(project.name)).join(", ")}; pass the exact name or id.`,
        );
      }
    }
    return { resolved, problems };
  };

  registry.register({
    name: "harbor_feature_park",
    feature: "features",
    description:
      "Park a feature while waiting on external dependencies, QA, or a future reminder. Keeps all worktrees and threads intact while moving the feature into Harbor's Parked shelf.",
    parameters: z.object({
      feature_id: z
        .string()
        .min(1)
        .optional()
        .describe("Feature id from harbor_feature_list. Omit to park this thread's feature."),
      reason: z
        .string()
        .trim()
        .max(60)
        .optional()
        .describe("Short status tag, e.g. waiting-qa, waiting-backend, or custom reason."),
      note: z
        .string()
        .trim()
        .max(240)
        .optional()
        .describe("Context note shown on the Parked shelf."),
      wake_at: z
        .string()
        .trim()
        .optional()
        .describe("Optional ISO 8601 timestamp when Harbor should automatically wake this feature."),
      wake_on_activity: z
        .boolean()
        .optional()
        .describe("Wake automatically when any thread in this feature becomes active."),
    }),
    async execute({ feature_id, reason, note, wake_at, wake_on_activity }, context) {
      const target = await resolveFeatureId(feature_id, context.threadId);
      if ("error" in target) return target.error;

      let parsedWakeAt: number | null = null;
      if (wake_at !== undefined && wake_at.length > 0) {
        const ts = Date.parse(wake_at);
        if (!Number.isFinite(ts)) {
          return `Could not read wake_at ${quoteName(wake_at)}; pass an ISO 8601 timestamp.`;
        }
        if (ts <= Date.now()) {
          return `wake_at ${quoteName(wake_at)} is in the past; pass a future timestamp.`;
        }
        parsedWakeAt = ts;
      }

      try {
        const parked = await port.park({
          featureId: target.featureId,
          reason: reason ?? null,
          note: note ?? null,
          wakeAt: parsedWakeAt,
          wakeOnActivity: wake_on_activity ?? true,
        });
        const wakeInfo =
          parked.wakeAt !== null && parked.wakeAt !== undefined
            ? ` Wake scheduled for ${new Date(parked.wakeAt).toISOString()}.`
            : "";
        return `Parked ${quoteName(parked.name)}.${wakeInfo}`;
      } catch (error) {
        return describeActionError(error);
      }
    },
  });

  registry.register({
    name: "harbor_feature_unpark",
    feature: "features",
    description:
      "Wake a parked feature and return it to Harbor's active Features list.",
    parameters: z.object({
      feature_id: z
        .string()
        .min(1)
        .optional()
        .describe("Feature id from harbor_feature_list. Omit to wake this thread's feature."),
    }),
    async execute({ feature_id }, context) {
      const target = await resolveFeatureId(feature_id, context.threadId);
      if ("error" in target) return target.error;
      try {
        const updated = await port.unpark(target.featureId);
        return `Woke ${quoteName(updated.name)}; it is active again.`;
      } catch (error) {
        return describeActionError(error);
      }
    },
  });

  registry.register({
    name: "harbor_feature_git_status",
    feature: "features",
    description:
      "Inspect aggregated git status across every repository in the feature: changed/untracked counts, diff additions/deletions, upstream ahead/behind counts, and nested submodules.",
    parameters: z.object({
      feature_id: z
        .string()
        .min(1)
        .optional()
        .describe("Feature id from harbor_feature_list. Omit to inspect this thread's feature."),
      base_branch: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Fallback branch name to compare ahead/behind when no upstream tracking branch is set."),
    }),
    async execute({ feature_id, base_branch }, context) {
      const target = await resolveFeatureId(feature_id, context.threadId);
      if ("error" in target) return target.error;
      try {
        const summary = await port.getFeatureGitStatus(
          target.featureId,
          base_branch ?? null,
        );
        if (summary.repos.length === 0) {
          return `Feature ${quoteName(target.name)} has no repositories attached.`;
        }
        const lines = summary.repos.map((repo) => {
          const roleTag = repo.role === "ref" ? "[ref read-only]" : `[${repo.role}]`;
          const branch = repo.branch ?? "detached";
          const delta = `+${repo.additions}/-${repo.deletions}`;
          const aheadBehind =
            repo.aheadCommits !== null || repo.behindCommits !== null
              ? ` (ahead ${repo.aheadCommits ?? 0}, behind ${repo.behindCommits ?? 0})`
              : "";
          const state = repo.clean
            ? "clean"
            : `${repo.changedFiles} changed, ${repo.untrackedFiles} untracked`;
          const sub =
            repo.submodules.length === 0
              ? ""
              : ` | submodules: ${repo.submodules.map((s) => `${s.name}${s.dirty ? "*" : ""}`).join(", ")}`;
          return `- ${repo.directory}/ ${roleTag} on ${branch}${aheadBehind}: ${state} (${delta})${sub}`;
        });
        return [
          `Feature ${quoteName(target.name)} git summary: ${summary.dirtyRepoCount} dirty, ${summary.unpushedRepoCount} unpushed, +${summary.additions}/-${summary.deletions} across ${summary.repos.length} repositories.`,
          ...lines,
        ].join("\n");
      } catch (error) {
        return describeActionError(error);
      }
    },
  });

  registry.register({
    name: "harbor_feature_add_ref",
    feature: "features",
    description:
      "Attach a repository as a read-only reference symlink inside the feature folder instead of creating a new writable worktree branch. Use when consulting contracts, shared SDKs, or upstream services without editing them.",
    parameters: z.object({
      repository: z
        .string()
        .min(1)
        .describe("bb project name or id to link as read-only reference."),
      feature_id: z
        .string()
        .min(1)
        .optional()
        .describe("Feature id from harbor_feature_list. Omit to attach to this thread's feature."),
    }),
    async execute({ repository, feature_id }, context) {
      const target = await resolveFeatureId(feature_id, context.threadId);
      if ("error" in target) return target.error;

      const { resolved, problems } = await resolveProjects([repository]);
      const match = resolved[0];
      if (match === undefined) {
        return problems[0] ?? `Could not find repository ${quoteName(repository)}.`;
      }
      try {
        const result = await port.addReferenceRepo({
          featureId: target.featureId,
          projectId: match.projectId,
        });
        if (result.outcome === "blocked") {
          return `Could not link ${result.repository}: ${result.reason ?? "blocked"}`;
        }
        return `Linked ${result.repository} as a read-only reference at ${result.path}. Do not edit files inside it.`;
      } catch (error) {
        return describeActionError(error);
      }
    },
  });

  registry.register({
    name: "harbor_feature_promote",
    feature: "features",
    description:
      "Promote an existing single-repository worktree or workspace into a multi-repo Harbor feature while preserving its conversation history, and optionally bring sibling repositories in alongside it.",
    parameters: z.object({
      name: z
        .string()
        .trim()
        .min(1)
        .max(60)
        .describe("The new multi-repo feature's name."),
      environment_id: z
        .string()
        .min(1)
        .optional()
        .describe("Environment id of the worktree to promote. Omit to promote this thread's workspace."),
      repositories: z
        .array(z.string().min(1))
        .max(10)
        .optional()
        .describe("Optional additional bb project names or ids to bring in as sibling worktrees."),
      base_branch: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Optional base branch to fork newly created sibling branches from."),
    }),
    async execute({ name, environment_id, repositories, base_branch }, context) {
      const envId =
        environment_id ?? (await port.threadEnvironmentId(context.threadId));
      if (envId === null) {
        return "This thread does not have an environment id to promote. Pass environment_id explicitly.";
      }
      const { resolved, problems } = await resolveProjects(repositories ?? []);
      try {
        const promoted = await port.promote({
          environmentId: envId,
          name,
          baseBranch: base_branch ?? null,
          additionalRepositories: resolved.map((item) => ({
            projectId: item.projectId,
            branch: null,
          })),
        });
        const repoLines = promoted.repositories.map((item) =>
          item.outcome === "blocked"
            ? `- ${item.repository}: blocked (${item.reason ?? "unknown"})`
            : `- ${item.repository}: ${item.outcome} at ${item.path} on ${item.branch}`,
        );
        return [
          `Promoted workspace to feature ${quoteName(promoted.feature.name)} (id ${promoted.feature.id}) at ${promoted.feature.rootPath} (kept environment ${promoted.adoptedEnvironmentId} and its conversation history).`,
          ...repoLines,
          ...problems.map((problem) => `- ${problem}`),
        ].join("\n");
      } catch (error) {
        return describeActionError(error);
      }
    },
  });
}
