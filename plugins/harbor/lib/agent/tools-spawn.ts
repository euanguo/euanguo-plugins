/**
 * Starting a conversation when the user asks to spin up work in a feature
 * folder, member worktree, or named environment.
 */

import { z } from "zod";
import { featureRootParent } from "../domain/feature-root.ts";
import type { Feature, FeatureMember } from "../domain/features.ts";
import type { SpawnEnvironment, SpawnThreadInput } from "./actions.ts";
import { quoteName } from "./instructions.ts";
import type { AgentToolRegistry } from "./toolkit.ts";

export interface ThreadSpawnPort {
  readonly locate: (path: string | null) => {
    readonly feature: Feature;
    readonly members: readonly FeatureMember[];
    readonly inRoot: boolean;
  } | null;
  readonly threadPath: (threadId: string) => Promise<string | null>;
  readonly environment: (
    environmentId: string,
  ) => Promise<{ path: string | null; projectId: string; hostId: string } | null>;
  /** The Features project on a machine, which owns feature folders. */
  readonly homeProject: (containerPath: string) => Promise<string | null>;
  readonly resolveProject: (nameOrId: string) => Promise<{ id: string; name: string } | null>;
  readonly spawn: (input: SpawnThreadInput) => Promise<string | null>;
}

export function registerSpawnTool(
  registry: AgentToolRegistry,
  port: ThreadSpawnPort,
): void {
  registry.register({
    name: "harbor_thread_spawn",
    description:
      "Start a new thread with a first prompt. Inside a feature, omit environment_id to start in the feature folder, or pass folder to start in a writable repository worktree; elsewhere pass environment_id. Optional title, project, and as_child (defaults true to parent under this thread).",
    parameters: z.object({
      prompt: z.string().min(1).describe("The first message of the new thread."),
      title: z.string().min(1).max(200).optional().describe("A short title for the sidebar."),
      folder: z
        .string()
        .min(1)
        .optional()
        .describe("A writable repository folder inside this thread's feature, e.g. acme-web."),
      environment_id: z
        .string()
        .min(1)
        .optional()
        .describe("An existing environment id to start in, instead of a feature folder."),
      project: z
        .string()
        .min(1)
        .optional()
        .describe("A bb project name or id for the thread; defaults to the folder's owner."),
      as_child: z
        .boolean()
        .default(true)
        .describe("True parents the new thread to this one; false starts a peer thread."),
    }),
    async execute(
      { prompt, title, folder, environment_id, project, as_child },
      context,
    ) {
      const environment =
        environment_id === undefined
          ? await featureEnvironment(port, context.threadId, folder)
          : await environmentOf(port, environment_id);
      if ("error" in environment) return environment.error;

      let projectId = environment.projectId;
      if (project !== undefined) {
        const resolved = await port.resolveProject(project);
        if (resolved === null) {
          return `No project matches ${quoteName(project)}. Pass an exact name or id.`;
        }
        projectId = resolved.id;
      }
      if (projectId.length === 0) {
        return "Could not tell which project the new thread belongs to. Pass `project`.";
      }

      const threadId = await port.spawn({
        projectId,
        prompt,
        ...(title === undefined ? {} : { title }),
        ...(as_child ? { parentThreadId: context.threadId } : {}),
        environment: environment.environment,
      });
      if (threadId === null) {
        return "bb did not return a thread id; the thread was not started.";
      }
      return [
        `Started ${threadId}${title === undefined ? "" : ` (${quoteName(title)})`} in ${environment.where}.`,
        as_child ? "It is a child of this thread." : "It is a top-level thread.",
      ].join(" ");
    },
  });
}

type Location =
  | { readonly environment: SpawnEnvironment; readonly projectId: string; readonly where: string }
  | { readonly error: string };

async function environmentOf(
  port: ThreadSpawnPort,
  environmentId: string,
): Promise<Location> {
  const environment = await port.environment(environmentId);
  if (environment === null) return { error: `No environment ${environmentId}.` };
  return {
    environment: { type: "reuse", environmentId },
    projectId: environment.projectId,
    where: environment.path ?? environmentId,
  };
}

async function featureEnvironment(
  port: ThreadSpawnPort,
  threadId: string,
  folder: string | undefined,
): Promise<Location> {
  const located = port.locate(await port.threadPath(threadId));
  if (located === null || located.feature.hostId === null) {
    return {
      error:
        "This thread is not running inside a feature folder. Pass environment_id to choose where the new thread starts.",
    };
  }
  const { feature, members } = located;
  const hostId = feature.hostId;
  if (hostId === null) return { error: "The feature has no machine yet." };
  const containerPath =
    feature.rootPath === null ? null : featureRootParent(feature.rootPath);
  let path = feature.rootPath ?? "";
  if (folder !== undefined) {
    const member = members.find((candidate) => candidate.directory === folder);
    if (member === undefined) {
      return {
        error:
          members.length === 0
            ? `${quoteName(feature.name)} has no repositories yet. Add one with harbor_feature_repos, or omit folder to start in the feature folder.`
            : `No folder ${quoteName(folder)} in ${quoteName(feature.name)}. Repositories: ${members.map((item) => item.directory).join(", ")}.`,
      };
    }
    if (member.role === "ref") {
      return {
        error: `${quoteName(folder)} is a read-only reference repository in ${quoteName(feature.name)}. Start threads in the feature folder or a writable worktree instead.`,
      };
    }
    path = member.path;
  }
  if (path.length === 0 || containerPath === null) {
    return { error: `${quoteName(feature.name)} has no folder yet.` };
  }
  const projectId = await port.homeProject(containerPath);
  if (projectId === null) {
    return {
      error:
        "The Features project for this machine is not available yet. Try again in a moment.",
    };
  }
  return {
    environment: {
      type: "host",
      hostId,
      workspace: { type: "unmanaged", path },
    },
    projectId,
    where: path,
  };
}
