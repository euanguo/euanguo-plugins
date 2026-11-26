/**
 * Harbor Feature Cockpit agent tools: read-only multi-repo git status
 * (`harbor_feature_git_status`) and consolidated feature lifecycle management
 * (`harbor_feature_lifecycle`).
 */

import { z } from "zod";
import { quoteName } from "./instructions.ts";
import { resolveProjects } from "./resolve-projects.ts";
import type { AgentToolRegistry } from "./toolkit.ts";
import {
  describeFeatureOutcomes,
  resolveFeatureTarget,
  type FeatureAgentPort,
} from "./tools-features.ts";

const FEATURE_LIFECYCLE_ACTIONS = [
  "create",
  "rename",
  "update_info",
  "park",
  "unpark",
  "reopen",
  "promote",
  "adopt",
  "delete",
] as const;

const repoBranchSpecSchema = z.object({
  folder: z.string().trim().min(1).describe("Member folder or repository name inside the feature."),
  branch: z.string().trim().min(1).max(200).describe("Target branch name for this repository."),
  upgrade_ref: z
    .boolean()
    .optional()
    .describe("When the member is a read-only ref, upgrade it to a writable worktree on this branch (default true)."),
  base_branch: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Optional base branch when upgrading a ref into a new worktree."),
});

interface UpdateInfoParams {
  readonly name?: string;
  readonly goal?: string;
  readonly non_goals?: string;
  readonly acceptance?: string;
  readonly notes?: string;
  readonly open_questions?: readonly string[];
  readonly blockers?: readonly string[];
  readonly branch?: string;
  readonly base_branch?: string;
  readonly repo_branches?: readonly z.infer<typeof repoBranchSpecSchema>[];
  readonly initialize_refs?: boolean;
  readonly ref_url?: string;
  readonly ref_id?: string;
  readonly ref_title?: string;
  readonly ref_kind?: "ticket" | "document" | "link";
}

async function executeUpdateInfo(
  port: FeatureAgentPort,
  featureId: string,
  currentName: string,
  params: UpdateInfoParams,
): Promise<string> {
  const hasBrief =
    params.goal !== undefined ||
    params.non_goals !== undefined ||
    params.acceptance !== undefined ||
    params.notes !== undefined ||
    params.open_questions !== undefined ||
    params.blockers !== undefined;
  const hasRefLink =
    params.ref_url !== undefined ||
    params.ref_id !== undefined ||
    (params.ref_title !== undefined && params.ref_title.trim().length > 0);
  const hasRepoUpdate =
    params.branch !== undefined ||
    (params.repo_branches !== undefined && params.repo_branches.length > 0) ||
    params.initialize_refs === true;
  const nextName = params.name?.trim();
  const hasName = nextName !== undefined && nextName.length > 0;

  if (!hasName && !hasBrief && !hasRefLink && !hasRepoUpdate) {
    return "Provide at least one field to update: name, goal/acceptance/non_goals/notes/open_questions/blockers, ref_url/ref_id/ref_title, branch, repo_branches, or initialize_refs.";
  }

  const lines: string[] = [];
  let createdWorktree = false;

  if (hasName && nextName !== currentName) {
    const renamed = await port.rename(featureId, nextName);
    lines.push(
      renamed
        ? `- Feature renamed: ${quoteName(currentName)} -> ${quoteName(nextName)}`
        : `- Feature rename to ${quoteName(nextName)} refused.`,
    );
  }

  if (hasBrief) {
    const currentBrief = port.meta(featureId).brief;
    const updatedFields = [
      params.goal !== undefined ? "goal" : null,
      params.non_goals !== undefined ? "non_goals" : null,
      params.acceptance !== undefined ? "acceptance" : null,
      params.notes !== undefined ? "notes" : null,
      params.open_questions !== undefined ? "open_questions" : null,
      params.blockers !== undefined ? "blockers" : null,
    ].filter((field): field is string => field !== null);
    await port.setBrief(featureId, {
      goal: params.goal ?? currentBrief.goal,
      nonGoals: params.non_goals ?? currentBrief.nonGoals,
      acceptance: params.acceptance ?? currentBrief.acceptance,
      notes: params.notes ?? currentBrief.notes,
      openQuestions: params.open_questions ?? currentBrief.openQuestions,
      blockers: params.blockers ?? currentBrief.blockers,
    });
    lines.push(`- Requirement brief updated (${updatedFields.join(", ")})`);
  }

  if (hasRefLink) {
    const ref = await port.addRef({
      featureId,
      ...(params.ref_kind === undefined ? {} : { kind: params.ref_kind }),
      ...(params.ref_id === undefined ? {} : { refId: params.ref_id }),
      ...(params.ref_url === undefined ? {} : { url: params.ref_url }),
      ...(params.ref_title === undefined ? {} : { title: params.ref_title }),
    });
    lines.push(`- Linked ${ref.kind}: ${quoteName(ref.title)}`);
  }

  if (hasRepoUpdate) {
    await port.refresh().catch(() => undefined);
    const members = port.membersOf(featureId);
    const handledDirectories = new Set<string>();

    const applyBranchOrUpgrade = async (
      member: (typeof members)[number],
      branch: string | null,
      upgradeRef: boolean,
      baseBranch: string | null,
    ) => {
      if (member.role === "ref") {
        if (!upgradeRef) {
          lines.push(`- ${member.directory}/: kept as read-only ref.`);
          return;
        }
        const upgraded = await port.upgradeReferenceRepo({
          featureId,
          directory: member.directory,
          branch,
          baseBranch,
        });
        if (upgraded.outcome === "created") createdWorktree = true;
        lines.push(describeFeatureOutcomes([upgraded]));
        return;
      }
      if (member.role === "submodule") {
        lines.push(`- ${member.directory}/: skipped submodule.`);
        return;
      }
      if (branch === null || branch.trim().length === 0) return;
      const renamed = await port.renameMemberBranch({
        featureId,
        directory: member.directory,
        branch: branch.trim(),
      });
      lines.push(
        renamed.ok
          ? `- ${member.directory}/: branch renamed to ${branch.trim()}`
          : `- ${member.directory}/: branch rename failed (${renamed.reason ?? "refused"})`,
      );
    };

    for (const spec of params.repo_branches ?? []) {
      const member = members.find(
        (candidate) =>
          candidate.directory === spec.folder ||
          candidate.repository.toLowerCase() === spec.folder.toLowerCase(),
      );
      if (member === undefined) {
        lines.push(`- ${spec.folder}: not found in this feature.`);
        continue;
      }
      handledDirectories.add(member.directory);
      await applyBranchOrUpgrade(
        member,
        spec.branch,
        spec.upgrade_ref !== false,
        spec.base_branch ?? params.base_branch ?? null,
      );
    }

    if (params.branch !== undefined || params.initialize_refs === true) {
      for (const member of members) {
        if (handledDirectories.has(member.directory)) continue;
        if (member.role === "ref" && params.initialize_refs !== true) continue;
        await applyBranchOrUpgrade(
          member,
          params.branch ?? null,
          params.initialize_refs === true,
          params.base_branch ?? null,
        );
      }
    }
  }

  if (createdWorktree) {
    lines.push(
      "Dependencies are not installed in newly initialized worktrees; AGENTS.md lists each repository's install command.",
    );
  }
  return [`Updated Feature Info for ${quoteName(hasName ? nextName : currentName)}:`, ...lines].join("\n");
}

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
    },
  });

  registry.register({
    name: "harbor_feature_lifecycle",
    description:
      "Manage Harbor feature lifecycle: create (optional name — omits to auto-generate a draft name, optional repositories, optional role 'worktree' | 'ref'), rename (name, feature_id), update_info (atomic/coordinated Feature Info update after requirement clarification: name, goal/non_goals/acceptance/notes/open_questions/blockers, ref_url/ref_id/ref_title, branch, repo_branches, initialize_refs), park/unpark, reopen, promote, adopt, or delete (requires acknowledged: true on second call).",
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
        .max(60)
        .optional()
        .describe("Feature name (for create [optional draft], rename, update_info, promote)."),
      repositories: z
        .array(z.string().min(1))
        .max(10)
        .optional()
        .describe("Optional bb project names or ids (for create, promote)."),
      role: z
        .enum(["worktree", "ref"])
        .optional()
        .describe("For create: initial repository role ('worktree' or read-only 'ref' for draft discussion)."),
      branch: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional()
        .describe("For update_info: target branch applied to writable member worktrees (and initialized refs)."),
      repo_branches: z
        .array(repoBranchSpecSchema)
        .max(20)
        .optional()
        .describe("For update_info: per-repo branch renames or ref->worktree upgrades."),
      initialize_refs: z
        .boolean()
        .optional()
        .describe("For update_info: upgrade remaining read-only ref repositories into writable worktrees."),
      goal: z.string().max(4000).optional().describe("For update_info: feature requirement goal."),
      non_goals: z.string().max(4000).optional().describe("For update_info: out-of-scope notes."),
      acceptance: z.string().max(4000).optional().describe("For update_info: acceptance criteria."),
      notes: z.string().max(4000).optional().describe("For update_info: additional brief notes."),
      open_questions: z.array(z.string().max(500)).max(20).optional().describe("For update_info: open questions."),
      blockers: z.array(z.string().max(500)).max(20).optional().describe("For update_info: blockers."),
      ref_url: z.string().max(2000).optional().describe("For update_info: reference PRD or ticket URL."),
      ref_id: z.string().max(200).optional().describe("For update_info: reference ticket or doc ID."),
      ref_title: z.string().max(300).optional().describe("For update_info: reference link title."),
      ref_kind: z.enum(["ticket", "document", "link"]).optional().describe("For update_info: reference link kind."),
      base_branch: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Optional base branch to fork sibling branches from (for promote / update_info ref upgrades)."),
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
          const { resolved, problems } = await resolveProjects(
            () => port.projects(),
            params.repositories ?? [],
          );
          const created = await port.create({
            ...(name.length > 0 ? { name } : {}),
            repositories: resolved.map((item) => item.projectId),
            ...(params.role === undefined ? {} : { role: params.role }),
          });
          return [
            `Created ${quoteName(created.feature.name)} (id ${created.feature.id}) at ${created.feature.rootPath}. A thread started in that folder works across its repositories.`,
            describeFeatureOutcomes(created.repositories),
            ...problems.map((problem) => `- ${problem}`),
          ]
            .filter((part) => part.length > 0)
            .join("\n");
        }

        case "update_info": {
          if (params.feature_id === null) {
            return "feature_id cannot be null for update_info.";
          }
          const target = await resolveFeatureTarget(
            port,
            params.feature_id,
            context.threadId,
          );
          if ("error" in target) return target.error;
          return executeUpdateInfo(port, target.featureId, target.name, params);
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
          const updated = await port.unpark(target.featureId);
          return `Woke ${quoteName(updated.name)}; it is active again.`;
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
          const { resolved, problems } = await resolveProjects(
            () => port.projects(),
            params.repositories ?? [],
          );
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
        }

        default: {
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }
    },
  });
}
