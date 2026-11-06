/**
 * The feature half of the server's assembly, in one place.
 *
 * The entry point wires every subject — colours, icons, groups, order, shelf,
 * bulk delete — and the feature subject is the only one that needs both a store
 * and a host client. Keeping its two lines here keeps the entry point about
 * what it is for: the order things are created and the one call that registers
 * them.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";

import {
  FEATURE_HOST_MIGRATION,
  FEATURE_LABEL_MIGRATION,
  FEATURE_MEMBER_MIGRATION,
  FEATURE_MIGRATION,
  FEATURE_ROOT_MIGRATION,
  createFeatureStore,
  type FeatureStore,
} from "../lib/feature-store.ts";
import type { createGroupStore } from "../lib/group-store.ts";
import {
  createFeatureMaterializeService,
  type FeatureWorktreeHost,
} from "./feature-materialize-service.ts";
import { featureHandlers } from "./rpc/features.ts";

/**
 * Append-only, in the order they first ran.
 *
 * Exported rather than inlined so the entry point's journal stays a list of
 * names, and so a migration added here cannot be inserted in the middle of it.
 */
export const FEATURE_MIGRATIONS = [
  FEATURE_MIGRATION,
  FEATURE_LABEL_MIGRATION,
  FEATURE_MEMBER_MIGRATION,
  FEATURE_ROOT_MIGRATION,
  FEATURE_HOST_MIGRATION,
];

export function wireFeatures(input: {
  readonly db: Database.Database;
  readonly bb: BbPluginApi;
  readonly groups: ReturnType<typeof createGroupStore>;
  readonly worktreeHost: FeatureWorktreeHost;
  readonly projectSource: (
    projectId: string,
  ) => Promise<{ path: string; hostId: string } | null>;
}) {
  const { db, bb, groups, worktreeHost, projectSource } = input;
  const features: FeatureStore = createFeatureStore(db);
  const materialize = createFeatureMaterializeService({
    bb,
    features,
    host: worktreeHost,
    projectSource,
  });

  /**
   * The main checkout a member belongs to.
   *
   * A worktree records its repository in its own `.git` file, but the host
   * command needs the main path, so the probe that already answers "where does
   * this repository live" is asked here too.
   */
  const findSourceFor = async (
    path: string,
    hostId: string,
  ): Promise<string | null> => {
    try {
      const answer = await worktreeHost.call(
        "probeFeatureWorktree",
        { sourcePath: path },
        { hostId, timeoutMs: 20_000 },
      );
      if (
        typeof answer === "object" &&
        answer !== null &&
        "status" in answer &&
        answer.status === "ok" &&
        "mainRepoPath" in answer &&
        typeof answer.mainRepoPath === "string"
      ) {
        return answer.mainRepoPath;
      }
      return null;
    } catch {
      return null;
    }
  };
  /**
   * Take back one directory a feature created.
   *
   * Through git, so the repository's own worktree record goes with it. A plain
   * directory delete would leave that record behind for `git worktree list` to
   * trip over, which is the failure the plugin's existing removal path exists
   * to prevent.
   */
  const cleanupMembers = async (member: {
    path: string;
    hostId: string;
  }): Promise<boolean> => {
    const source = await findSourceFor(member.path, member.hostId);
    if (source === null) return false;
    try {
      const answer = await worktreeHost.call(
        "removeWorktree",
        { path: member.path, mainRepoPath: source },
        { hostId: member.hostId, timeoutMs: 60_000 },
      );
      return (
        typeof answer === "object" &&
        answer !== null &&
        "status" in answer &&
        answer.status === "removed"
      );
    } catch {
      return false;
    }
  };

  /**
   * Take back the directory a feature owns, once its members are gone.
   *
   * Only the directory the plugin created, and only when it holds nothing but
   * the two files the plugin wrote. Anything else stays, because a file a
   * person put there is theirs.
   */
  const cleanupFeatureRoot = async (
    featureId: string,
  ): Promise<boolean> => {
    const feature = features
      .list()
      .find((candidate) => candidate.id === featureId);
    if (feature === undefined || feature.rootPath === null) return false;
    if (feature.hostId === null) return false;
    try {
      const answer = await worktreeHost.call(
        "removeFeatureDirectory",
        { featureDirectory: feature.rootPath },
        { hostId: feature.hostId, timeoutMs: 20_000 },
      );
      return (
        typeof answer === "object" &&
        answer !== null &&
        "status" in answer &&
        answer.status === "removed"
      );
    } catch {
      return false;
    }
  };


  return {
    features,
    handlers: featureHandlers({
      bb,
      features,
      groups,
      materialize,
      cleanupMembers,
      cleanupFeatureRoot,
    }),
    materialize,
  };
}
