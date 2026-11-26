/**
 * Core Harbor Feature tools (`harbor_feature_list`, `harbor_feature_brief`,
 * `harbor_feature_meta`, `harbor_feature_repos`), plus shared resolution
 * helpers reused by `tools-features-cockpit.ts`.
 */

import { z } from "zod";
import type { AgentAccessTier } from "../domain/agent-access.ts";
import type { FeatureGitSummary } from "../domain/feature-git.ts";
import type {
  FeatureBrief,
  FeatureDecision,
  FeatureMeta,
  FeatureRef,
} from "../domain/feature-meta.ts";
import {
  isDraftFeatureName,
  type Feature,
  type FeatureMember,
  type FeatureRefLink,
} from "../domain/features.ts";
import { describeActionError } from "../domain/rpc-error.ts";
import { quoteName } from "./instructions.ts";
import { resolveProjects } from "./resolve-projects.ts";
import type { AgentToolRegistry } from "./toolkit.ts";

export interface FeatureRepositoryOutcome {
  readonly repository: string;
  readonly outcome: "created" | "reused" | "blocked";
  readonly path: string | null;
  readonly branch: string | null;
  readonly role?: "worktree" | "ref";
  readonly setup: readonly string[];
  readonly reason: string | null;
}

export interface FeatureAgentPort {
  readonly locate: (path: string | null) => {
    readonly feature: Feature;
    readonly members: readonly FeatureMember[];
    readonly inRoot: boolean;
  } | null;
  readonly features: () => readonly Feature[];
  readonly membersOf: (featureId: string) => readonly FeatureMember[];
  readonly refLinks: () => readonly FeatureRefLink[];
  readonly threadPath: (threadId: string) => Promise<string | null>;
  readonly threadEnvironmentId: (threadId: string) => Promise<string | null>;
  readonly projects: () => Promise<readonly { readonly id: string; readonly name: string }[]>;
  readonly refresh: () => Promise<unknown>;
  readonly create: (input: {
    name?: string;
    repositories: readonly string[];
    role?: "worktree" | "ref";
  }) => Promise<{ feature: Feature; repositories: readonly FeatureRepositoryOutcome[] }>;
  readonly addRepositories: (input: {
    featureId: string;
    repositories: readonly { projectId: string; branch: string | null }[];
  }) => Promise<readonly FeatureRepositoryOutcome[]>;
  readonly rename: (featureId: string, name: string) => Promise<boolean>;
  readonly renameMemberBranch: (input: {
    featureId: string;
    directory: string;
    branch: string;
  }) => Promise<{ ok: boolean; reason: string | null }>;
  readonly upgradeReferenceRepo: (input: {
    featureId: string;
    directory: string;
    branch?: string | null;
    baseBranch?: string | null;
  }) => Promise<FeatureRepositoryOutcome>;
  readonly reopen: (featureId: string) => Promise<unknown>;
  readonly adopt: (environmentId: string, featureId: string | null) => Promise<boolean>;
  readonly deleteFeature: (input: {
    featureId: string;
    acknowledged: boolean;
    deleteBranches: boolean;
  }) => Promise<{ removedWorktrees: number; leftovers: readonly string[]; removedFolder: boolean }>;
  readonly removeRepository: (input: {
    featureId: string;
    directory: string;
    force: boolean;
  }) => Promise<{ removed: boolean }>;
  readonly meta: (featureId: string) => FeatureMeta;
  readonly setBrief: (
    featureId: string,
    input: {
      readonly goal: string;
      readonly nonGoals: string;
      readonly acceptance: string;
      readonly notes: string;
      readonly openQuestions: readonly string[];
      readonly blockers: readonly string[];
    },
  ) => Promise<FeatureBrief>;
  readonly addDecision: (input: {
    featureId: string;
    title: string;
    choice: string;
    rationale: string;
    alternatives: readonly string[];
    impact: string;
    supersedes: number | null;
    threadId: string;
  }) => Promise<FeatureDecision>;
  readonly addRef: (input: {
    featureId: string;
    kind?: "ticket" | "document" | "link";
    refId?: string;
    url?: string;
    title?: string;
  }) => Promise<FeatureRef>;
  readonly park: (input: {
    featureId: string;
    reason?: string | null;
    note?: string | null;
    wakeAt?: number | null;
    wakeOnActivity?: boolean;
  }) => Promise<Feature>;
  readonly unpark: (featureId: string) => Promise<Feature>;
  readonly promote: (input: {
    environmentId: string;
    name: string;
    baseBranch?: string | null;
    additionalRepositories?: readonly {
      projectId: string;
      branch: string | null;
    }[];
  }) => Promise<{
    feature: Feature;
    adoptedEnvironmentId: string;
    repositories: readonly FeatureRepositoryOutcome[];
  }>;
  readonly addReferenceRepo: (input: {
    featureId: string;
    projectId: string;
  }) => Promise<FeatureRepositoryOutcome>;
  readonly getFeatureGitStatus: (
    featureId: string,
    baseBranch?: string | null,
  ) => Promise<FeatureGitSummary>;
}

export async function resolveFeatureTarget(
  port: FeatureAgentPort,
  explicitId: string | undefined,
  threadId: string,
): Promise<{ featureId: string; name: string } | { error: string }> {
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
}

async function resolveFeatureProjects(
  port: FeatureAgentPort,
  requested: readonly string[],
) {
  return resolveProjects(() => port.projects(), requested);
}

export function describeFeatureOutcomes(
  outcomes: readonly FeatureRepositoryOutcome[],
): string {
  return outcomes
    .map((outcome) => {
      if (outcome.outcome === "blocked") {
        return `- ${outcome.repository || "?"}: not added. ${outcome.reason ?? ""}`;
      }
      const verb = outcome.outcome === "created" ? "added" : "already there";
      const setup = outcome.setup.length > 0 ? ` ${outcome.setup.join(" ")}` : "";
      return `- ${outcome.repository}: ${verb} at ${outcome.path} on ${outcome.branch}.${setup}`;
    })
    .join("\n");
}

export function registerFeatureTools(
  registry: AgentToolRegistry,
  port: FeatureAgentPort,
): void {
  registry.register({
    name: "harbor_feature_list",
    description:
      "List the user's features: each feature's id, name, state, folder path, and repositories. Use it to find where cross-repository work lives.",
    parameters: z.object({}),
    async execute() {
      await port.refresh().catch(() => undefined);
      const features = port.features();
      if (features.length === 0) return "No features yet.";
      return features
        .map((feature) => {
          const members = port.membersOf(feature.id).map((member) => member.directory);
          return `- ${quoteName(feature.name)} (${feature.id}) [${feature.state}] ${feature.rootPath ?? "(no folder)"} — ${members.length === 0 ? "no repositories" : members.join(", ")}`;
        })
        .join("\n");
    },
  });

  registry.register({
    name: "harbor_feature_brief",
    description:
      "Read a feature's goal, acceptance criteria, open questions, blockers, ticket/document references, and full decision log including drafts. Pass feature_id or omit for this thread's feature.",
    parameters: z.object({
      feature_id: z
        .string()
        .min(1)
        .optional()
        .describe("Feature id from harbor_feature_list. Omit for this thread's feature."),
    }),
    async execute({ feature_id }, context) {
      const target = await resolveFeatureTarget(port, feature_id, context.threadId);
      if ("error" in target) return target.error;
      return describeMeta(port.meta(target.featureId));
    },
  });

  registry.register({
    name: "harbor_feature_meta",
    description:
      "Update a feature's requirement brief (action 'brief' with goal, non_goals, acceptance, notes, open_questions, blockers), record a draft decision (action 'decide' with title, choice, rationale, alternatives, impact, supersedes), or attach a ticket/document link (action 'link' with url, ref_id, title, kind).",
    parameters: z.object({
      action: z
        .enum(["brief", "decide", "link"])
        .describe("Update requirement brief ('brief'), record a draft decision ('decide'), or attach a reference link ('link')."),
      feature_id: z
        .string()
        .min(1)
        .optional()
        .describe("Feature id from harbor_feature_list. Omit for this thread's feature."),
      goal: z
        .string()
        .max(4000)
        .optional()
        .describe("Goal of this feature (for 'brief')."),
      non_goals: z
        .string()
        .max(4000)
        .optional()
        .describe("Explicit non-goals / out-of-scope notes (for 'brief')."),
      acceptance: z
        .string()
        .max(4000)
        .optional()
        .describe("Acceptance criteria (for 'brief')."),
      notes: z
        .string()
        .max(4000)
        .optional()
        .describe("Additional notes for this feature (for 'brief')."),
      open_questions: z
        .array(z.string().max(500))
        .max(20)
        .optional()
        .describe("Unresolved questions list (for 'brief')."),
      blockers: z
        .array(z.string().max(500))
        .max(20)
        .optional()
        .describe("Current blockers list (for 'brief')."),
      title: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe("One-line decision summary (for 'decide') or short reference title (for 'link')."),
      choice: z
        .string()
        .trim()
        .max(4000)
        .optional()
        .describe("What was chosen (required for 'decide')."),
      rationale: z
        .string()
        .max(8000)
        .default("")
        .describe("Why this choice was made (for 'decide')."),
      alternatives: z
        .array(z.string().max(500))
        .max(10)
        .optional()
        .describe("Rejected options and why (for 'decide')."),
      impact: z
        .string()
        .max(2000)
        .default("")
        .describe("Downstream impact across code, data, or repositories (for 'decide')."),
      supersedes: z
        .number()
        .int()
        .positive()
        .nullable()
        .optional()
        .describe("Decision seq this overturns (for 'decide')."),
      url: z
        .string()
        .max(2000)
        .optional()
        .describe("http(s) URL of the ticket or document (for 'link')."),
      ref_id: z
        .string()
        .max(200)
        .optional()
        .describe("Ticket or document number (for 'link')."),
      kind: z
        .enum(["ticket", "document", "link"])
        .optional()
        .describe("Reference kind; inferred from URL when omitted (for 'link')."),
    }),
    async execute(params, context) {
      const target = await resolveFeatureTarget(port, params.feature_id, context.threadId);
      if ("error" in target) return target.error;

      if (params.action === "brief") {
        const provided: string[] = [];
        if (params.goal !== undefined) provided.push("goal");
        if (params.non_goals !== undefined) provided.push("non_goals");
        if (params.acceptance !== undefined) provided.push("acceptance");
        if (params.notes !== undefined) provided.push("notes");
        if (params.open_questions !== undefined) provided.push("open_questions");
        if (params.blockers !== undefined) provided.push("blockers");
        if (provided.length === 0) {
          return "Provide at least one brief field (goal, acceptance, non_goals, notes, open_questions, blockers) when action is 'brief'.";
        }
        const current = port.meta(target.featureId).brief;
        await port.setBrief(target.featureId, {
          goal: params.goal ?? current.goal,
          nonGoals: params.non_goals ?? current.nonGoals,
          acceptance: params.acceptance ?? current.acceptance,
          notes: params.notes ?? current.notes,
          openQuestions: params.open_questions ?? current.openQuestions,
          blockers: params.blockers ?? current.blockers,
        });
        return `Updated feature brief (${provided.join(", ")}) on ${quoteName(target.name)}.`;
      }

      if (params.action === "decide") {
        const title = params.title?.trim() ?? "";
        const choice = params.choice?.trim() ?? "";
        if (title.length === 0 || choice.length === 0) {
          return "title and choice are required when action is 'decide'.";
        }
        const decision = await port.addDecision({
          featureId: target.featureId,
          title,
          choice,
          rationale: params.rationale,
          alternatives: params.alternatives ?? [],
          impact: params.impact,
          supersedes: params.supersedes ?? null,
          threadId: context.threadId,
        });
        const supersedeNote =
          decision.supersedes === null
            ? ""
            : ` It overturns #${decision.supersedes} once confirmed.`;
        return `Recorded draft #${decision.seq} ${quoteName(decision.title)}. It is not a decision until the user confirms it in the Harbor sidebar.${supersedeNote}`;
      }

      if (
        params.url === undefined &&
        params.ref_id === undefined &&
        (params.title === undefined || params.title.trim().length === 0)
      ) {
        return "Provide at least one of url, ref_id, or title when action is 'link'.";
      }
      const ref = await port.addRef({
        featureId: target.featureId,
        ...(params.kind === undefined ? {} : { kind: params.kind }),
        ...(params.ref_id === undefined ? {} : { refId: params.ref_id }),
        ...(params.url === undefined ? {} : { url: params.url }),
        ...(params.title === undefined ? {} : { title: params.title }),
      });
      return `Linked ${ref.kind} ${quoteName(ref.title)}${ref.url === null ? "" : ` — ${ref.url}`}.`;
    },
  });

  registry.register({
    name: "harbor_feature_repos",
    description:
      "Manage repositories inside a feature (feature_id optional): add worktrees or read-only refs ('add'), rename a member worktree's git branch ('rename_branch'), upgrade a read-only ref symlink into a writable git worktree ('upgrade_ref'), or remove one repository ('remove', requires acknowledged: true on second call).",
    parameters: z.object({
      action: z
        .enum(["add", "remove", "rename_branch", "upgrade_ref"])
        .describe("Action: 'add', 'remove', 'rename_branch', or 'upgrade_ref'."),
      role: z
        .enum(["worktree", "ref"])
        .default("worktree")
        .describe("For 'add': 'worktree' creates writable worktrees; 'ref' links read-only references."),
      repositories: z
        .array(z.string().min(1))
        .min(1)
        .max(10)
        .optional()
        .describe("For 'add': bb project names or ids; for 'upgrade_ref': optional ref folder names to upgrade."),
      branch: z
        .string()
        .min(1)
        .max(200)
        .nullable()
        .optional()
        .describe("Branch name for 'add', 'rename_branch', or 'upgrade_ref'; omit for suggested branch on add/upgrade."),
      base_branch: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Optional base branch to fork from when upgrading a ref via 'upgrade_ref'."),
      folder: z
        .string()
        .min(1)
        .optional()
        .describe("Repository folder name inside the feature folder (for 'remove', 'rename_branch', or 'upgrade_ref')."),
      feature_id: z
        .string()
        .min(1)
        .optional()
        .describe("Feature id from harbor_feature_list. Omit for this thread's feature."),
      force: z
        .boolean()
        .default(false)
        .describe("For 'remove': discard uncommitted and untracked files. Only with explicit user agreement."),
      acknowledged: z
        .boolean()
        .default(false)
        .describe("Required true on a second call for 'remove' after showing what will be removed."),
    }),
    async execute(params, context) {
      const target = await resolveFeatureTarget(port, params.feature_id, context.threadId);
      if ("error" in target) return target.error;

      if (params.action === "add") {
        if (params.repositories === undefined || params.repositories.length === 0) {
          return "repositories is required when action is 'add'.";
        }
        const { resolved, problems } = await resolveFeatureProjects(port, params.repositories);
        if (params.role === "ref") {
          const lines: string[] = [];
          for (const item of resolved) {
            try {
              const result = await port.addReferenceRepo({
                featureId: target.featureId,
                projectId: item.projectId,
              });
              lines.push(
                result.outcome === "blocked"
                  ? `- ${result.repository}: blocked (${result.reason ?? "blocked"})`
                  : `- ${result.repository}: linked as read-only reference at ${result.path}. Do not edit files inside it.`,
              );
            } catch (error) {
              lines.push(`- ${item.asked}: ${describeActionError(error)}`);
            }
          }
          return [...lines, ...problems.map((problem) => `- ${problem}`)].join("\n");
        }

        const outcomes =
          resolved.length === 0
            ? []
            : await port.addRepositories({
                featureId: target.featureId,
                repositories: resolved.map((item) => ({
                  projectId: item.projectId,
                  branch: params.branch ?? null,
                })),
              });
        const install = outcomes.some((outcome) => outcome.outcome === "created")
          ? "\nDependencies are not installed in new worktrees; AGENTS.md lists each repository's install command."
          : "";
        return (
          [describeFeatureOutcomes(outcomes), ...problems.map((problem) => `- ${problem}`)]
            .filter((part) => part.length > 0)
            .join("\n") + install
        );
      }

      if (params.action === "rename_branch") {
        const folder = params.folder?.trim() ?? "";
        const branch = params.branch?.trim() ?? "";
        if (folder.length === 0 || branch.length === 0) {
          return "folder and branch are required when action is 'rename_branch'.";
        }
        const outcome = await port.renameMemberBranch({
          featureId: target.featureId,
          directory: folder,
          branch,
        });
        return outcome.ok
          ? `Renamed branch in ${folder}/ to ${quoteName(branch)}.`
          : `Could not rename branch in ${folder}/: ${outcome.reason ?? "refused."}`;
      }

      if (params.action === "upgrade_ref") {
        const refMembers = port.membersOf(target.featureId).filter((member) => member.role === "ref");
        const requestedFolders: string[] = [];
        const errors: string[] = [];
        if (params.folder !== undefined && params.folder.trim().length > 0) {
          requestedFolders.push(params.folder.trim());
        } else if (params.repositories !== undefined && params.repositories.length > 0) {
          for (const asked of params.repositories) {
            const match = refMembers.find(
              (member) =>
                member.directory === asked || member.repository.toLowerCase() === asked.toLowerCase(),
            );
            if (match !== undefined) requestedFolders.push(match.directory);
            else errors.push(`- ${asked}: no matching read-only ref repository in ${quoteName(target.name)}.`);
          }
        } else {
          return refMembers.length === 0
            ? "This feature has no read-only ref repositories to upgrade."
            : `Specify folder (or repositories) to upgrade from ref to worktree: ${refMembers.map((member) => member.directory).join(", ")}.`;
        }
        const outcomes: FeatureRepositoryOutcome[] = [];
        for (const directory of new Set(requestedFolders)) {
          outcomes.push(
            await port.upgradeReferenceRepo({
              featureId: target.featureId,
              directory,
              branch: params.branch ?? null,
              baseBranch: params.base_branch ?? null,
            }),
          );
        }
        const install = outcomes.some((outcome) => outcome.outcome === "created")
          ? "\nDependencies are not installed in new worktrees; AGENTS.md lists each repository's install command."
          : "";
        return (
          [describeFeatureOutcomes(outcomes), ...errors].filter((part) => part.length > 0).join("\n") +
          install
        );
      }

      if (params.folder === undefined) {
        return "folder is required when action is 'remove'.";
      }
      if (!params.acknowledged) {
        return `This will remove ${params.folder}/ from feature ${target.featureId}, remove its worktree, and archive its threads. Call again with acknowledged true to proceed.`;
      }
      const result = await port.removeRepository({
        featureId: target.featureId,
        directory: params.folder,
        force: params.force,
      });
      return result.removed
        ? `Removed ${params.folder}/ from the feature. Its branch is kept.`
        : `git did not take ${params.folder}/ back; it may need to be removed by hand.`;
    },
  });
}

function describeMeta(meta: FeatureMeta): string {
  const { brief } = meta;
  const parts: string[] = [];
  const field = (label: string, value: string) =>
    value.trim().length === 0 ? "" : `${label}: ${value.trim()}`;
  const requirement = [
    field("Goal", brief.goal),
    field("Not this work", brief.nonGoals),
    field("Acceptance", brief.acceptance),
    field("Notes", brief.notes),
  ].filter((line) => line.length > 0);
  parts.push(
    requirement.length === 0
      ? "Requirement: nothing written yet."
      : `Requirement\n${requirement.join("\n")}`,
  );
  if (brief.openQuestions.length > 0) {
    parts.push(`Open questions\n${brief.openQuestions.map((item) => `- ${item}`).join("\n")}`);
  }
  if (brief.blockers.length > 0) {
    parts.push(`Blockers\n${brief.blockers.map((item) => `- ${item}`).join("\n")}`);
  }
  parts.push(
    meta.refs.length === 0
      ? "References: none."
      : `References\n${meta.refs.map(describeRef).join("\n")}`,
  );
  parts.push(
    meta.decisions.length === 0
      ? "Decisions: none."
      : `Decisions\n${meta.decisions.map(describeDecision).join("\n")}`,
  );
  return parts.join("\n\n");
}

function describeRef(ref: FeatureRef): string {
  const id = ref.refId === null ? "" : ` ${ref.refId}`;
  const link = ref.url === null ? "" : ` ${ref.url}`;
  return `- ${ref.kind}${id}: ${ref.title}${link}`;
}

function describeDecision(decision: FeatureDecision): string {
  const lines = [
    `- #${decision.seq} [${decision.status}, ${decision.author}] ${decision.title} — ${decision.choice}`,
  ];
  if (decision.supersedes !== null) {
    lines.push(`  Supersedes #${decision.supersedes}.`);
  }
  if (decision.supersededBy !== null) {
    lines.push(`  Superseded by #${decision.supersededBy}.`);
  }
  if (decision.rationale.trim().length > 0) {
    lines.push(`  Why: ${decision.rationale.trim()}`);
  }
  if (decision.alternativesRejected.length > 0) {
    lines.push(`  Rejected: ${decision.alternativesRejected.join(" · ")}`);
  }
  if (decision.impact.trim().length > 0) {
    lines.push(`  Impact: ${decision.impact.trim()}`);
  }
  return lines.join("\n");
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Renders an explicit multi-repo directory topology tag for threads running
 * inside a Harbor feature so agents respect read-only `ref` links.
 */
function renderWorkspaceFoldersXml(
  located: NonNullable<ReturnType<FeatureAgentPort["locate"]>>,
): string {
  const { feature, members } = located;
  const lines = ["<workspace_folders>"];
  if (feature.rootPath !== null) {
    lines.push(
      `  <folder role="root" path="${escapeXmlAttr(feature.rootPath)}" name="${escapeXmlAttr(feature.name)}" />`,
    );
  }
  for (const member of members) {
    const role = member.role ?? "worktree";
    const readonlyAttr = role === "ref" ? ' readonly="true"' : "";
    const branchAttr =
      member.branch === null ? "" : ` branch="${escapeXmlAttr(member.branch)}"`;
    const parentAttr =
      member.parentDirectory ? ` parent="${escapeXmlAttr(member.parentDirectory)}"` : "";
    lines.push(
      `  <folder role="${role}"${readonlyAttr} directory="${escapeXmlAttr(member.directory)}" path="${escapeXmlAttr(member.path)}" repo="${escapeXmlAttr(member.repository)}"${branchAttr}${parentAttr} />`,
    );
  }
  lines.push("</workspace_folders>");
  return lines.join("\n");
}

/**
 * Short context injected into threads running inside a Harbor feature folder.
 */
export function featureInstructions(
  located: NonNullable<ReturnType<FeatureAgentPort["locate"]>>,
  options?: { readonly tier?: AgentAccessTier },
): string {
  const { feature, members, inRoot } = located;
  const tier = options?.tier ?? "read-only";
  const here = inRoot
    ? `This thread runs in the feature folder ${feature.rootPath} itself.`
    : `This thread runs inside one repository of the feature; its siblings are next to it under ${feature.rootPath}.`;
  const list =
    members.length === 0
      ? tier === "full"
        ? "It has no repositories yet; harbor_feature_repos brings them in."
        : "It has no repositories yet."
      : `Repositories: ${members.map((member) => `${member.directory}/ (${member.role === "ref" ? "read-only ref" : (member.branch ?? "detached")})`).join(", ")}.`;
  const isDiscussionDraft =
    isDraftFeatureName(feature.name) ||
    (members.length > 0 && members.every((member) => member.role === "ref"));
  const infoHint =
    tier === "full"
      ? [
          ...(isDiscussionDraft
            ? [
                "Draft/discussion mode: after aligning on requirements with the user, propose the final feature name, brief, and target branch(es), then call harbor_feature_lifecycle(action='update_info') once confirmed.",
              ]
            : []),
          "When asked to update Feature Info, call harbor_feature_lifecycle(action='update_info') to update name, brief, reference links, and repo branches (or upgrade ref links into worktrees).",
        ]
      : [];
  return [
    `## Harbor feature ${quoteName(feature.name)}`,
    here,
    list,
    `Read ${feature.rootPath}/AGENTS.md before acting: it has the working rules, what this work is for, and the decisions that stand. Call harbor_feature_brief when you need the full reasoning.`,
    "Run git with -C <repository folder>; the feature folder is not a repository. Never modify files inside readonly ref folders.",
    ...infoHint,
    renderWorkspaceFoldersXml(located),
  ].join("\n");
}
