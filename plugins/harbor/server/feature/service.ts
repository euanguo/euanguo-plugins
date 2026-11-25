/**
 * Features on the server: thin composition over refresh, provision, removal,
 * metadata, and branch-rename helpers.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import {
  featureForPath,
  isFeatureRoot,
  type Feature,
} from "../../lib/domain/features.ts";
import { FEATURE_CHANNEL } from "../../lib/realtime-channels.ts";
import type { FeatureMetaStore } from "../../lib/stores/feature-meta-store.ts";
import type { FeatureRepository } from "../../lib/stores/feature-repository.ts";
import type { FeatureStore } from "../../lib/stores/feature-store.ts";
import { renameFeatureMemberBranch } from "./branch-rename.ts";
import { createFeatureContainers, type HostCall } from "./containers.ts";
import { createFeatureContextWriter } from "./context-writer.ts";
import { createFeatureGitOps } from "./git-ops.ts";
import { createFeatureMetaService } from "./meta-service.ts";
import { createFeatureParkController } from "./park.ts";
import { createFeaturePromoter } from "./promote.ts";
import { createFeatureProvisioner } from "./provision.ts";
import { createFeatureRefresher } from "./refresh.ts";
import { createFeatureRemoval } from "./removal.ts";
import {
  FeatureError,
  PROBE_TIMEOUT_MS,
  type FeatureHost,
  type FeatureServiceCore,
  type FeatureSnapshot,
} from "./types.ts";

export type {
  FeatureHost,
  FeatureSnapshot,
  RepositoryResult,
} from "./types.ts";
export { FeatureError } from "./types.ts";

export function createFeatureService(input: {
  readonly bb: BbPluginApi;
  readonly store: FeatureStore;
  readonly metaStore: FeatureMetaStore;
  readonly repository: FeatureRepository;
  readonly host: FeatureHost;
  readonly projectSource: (
    projectId: string,
  ) => Promise<{ path: string; hostId: string } | null>;
}) {
  const { bb, store, metaStore, repository, host, projectSource } = input;
  const invalidate = (tags: readonly string[]) => {
    if (tags.length > 0) bb.rpc?.experimental_invalidate?.(tags);
  };
  const publish = () => {
    bb.realtime.publish(FEATURE_CHANNEL, {});
    invalidate(["features"]);
  };

  let cached: FeatureSnapshot = {
    features: store.list(),
    adoptions: store.adoptions(),
    members: [],
    refLinks: repository.refLinks.list(),
    homeProjects: {},
    featureProjectIds: [],
    memberScanFailures: [],
    meta: {},
  };

  const homes = new Map<string, string>();
  const contextWritten = new Set<string>();

  const call: HostCall = async (method, payload, hostId, timeoutMs) =>
    (await host.call(method, payload, { hostId, timeoutMs })) as never;

  const homeOf = async (hostId: string): Promise<string> => {
    const known = homes.get(hostId);
    if (known !== undefined) return known;
    const answer = await call<{ home: string }>("readHomeDirectory", {}, hostId, PROBE_TIMEOUT_MS);
    const home = answer.home.replace(/[\\/]+$/u, "");
    homes.set(hostId, home);
    return home;
  };

  const ensureDirectory = async (path: string, hostId: string) => {
    const answer = await call<{ status: "ok" } | { status: "failed"; message: string }>(
      "ensureFeatureDirectory",
      { path },
      hostId,
      PROBE_TIMEOUT_MS,
    );
    if (answer.status === "failed") throw new FeatureError(answer.message, "unavailable");
  };

  const { featuresFolderOf, homeProjectOf } = createFeatureContainers({
    bb, store, call, homeOf, ensureDirectory, timeoutMs: PROBE_TIMEOUT_MS,
  });

  const pickHost = async (projectIds: readonly string[]): Promise<string> => {
    for (const projectId of projectIds) {
      const source = await projectSource(projectId).catch(() => null);
      if (source !== null) return source.hostId;
    }
    const existing = store.list().find((feature) => feature.hostId !== null)?.hostId;
    if (existing !== undefined && existing !== null) return existing;
    const connected = (await bb.sdk.hosts.list()).find((candidate) => candidate.status === "connected");
    if (connected === undefined) throw new FeatureError("No machine is connected.", "unavailable");
    return connected.id;
  };

  const { writeContext } = createFeatureContextWriter({
    bb,
    metaStore,
    call,
    contextWritten,
  });

  const membersOf = (featureId: string) =>
    cached.members.filter((member) => member.featureId === featureId);

  const requireFeature = (featureId: string): Feature => {
    const feature = store.find(featureId);
    if (feature === undefined) {
      throw new FeatureError("That feature no longer exists.", "not-found");
    }
    return feature;
  };

  const core: FeatureServiceCore = {
    bb, store, metaStore, repository, projectSource, call, publish, invalidate,
    getCached: () => cached,
    setCached: (next) => { cached = next; },
    membersOf, requireFeature, writeContext, homeOf, ensureDirectory, featuresFolderOf, homeProjectOf, pickHost,
  };

  const { refresh, syncContextFiles } = createFeatureRefresher({ core, contextWritten });
  const provisioner = createFeatureProvisioner({ core, refresh });
  const removal = createFeatureRemoval({ core, refresh });
  const createdBranchCount = (featureId: string) => store.branches(featureId).length;
  const parkController = createFeatureParkController({ bb, store, getCached: () => cached, refresh, publish, invalidate });
  const promoter = createFeaturePromoter({
    bb, store, refLinks: repository.refLinks, call, ensureDirectory, featuresFolderOf,
    addRepositories: provisioner.addRepositories, refresh, writeContext, membersOf, publish, invalidate,
  });
  const gitOps = createFeatureGitOps({
    bb, store, refLinks: repository.refLinks, call, getCached: () => cached,
    requireFeature, membersOf, createdBranchCount, invalidate,
  });
  const metaService = createFeatureMetaService({
    metaStore,
    findFeature: (featureId) => store.find(featureId),
    membersOf,
    writeContext,
    publish,
    setSummary: (featureId, summary) => {
      cached = { ...cached, meta: { ...cached.meta, [featureId]: summary } };
      invalidate(["features", `feature:${featureId}`]);
    },
  });

  const prime = async (attempts: number): Promise<void> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      const snapshot = await refresh().catch(() => null);
      if (snapshot === null) continue;
      await syncContextFiles();
      if (snapshot.features.every((f) => f.state === "archived" || contextWritten.has(f.id))) {
        return;
      }
    }
  };

  return {
    snapshot: () => cached,
    refresh,
    syncContextFiles,
    prime,
    create: provisioner.create,
    plan: provisioner.plan,
    addRepositories: provisioner.addRepositories,
    addReferenceRepo: provisioner.addReferenceRepo,
    removeReferenceRepo: provisioner.removeReferenceRepo,
    survey: removal.survey,
    finish: removal.finish,
    reopen: removal.reopen,
    remove: removal.remove,
    removeRepository: removal.removeRepository,
    renameMemberBranch: (args: { featureId: string; directory: string; branch: string }) =>
      renameFeatureMemberBranch(
        { store, call, requireFeature, membersOf, refresh, writeContext, publish, timeoutMs: PROBE_TIMEOUT_MS },
        args,
      ),
    createdBranchCount,
    rename: async (featureId: string, name: string) => {
      if (!store.rename(featureId, name)) return false;
      await refresh();
      const feature = store.find(featureId);
      if (feature !== undefined) await writeContext(feature, membersOf(featureId));
      publish();
      return true;
    },
    adopt: (environmentId: string, featureId: string | null) => {
      const ok = store.adopt(environmentId, featureId);
      if (ok) {
        cached = { ...cached, adoptions: store.adoptions() };
        publish();
      }
      return ok;
    },
    ...metaService,
    park: parkController.park,
    unpark: parkController.unpark,
    handleThreadActivity: parkController.handleThreadActivity,
    scheduleNextWake: parkController.scheduleNextWake,
    dispose: parkController.dispose,
    promoteToFeature: promoter.promoteToFeature,
    ...gitOps,
    locate: (path: string | null) => {
      const feature = featureForPath(
        cached.features.filter((candidate) => candidate.state !== "archived"),
        path,
      );
      if (feature === null) return null;
      return {
        feature,
        members: membersOf(feature.id),
        inRoot: isFeatureRoot(feature, path),
      };
    },
  };
}

export type FeatureService = ReturnType<typeof createFeatureService>;
