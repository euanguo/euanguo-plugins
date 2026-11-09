/**
 * What an agent can do about the feature it is working in.
 *
 * A feature is one piece of work across several repositories, living in one
 * folder whose subfolders are git worktrees. An agent started in that folder
 * already knows where it is — the configuration hook says so, and `AGENTS.md`
 * says so again — so these tools are about the one thing the folder cannot do
 * for itself: bring another repository in without the agent running
 * `git worktree add` and getting the branch, the path or the setup wrong.
 *
 * Taking a repository out is not here. It removes a worktree, and like every
 * other removal in this plugin it is reachable by a person who can see what
 * they are about to lose, not by a model.
 *
 * The calling thread's feature is found from the thread's own workspace path,
 * so the agent never has to pass an id it might have guessed.
 *
 * The port below is everything the tools need, stated as plain data, so this
 * module does not reach into the server and the tests can drive it directly.
 */

import { z } from "zod";

import type { Feature, FeatureMember } from "../features.ts";
import { quoteName } from "./instructions.ts";
import type { AgentToolRegistry } from "./toolkit.ts";

export interface FeatureRepositoryOutcome {
  readonly repository: string;
  readonly outcome: "created" | "reused" | "blocked";
  readonly path: string | null;
  readonly branch: string | null;
  readonly setup: readonly string[];
  readonly reason: string | null;
}

export interface FeatureAgentPort {
  /** The feature a path is in, from memory. */
  readonly locate: (path: string | null) => {
    readonly feature: Feature;
    readonly members: readonly FeatureMember[];
    readonly inRoot: boolean;
  } | null;
  readonly features: () => readonly Feature[];
  readonly membersOf: (featureId: string) => readonly FeatureMember[];
  /** The calling thread's workspace path, read from bb. */
  readonly threadPath: (threadId: string) => Promise<string | null>;
  readonly projects: () => Promise<readonly { readonly id: string; readonly name: string }[]>;
  readonly refresh: () => Promise<unknown>;
  readonly create: (input: {
    name: string;
    repositories: readonly string[];
  }) => Promise<{ feature: Feature; repositories: readonly FeatureRepositoryOutcome[] }>;
  readonly addRepositories: (input: {
    featureId: string;
    repositories: readonly { projectId: string; branch: string | null }[];
  }) => Promise<readonly FeatureRepositoryOutcome[]>;
  /** Renames a feature; its folder and branch keep their slug. */
  readonly rename: (featureId: string, name: string) => Promise<boolean>;
  /** Puts an archived feature back into the list. */
  readonly reopen: (featureId: string) => Promise<unknown>;
  /**
   * Files a worktree from outside any feature folder under a feature, or
   * releases it with a null feature id.
   */
  readonly adopt: (environmentId: string, featureId: string | null) => Promise<boolean>;
  /** Deletes a feature, its worktrees and its folder; the server re-surveys. */
  readonly deleteFeature: (input: {
    featureId: string;
    acknowledged: boolean;
    deleteBranches: boolean;
  }) => Promise<{ removedWorktrees: number; leftovers: readonly string[]; removedFolder: boolean }>;
  /** Takes one repository out of a feature. Refused while it holds work. */
  readonly removeRepository: (input: {
    featureId: string;
    directory: string;
    force: boolean;
  }) => Promise<{ removed: boolean }>;
}

/** Tools offered only to a thread inside a feature. */
export const FEATURE_TOOLS_INSIDE = [
  "nest_feature_context",
  "nest_feature_add_repos",
  "nest_feature_rename",
  "nest_feature_adopt",
  "nest_feature_remove_repo",
] as const;

export function registerFeatureTools(
  registry: AgentToolRegistry,
  port: FeatureAgentPort,
): void {
  const callerFeature = async (threadId: string) => {
    await port.refresh().catch(() => undefined);
    return port.locate(await port.threadPath(threadId));
  };

  const notInFeature = () => {
    const names = port
      .features()
      .filter((feature) => feature.state === "active")
      .map((feature) => `${quoteName(feature.name)} (${feature.rootPath ?? "no folder"})`);
    return (
      "This thread is not running inside a feature folder, so there is no feature to act on. " +
      (names.length === 0
        ? "No features exist yet; nest_feature_create makes one."
        : `Features: ${names.join("; ")}. Ask the user to start a thread in the one they mean.`)
    );
  };

  /**
   * Resolve what the agent wrote — a project id, a name, or a folder name —
   * to one project. A name that matches several is refused rather than guessed.
   */
  const resolveProjects = async (requested: readonly string[]) => {
    const projects = await port.projects();
    const resolved: { projectId: string; asked: string }[] = [];
    const problems: string[] = [];
    for (const asked of requested) {
      const needle = asked.trim().toLowerCase();
      const exact = projects.filter(
        (project) => project.id === asked || project.name.toLowerCase() === needle,
      );
      const matches =
        exact.length > 0
          ? exact
          : projects.filter((project) => project.name.toLowerCase().includes(needle));
      if (matches.length === 1 && matches[0] !== undefined) {
        resolved.push({ projectId: matches[0].id, asked });
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

  const describeOutcomes = (outcomes: readonly FeatureRepositoryOutcome[]) =>
    outcomes
      .map((outcome) => {
        if (outcome.outcome === "blocked") {
          return `- ${outcome.repository || "?"}: not added. ${outcome.reason ?? ""}`;
        }
        const verb = outcome.outcome === "created" ? "added" : "already there";
        const setup = outcome.setup.length > 0 ? ` ${outcome.setup.join(" ")}` : "";
        return `- ${outcome.repository}: ${verb} at ${outcome.path} on ${outcome.branch}.${setup}`;
      })
      .join("\n");

  registry.register({
    name: "nest_feature_context",
    feature: "features",
    description:
      "Read the feature this thread is working in: its folder, its topic branch, and every repository worktree inside it with its branch. Call it before touching a repository you have not looked at, or after another agent may have added one.",
    parameters: z.object({}),
    async execute(_params, context) {
      const located = await callerFeature(context.threadId);
      if (located === null) return notInFeature();
      const { feature, members, inRoot } = located;
      const lines = [
        `Feature ${quoteName(feature.name)} (slug ${feature.slug}).`,
        `Folder: ${feature.rootPath}. ${inRoot ? "This thread runs in the folder itself." : "This thread runs inside one of its repositories."}`,
        `New repositories start on branch feat/${feature.slug}.`,
        members.length === 0
          ? "No repositories yet. Use nest_feature_add_repos to bring one in."
          : `Repositories:\n${members
              .map((member) => `- ${member.directory}/ — ${member.repository} on ${member.branch ?? "a detached HEAD"}`)
              .join("\n")}`,
        "Run every git command with -C <folder>; the feature folder itself is not a repository.",
      ];
      return lines.join("\n");
    },
  });

  registry.register({
    name: "nest_feature_add_repos",
    feature: "features",
    description:
      "Bring one or more repositories into the feature this thread is working in. Each gets a git worktree in the feature folder on the feature's topic branch (or the branch you name), with untracked .env files copied and submodules initialised. Use this instead of `git worktree add`: it refuses a branch already checked out elsewhere and says where, and it keeps AGENTS.md up to date. Calling it again for a repository already present is harmless.",
    parameters: z.object({
      repositories: z
        .array(z.string().min(1))
        .min(1)
        .max(10)
        .describe("bb project names or ids, e.g. [\"tea-app-im\", \"tea-app-im-buy\"]."),
      branch: z
        .string()
        .min(1)
        .nullable()
        .optional()
        .describe("Check out this branch instead of the feature's topic branch. Omit to use the topic branch."),
    }),
    async execute({ repositories, branch }, context) {
      const located = await callerFeature(context.threadId);
      if (located === null) return notInFeature();
      const { resolved, problems } = await resolveProjects(repositories);
      const outcomes =
        resolved.length === 0
          ? []
          : await port.addRepositories({
              featureId: located.feature.id,
              repositories: resolved.map((item) => ({
                projectId: item.projectId,
                branch: branch ?? null,
              })),
            });
      const install = outcomes.some((outcome) => outcome.outcome === "created")
        ? "\nDependencies are not installed in new worktrees; AGENTS.md lists each repository's install command."
        : "";
      return [describeOutcomes(outcomes), ...problems.map((problem) => `- ${problem}`)]
        .filter((part) => part.length > 0)
        .join("\n") + install;
    },
  });

  registry.register({
    name: "nest_feature_list",
    feature: "features",
    description:
      "List the user's features: each one's name, folder and repositories. Use it to find where a piece of cross-repository work lives.",
    parameters: z.object({}),
    async execute() {
      await port.refresh().catch(() => undefined);
      const features = port.features();
      if (features.length === 0) return "No features yet.";
      return features
        .map((feature) => {
          const members = port.membersOf(feature.id).map((member) => member.directory);
          return `- ${quoteName(feature.name)} [${feature.state}] ${feature.rootPath ?? "(no folder)"} — ${members.length === 0 ? "no repositories" : members.join(", ")}`;
        })
        .join("\n");
    },
  });

  registry.register({
    name: "nest_feature_rename",
    feature: "features",
    description:
      "Rename the feature this thread is working in, or a feature named by id. Only the name people read changes; the folder and the branch keep their ASCII slug, so nothing moves. Use it when the user renames the work, not to make the name longer.",
    parameters: z.object({
      name: z.string().min(1).max(60).describe("The new name, in the user's words."),
      feature_id: z
        .string()
        .min(1)
        .optional()
        .describe("A feature id from nest_feature_list. Omit to use this thread's feature."),
    }),
    async execute({ name, feature_id }, context) {
      const located = feature_id === undefined ? await callerFeature(context.threadId) : null;
      if (feature_id === undefined && located === null) return notInFeature();
      const featureId = feature_id ?? located?.feature.id ?? "";
      const renamed = await port.rename(featureId, name.trim());
      return renamed
        ? `Renamed ${quoteName(located?.feature.name ?? featureId)} to ${quoteName(name.trim())}.`
        : `Could not rename ${featureId}; it may be gone, or the name refused.`;
    },
  });

  registry.register({
    name: "nest_feature_reopen",
    feature: "features",
    description:
      "Put a finished feature back into the active list. Finishing archived its conversations and took its worktrees back; reopening only changes the feature's state, and the repositories have to be added again if the work resumes. Use the id from nest_feature_list.",
    parameters: z.object({
      feature_id: z.string().min(1).describe("Feature id from nest_feature_list."),
    }),
    async execute({ feature_id }) {
      await port.reopen(feature_id);
      return `Reopened ${feature_id}. Add repositories again with nest_feature_add_repos if work resumes.`;
    },
  });

  registry.register({
    name: "nest_feature_adopt",
    feature: "features",
    description:
      "File a worktree that lives outside every feature folder under the feature this thread is working in, or release it with feature_id null. A worktree inside a feature folder already belongs to that feature by its path and cannot be re-filed. Use the environment id from nest_sidebar_map or bb's own workspace list.",
    parameters: z.object({
      environment_id: z.string().min(1).describe("The worktree's environment id."),
      feature_id: z
        .string()
        .min(1)
        .nullable()
        .optional()
        .describe("Feature to file it under; omit for this thread's feature; null releases it."),
    }),
    async execute({ environment_id, feature_id }, context) {
      const located = feature_id === undefined ? await callerFeature(context.threadId) : null;
      if (feature_id === undefined && located === null) return notInFeature();
      const target = feature_id === undefined ? (located?.feature.id ?? null) : feature_id;
      const adopted = await port.adopt(environment_id, target);
      if (!adopted) return `Could not file ${environment_id}; the feature may be gone.`;
      return target === null
        ? `Released ${environment_id} from its feature.`
        : `Filed ${environment_id} under ${quoteName(located?.feature.name ?? target)}.`;
    },
  });

  registry.register({
    name: "nest_feature_remove_repo",
    feature: "features",
    description:
      "Take one repository's worktree out of the feature this thread is working in. The worktree is removed and its threads archived; the branch is kept. Refused while it has uncommitted or untracked files unless force is true. Only when the user asks for the repository to be dropped from the work.",
    parameters: z.object({
      folder: z.string().min(1).describe("The repository's folder name inside the feature folder."),
      feature_id: z
        .string()
        .min(1)
        .optional()
        .describe("A feature id from nest_feature_list. Omit to use this thread's feature."),
      force: z
        .boolean()
        .default(false)
        .describe("Discard uncommitted and untracked files. Only with the user's explicit agreement."),
    }),
    async execute({ folder, feature_id, force }, context) {
      const located = feature_id === undefined ? await callerFeature(context.threadId) : null;
      if (feature_id === undefined && located === null) return notInFeature();
      const featureId = feature_id ?? located?.feature.id ?? "";
      try {
        const result = await port.removeRepository({ featureId, directory: folder, force });
        return result.removed
          ? `Removed ${folder}/ from the feature. Its branch is kept.`
          : `git did not take ${folder}/ back; it may need to be removed by hand.`;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  });

  registry.register({
    name: "nest_feature_delete",
    feature: "destructive",
    description:
      "Permanently delete a feature: archive its threads, remove its worktrees, delete its folder, and delete the topic branch when delete_branches is true. Requires acknowledged true. Finishing a feature instead keeps the folder and branches — prefer nest_feature_reopen or the sidebar's Finish when the work might resume.",
    parameters: z.object({
      feature_id: z.string().min(1).describe("Feature id from nest_feature_list."),
      delete_branches: z
        .boolean()
        .default(false)
        .describe("Also delete the branches this feature created."),
      acknowledged: z
        .boolean()
        .default(false)
        .describe("Set true only after the user confirms the deletion."),
    }),
    async execute({ feature_id, delete_branches, acknowledged }) {
      if (!acknowledged) {
        return `This would delete the feature ${feature_id}, its worktrees and its folder, permanently. Call again with acknowledged true to proceed.`;
      }
      try {
        const result = await port.deleteFeature({
          featureId: feature_id,
          acknowledged: true,
          deleteBranches: delete_branches,
        });
        return [
          `Deleted the feature: ${result.removedWorktrees} worktree${result.removedWorktrees === 1 ? "" : "s"} removed.`,
          result.leftovers.length === 0
            ? ""
            : `Left on disk: ${result.leftovers.join(", ")}.`,
          result.removedFolder ? "The folder was removed." : "The folder was kept because it still holds something Nest did not write.",
        ].filter((part) => part.length > 0).join(" ");
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  });

  registry.register({
    name: "nest_feature_create",
    feature: "features",
    description:
      "Create a feature: a folder for one piece of work across repositories, shown in the Nest sidebar. Optionally bring repositories in at the same time. Only when the user asks for a new feature.",
    parameters: z.object({
      name: z.string().min(1).max(60).describe("The feature's name, as the user wants to read it."),
      repositories: z
        .array(z.string().min(1))
        .max(10)
        .optional()
        .describe("bb project names or ids to add right away."),
    }),
    async execute({ name, repositories }) {
      const { resolved, problems } = await resolveProjects(repositories ?? []);
      const created = await port.create({
        name,
        repositories: resolved.map((item) => item.projectId),
      });
      return [
        `Created ${quoteName(created.feature.name)} at ${created.feature.rootPath}. A thread started in that folder works across its repositories.`,
        describeOutcomes(created.repositories),
        ...problems.map((problem) => `- ${problem}`),
      ]
        .filter((part) => part.length > 0)
        .join("\n");
    },
  });
}

/**
 * What a thread inside a feature is told before it starts.
 *
 * Short on purpose: `AGENTS.md` in the folder carries the rules and the user's
 * own notes, and this only has to say that the agent is in a feature, which
 * part of it, and which file to read.
 */
export function featureInstructions(located: NonNullable<ReturnType<FeatureAgentPort["locate"]>>): string {
  const { feature, members, inRoot } = located;
  const here = inRoot
    ? `This thread runs in the feature folder ${feature.rootPath} itself.`
    : `This thread runs inside one repository of the feature; its siblings are next to it under ${feature.rootPath}.`;
  const list =
    members.length === 0
      ? "It has no repositories yet; nest_feature_add_repos brings them in."
      : `Repositories: ${members.map((member) => `${member.directory}/ (${member.branch ?? "detached"})`).join(", ")}.`;
  return [
    `## Nest feature ${quoteName(feature.name)}`,
    here,
    list,
    `Read ${feature.rootPath}/AGENTS.md before acting: it has the working rules and the user's notes for this work.`,
    "Run git with -C <repository folder>; the feature folder is not a repository.",
  ].join("\n");
}
