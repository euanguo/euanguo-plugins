/**
 * Harbor Feature Cockpit agent tools: read-only multi-repo git status
 * (`harbor_feature_git_status`) and consolidated feature lifecycle management
 * (`harbor_feature_lifecycle`).
 */

import { z } from "zod";
import { describeActionError } from "../domain/rpc-error.ts";
import { quoteName } from "./instructions.ts";
import type { AgentToolRegistry } from "./toolkit.ts";
import {
  describeFeatureOutcomes,
  resolveFeatureProjects,
  resolveFeatureTarget,
  type FeatureAgentPort,
} from "./tools-features.ts";

const FEATURE_LIFECYCLE_ACTIONS = [
  "create",
  "rename",
  "park",
  "unpark",
  "reopen",
  "promote",
  "adopt",
  "delete",
] as const;

export function registerFeatureCockpitTools(
  registry: AgentToolRegistry,
  port: FeatureAgentPort,
): void {
  registry.register({
    name: "harbor_feature_git_status",
    description:
      "Inspect aggregated git status across every repository in the feature (feature_id optional; base_branch fallback): changed/untracked counts, diff additions/deletions, upstream ahead/behind counts, and nested submodules.",
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
      const target = await resolveFeatureTarget(port, feature_id, context.threadId);
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
    name: "harbor_feature_lifecycle",
    description:
      "Manage Harbor feature lifecycle: create (name, repositories), rename (name, feature_id), park (feature_id, reason, note, wake_at, wake_on_activity), unpark (feature_id), reopen (feature_id), promote a workspace into a feature (name, environment_id, repositories, base_branch), adopt or release a worktree (environment_id, feature_id or null), or delete a feature (feature_id, delete_branches, acknowledged true on second call after preview).",
    parameters: z.object({
      action: z
        .enum(FEATURE_LIFECYCLE_ACTIONS)
        .describe("The lifecycle action to perform."),
      feature_id: z
        .string()
        .min(1)
        .nullable()
        .optional()
        .describe("Feature id from harbor_feature_list. For 'adopt', pass null to release; omit inside a feature."),
      name: z
        .string()
        .trim()
        .min(1)
        .max(60)
        .optional()
        .describe("Feature name (for create, rename, promote)."),
      repositories: z
        .array(z.string().min(1))
        .max(10)
        .optional()
        .describe("Optional bb project names or ids (for create, promote)."),
      base_branch: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Optional base branch to fork sibling branches from (for promote)."),
      environment_id: z
        .string()
        .min(1)
        .optional()
        .describe("Environment id (for adopt, or optional for promote)."),
      reason: z
        .string()
        .trim()
        .max(60)
        .optional()
        .describe("Short status tag (for park), e.g. waiting-qa."),
      note: z
        .string()
        .trim()
        .max(240)
        .optional()
        .describe("Context note shown on Parked shelf (for park)."),
      wake_at: z
        .string()
        .trim()
        .optional()
        .describe("Optional ISO 8601 future timestamp to wake automatically (for park)."),
      wake_on_activity: z
        .boolean()
        .optional()
        .describe("Wake automatically when any thread in this feature becomes active (for park)."),
      delete_branches: z
        .boolean()
        .default(false)
        .describe("For delete: also delete the branches this feature created."),
      acknowledged: z
        .boolean()
        .default(false)
        .describe("Required true on a second call for delete after user confirmation."),
    }),
    async execute(params, context) {
      const { action } = params;
      switch (action) {
        case "create": {
          const name = params.name?.trim() ?? "";
          if (name.length === 0) return "name is required for create.";
          const { resolved, problems } = await resolveFeatureProjects(
            port,
            params.repositories ?? [],
          );
          const created = await port.create({
            name,
            repositories: resolved.map((item) => item.projectId),
          });
          return [
            `Created ${quoteName(created.feature.name)} (id ${created.feature.id}) at ${created.feature.rootPath}. A thread started in that folder works across its repositories.`,
            describeFeatureOutcomes(created.repositories),
            ...problems.map((problem) => `- ${problem}`),
          ]
            .filter((part) => part.length > 0)
            .join("\n");
        }

        case "rename": {
          const name = params.name?.trim() ?? "";
          if (name.length === 0) return "name is required for rename.";
          if (params.feature_id === null) {
            return "feature_id cannot be null for rename.";
          }
          const target = await resolveFeatureTarget(
            port,
            params.feature_id,
            context.threadId,
          );
          if ("error" in target) return target.error;
          const renamed = await port.rename(target.featureId, name);
          return renamed
            ? `Renamed ${quoteName(target.name)} to ${quoteName(name)}.`
            : `Could not rename ${target.featureId}; it may be gone, or the name refused.`;
        }

        case "park": {
          if (params.feature_id === null) {
            return "feature_id cannot be null for park.";
          }
          const target = await resolveFeatureTarget(
            port,
            params.feature_id,
            context.threadId,
          );
          if ("error" in target) return target.error;

          let parsedWakeAt: number | null = null;
          if (params.wake_at !== undefined && params.wake_at.length > 0) {
            const ts = Date.parse(params.wake_at);
            if (!Number.isFinite(ts)) {
              return `Could not read wake_at ${quoteName(params.wake_at)}; pass an ISO 8601 timestamp.`;
            }
            if (ts <= Date.now()) {
              return `wake_at ${quoteName(params.wake_at)} is in the past; pass a future timestamp.`;
            }
            parsedWakeAt = ts;
          }
          try {
            const parked = await port.park({
              featureId: target.featureId,
              reason: params.reason ?? null,
              note: params.note ?? null,
              wakeAt: parsedWakeAt,
              wakeOnActivity: params.wake_on_activity ?? true,
            });
            const wakeInfo =
              parked.wakeAt !== null && parked.wakeAt !== undefined
                ? ` Wake scheduled for ${new Date(parked.wakeAt).toISOString()}.`
                : "";
            return `Parked ${quoteName(parked.name)}.${wakeInfo}`;
          } catch (error) {
            return describeActionError(error);
          }
        }

        case "unpark": {
          if (params.feature_id === null) {
            return "feature_id cannot be null for unpark.";
          }
          const target = await resolveFeatureTarget(
            port,
            params.feature_id,
            context.threadId,
          );
          if ("error" in target) return target.error;
          try {
            const updated = await port.unpark(target.featureId);
            return `Woke ${quoteName(updated.name)}; it is active again.`;
          } catch (error) {
            return describeActionError(error);
          }
        }

        case "reopen": {
          if (typeof params.feature_id !== "string" || params.feature_id.length === 0) {
            return "feature_id is required for reopen.";
          }
          await port.reopen(params.feature_id);
          return `Reopened ${params.feature_id}. Add repositories again with harbor_feature_repos if work resumes.`;
        }

        case "promote": {
          const name = params.name?.trim() ?? "";
          if (name.length === 0) return "name is required for promote.";
          const envId =
            params.environment_id ??
            (await port.threadEnvironmentId(context.threadId));
          if (envId === null) {
            return "This thread does not have an environment id to promote. Pass environment_id explicitly.";
          }
          const { resolved, problems } = await resolveFeatureProjects(
            port,
            params.repositories ?? [],
          );
          try {
            const promoted = await port.promote({
              environmentId: envId,
              name,
              baseBranch: params.base_branch ?? null,
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
        }

        case "adopt": {
          if (params.environment_id === undefined) {
            return "environment_id is required for adopt.";
          }
          let targetFeatureId: string | null;
          let targetName: string | null = null;
          if (params.feature_id === undefined) {
            const located = await resolveFeatureTarget(
              port,
              undefined,
              context.threadId,
            );
            if ("error" in located) return located.error;
            targetFeatureId = located.featureId;
            targetName = located.name;
          } else {
            targetFeatureId = params.feature_id;
          }
          const adopted = await port.adopt(params.environment_id, targetFeatureId);
          if (!adopted) {
            return `Could not file ${params.environment_id}; the feature may be gone.`;
          }
          return targetFeatureId === null
            ? `Released ${params.environment_id} from its feature.`
            : `Filed ${params.environment_id} under ${quoteName(targetName ?? targetFeatureId)}.`;
        }

        case "delete": {
          if (typeof params.feature_id !== "string" || params.feature_id.length === 0) {
            return "feature_id is required for delete.";
          }
          if (!params.acknowledged) {
            return `This would delete the feature ${params.feature_id}, its worktrees and its folder, permanently. Call again with acknowledged true to proceed.`;
          }
          try {
            const result = await port.deleteFeature({
              featureId: params.feature_id,
              acknowledged: true,
              deleteBranches: params.delete_branches,
            });
            return [
              `Deleted the feature: ${result.removedWorktrees} worktree${result.removedWorktrees === 1 ? "" : "s"} removed.`,
              result.leftovers.length === 0
                ? ""
                : `Left on disk: ${result.leftovers.join(", ")}.`,
              result.removedFolder
                ? "The folder was removed."
                : "The folder was kept because it still holds something Harbor did not write.",
            ]
              .filter((part) => part.length > 0)
              .join(" ");
          } catch (error) {
            return describeActionError(error);
          }
        }

        default: {
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }
    },
  });
}
