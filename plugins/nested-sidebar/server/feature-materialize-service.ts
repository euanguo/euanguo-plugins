/**
 * Turning a label into a real worktree.
 *
 * Two operations, and keeping them apart is the point.
 *
 * `plan` is a read. It asks the machine what the repository already holds and
 * answers what would happen, so the dialog can show the refusal before anyone
 * clicks. `materialize` is the write, and it runs the same decision from the
 * same facts, so a plan the user approved is not refused by a second rule.
 *
 * The feature directory is not a repository and is never made one. A worktree
 * created inside a repository makes that repository's index record the child as
 * an embedded repository, and a later `git add -A` commits a pointer with no
 * contents.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { worktreeDirectoryContract } from "../host/contract.ts";
import type { FeatureStore } from "../lib/feature-store.ts";
import {
  branchForFeature,
  childDirectoryFor,
  planMaterialize,
  type MaterializeDecision,
} from "../lib/feature-materialize.ts";
import type { Feature } from "../lib/features.ts";

/** The single call shape the host entry exposes. */
export interface FeatureWorktreeHost {
  call<Method extends keyof typeof worktreeDirectoryContract>(
    method: Method,
    input: unknown,
    options: { hostId: string; timeoutMs: number },
  ): Promise<unknown>;
}

export interface MaterializePlan {
  readonly featureId: string;
  readonly projectId: string;
  readonly repositoryName: string;
  readonly branch: string;
  readonly decision: MaterializeDecision;
  readonly path: string;
  readonly hostId: string;
}

export type MaterializeResult =
  | {
      readonly status: "created" | "reused";
      readonly path: string;
      readonly branch: string;
      readonly hostId: string;
      readonly contextWritten: boolean;
    }
  | { readonly status: "blocked"; readonly reason: string };

const PROBE_TIMEOUT_MS = 20_000;
const CREATE_TIMEOUT_MS = 90_000;

export function createFeatureMaterializeService(input: {
  readonly bb: BbPluginApi;
  readonly features: FeatureStore;
  readonly host: FeatureWorktreeHost;
  readonly projectSource: (
    projectId: string,
  ) => Promise<{ path: string; hostId: string } | null>;
}) {
  const { features, host, projectSource } = input;

  /**
   * The home directory of the machine that holds the worktrees.
   *
   * A feature directory under a relative path would resolve against whatever
   * directory the host daemon happens to sit in, which differs between a cold
   * start and a reload. The host is asked so the answer belongs to the machine
   * that will hold the files.
   */
  const readHome = async (hostId: string): Promise<string | null> => {
    try {
      const answer = await host.call(
        "readHomeDirectory",
        {},
        { hostId, timeoutMs: PROBE_TIMEOUT_MS },
      );
      if (
        typeof answer === "object" &&
        answer !== null &&
        "home" in answer &&
        typeof answer.home === "string" &&
        answer.home.length > 0
      ) {
        return answer.home;
      }
      return null;
    } catch {
      return null;
    }
  };

  /**
   * Read what would happen, without touching anything.
   *
   * The answer includes the refusal reason when there is one, because that is
   * the whole value of asking: a person should see why a branch cannot be used
   * before they try.
   */
  const plan = async (args: {
    featureId: string;
    projectId: string;
  }): Promise<MaterializePlan | { error: string }> => {
    const { featureId, projectId } = args;
    const feature = features.list().find((item) => item.id === featureId);
    if (feature === undefined) return { error: "功能不存在。" };
    const source = await projectSource(projectId);
    if (source === null) return { error: "这个项目没有可用的源目录。" };
    const probe = await host.call(
      "probeFeatureWorktree",
      { sourcePath: source.path },
      { hostId: source.hostId, timeoutMs: PROBE_TIMEOUT_MS },
    );
    if (!isProbe(probe) || probe.status !== "ok") {
      return {
        error: isProbe(probe) && probe.status === "failed"
          ? probe.message
          : "无法读取仓库状态。",
      };
    }
    if (probe.mainRepoPath === null) {
      return { error: "无法确定仓库的根目录。" };
    }
    const home = await readHome(source.hostId);
    if (home === null) return { error: "无法读取目标机器的 home 目录。" };
    const repositoryName = repositoryNameOf(source.path);
    const featureDirectory = featureDirectoryOf(feature, home);
    const branch = branchForFeature(feature.id);
    const targetExists = probe.worktrees.some((worktree) =>
      worktree.path.replace(/\/+$/u, "") ===
      `${featureDirectory}/${repositoryName}`.replace(/\/+$/u, ""),
    );
    const decision = planMaterialize({
      featureDirectory,
      repositoryName,
      branch,
      probe: {
        repository: probe.repository,
        mainWorktree: probe.mainWorktree,
        worktrees: probe.worktrees,
      },
      targetExists,
    });
    return {
      featureId,
      projectId,
      repositoryName,
      branch,
      decision,
      path: decision.status === "blocked" ? "" : decision.path,
      hostId: source.hostId,
    };
  };

  const materialize = async (args: {
    featureId: string;
    projectId: string;
  }): Promise<MaterializeResult> => {
    const planned = await plan(args);
    if ("error" in planned) {
      return { status: "blocked", reason: planned.error };
    }
    if (planned.decision.status === "blocked") {
      return { status: "blocked", reason: planned.decision.reason };
    }
    const source = await projectSource(args.projectId);
    if (source === null) return { status: "blocked", reason: "源目录不可用。" };
    const probe = await host.call(
      "probeFeatureWorktree",
      { sourcePath: source.path },
      { hostId: source.hostId, timeoutMs: PROBE_TIMEOUT_MS },
    );
    if (!isProbe(probe) || probe.status !== "ok" || probe.mainRepoPath === null) {
      return { status: "blocked", reason: "无法读取仓库状态。" };
    }
    const home = await readHome(source.hostId);
    if (home === null) {
      return { status: "blocked", reason: "无法读取目标机器的 home 目录。" };
    }

    if (planned.decision.status === "create") {
      const created = await host.call(
        "createFeatureWorktree",
        {
          mainRepoPath: probe.mainRepoPath,
          path: planned.decision.path,
          branch: planned.decision.branch,
          baseRef: null,
        },
        { hostId: source.hostId, timeoutMs: CREATE_TIMEOUT_MS },
      );
      if (!isCreate(created) || created.status !== "created") {
        return {
          status: "blocked",
          reason:
            isCreate(created) && created.status === "failed"
              ? created.message
              : "创建失败。",
        };
      }
    }

    /**
     * The label is written last. A worktree that exists without a label is a
     * row the project view still shows; a label without a worktree is a feature
     * row pointing at nothing, which is worse.
     */
    const recorded = features.recordMember({
      featureId: args.featureId,
      directory: childDirectoryFor(planned.repositoryName),
      repository: planned.repositoryName,
      branch: planned.decision.branch,
      path: planned.decision.path,
      hostId: source.hostId,
      environmentId: null,
    });
    if (!recorded) {
      return { status: "blocked", reason: "worktree 已创建，但没有登记到功能。" };
    }

    const current = features
      .list()
      .find((item) => item.id === args.featureId);
    if (current === undefined) {
      return { status: "blocked", reason: "功能在创建过程中被删除。" };
    }
    const rootPath = featureDirectoryOf(current, home);
    features.setRoot(args.featureId, rootPath, source.hostId);

    const context = await writeContext(args.featureId, rootPath, source.hostId);
    return {
      status: planned.decision.status === "reuse" ? "reused" : "created",
      path: planned.decision.path,
      branch: planned.decision.branch,
      hostId: source.hostId,
      contextWritten: context,
    };
  };

  const writeContext = async (
    featureId: string,
    rootPath: string,
    hostId: string,
  ): Promise<boolean> => {
    const feature = features.list().find((item) => item.id === featureId);
    if (feature === undefined) return false;
    const members = features.members(featureId);
    if (members.length === 0) return false;
    const written = await host.call(
      "writeFeatureContext",
      {
        featureDirectory: rootPath,
        featureId,
        featureName: feature.name,
        members: members.map((member) => ({
          repository: member.repository,
          directory: member.directory,
          branch: member.branch,
        })),
      },
      { hostId, timeoutMs: PROBE_TIMEOUT_MS },
    );
    return isWritten(written) && written.status === "ok";
  };


  return { plan, materialize };
}

/**
 * Where a feature's directory lives.
 *
 * Under the user's home rather than beside any one repository: a feature spans
 * repositories, so picking one of them as the parent would make the others look
 * like guests in it.
 */
/**
 * Where a feature's directory lives on the machine that holds it.
 *
 * A relative path would resolve against whatever directory the host daemon
 * happens to be in, which differs between a fresh start and a reload — so the
 * root is always absolute. It sits beside the user's code rather than inside a
 * repository: a feature spans several, and picking one as the parent would make
 * the rest look like guests in it.
 */
export function featureDirectoryOf(
  feature: Feature,
  homeDirectory: string,
): string {
  if (feature.rootPath !== null) return feature.rootPath;
  const home = homeDirectory.replace(/[\\/]+$/u, "");
  return `${home}/NestFeatures/${feature.id}`;
}

function repositoryNameOf(sourcePath: string): string {
  const parts = sourcePath.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) ?? "repo";
}

function isProbe(
  value: unknown,
): value is
  | {
      status: "ok";
      repository: boolean;
      mainWorktree: boolean;
      mainRepoPath: string | null;
      worktrees: readonly { path: string; branch: string | null }[];
    }
  | { status: "failed"; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value.status === "ok" || value.status === "failed")
  );
}

function isCreate(
  value: unknown,
): value is
  | { status: "created"; path: string; branch: string }
  | { status: "failed"; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value.status === "created" || value.status === "failed")
  );
}

function isWritten(
  value: unknown,
): value is { status: "ok" } | { status: "failed"; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value.status === "ok" || value.status === "failed")
  );
}
