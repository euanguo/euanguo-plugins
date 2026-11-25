/**
 * Reading the disk and bb into memory for the feature tree.
 *
 * Concurrent callers share a single in-flight host scan so priming at startup
 * and the frontend's initial `listFeatures` read never probe every machine twice.
 * Context file rewrites (`AGENTS.md` / `.harbor-feature.json`) live outside `refresh`
 * in `syncContextFiles` so reads stay free of directory/file writes.
 */
import {
  featureContainerProjectIds,
  featureRootParent,
} from "../../lib/domain/feature-root.ts";
import {
  normalizeFeaturePath,
  type Feature,
  type FeatureMember,
} from "../../lib/domain/features.ts";
import {
  SCAN_TIMEOUT_MS,
  type FeatureServiceCore,
  type FeatureSnapshot,
} from "./types.ts";

export function createFeatureRefresher(input: {
  readonly core: FeatureServiceCore;
  readonly contextWritten: Set<string>;
}) {
  const { core, contextWritten } = input;
  const {
    bb,
    store,
    metaStore,
    repository,
    call,
    getCached,
    setCached,
    membersOf,
    writeContext,
    featuresFolderOf,
    homeProjectOf,
  } = core;

  let inFlightRefresh: Promise<FeatureSnapshot> | null = null;
  let queuedRefresh: Promise<FeatureSnapshot> | null = null;

  const runRefresh = async (): Promise<FeatureSnapshot> => {
    const features = store.list();
    const adoptions = store.adoptions();
    const adoptedEntries = Object.entries(adoptions);
    const adoptedTargets = new Set<string>();
    if (adoptedEntries.length > 0) {
      const environments = await bb.sdk.environments
        .list({ limit: 1_000 })
        .catch(() => []);
      const adoptionByEnv = new Map(adoptedEntries);
      for (const environment of environments) {
        const featureId = adoptionByEnv.get(environment.id);
        if (featureId !== undefined && typeof environment.path === "string") {
          adoptedTargets.add(`${featureId}:${normalizeFeaturePath(environment.path)}`);
        }
      }
    }
    const trackedRefLinks = repository.refLinks.list();
    const refKeys = new Set(
      trackedRefLinks.map((link) => `${link.featureId}:${link.directory}`),
    );
    const byHost = new Map<string, Feature[]>();
    for (const feature of features) {
      if (feature.rootPath === null || feature.hostId === null) continue;
      const bucket = byHost.get(feature.hostId) ?? [];
      bucket.push(feature);
      byHost.set(feature.hostId, bucket);
    }

    const previous = getCached();
    const homeProjects: Record<string, string> = { ...previous.homeProjects };
    const membersByHost = new Map<string, FeatureMember[]>();
    const failedHosts = new Set<string>();

    const scanHost = async (
      hostId: string,
      onHost: readonly Feature[],
    ): Promise<void> => {
      const scanned = await call<{
        results: readonly {
          root: string;
          members: readonly Omit<FeatureMember, "featureId" | "hostId">[];
        }[];
      }>(
        "scanFeatureDirectories",
        { roots: onHost.map((feature) => feature.rootPath) },
        hostId,
        SCAN_TIMEOUT_MS,
      ).catch(() => null);
      if (scanned === null) {
        failedHosts.add(hostId);
        // Retain prior members when a host fails to answer; destructive operations
        // separately reject while `memberScanFailures` contains this host.
        membersByHost.set(
          hostId,
          previous.members.filter((member) =>
            onHost.some((feature) => feature.id === member.featureId),
          ),
        );
        return;
      }
      const found: FeatureMember[] = [];
      for (const result of scanned.results) {
        const feature = onHost.find(
          (candidate) =>
            candidate.rootPath !== null &&
            normalizeFeaturePath(candidate.rootPath) ===
              normalizeFeaturePath(result.root),
        );
        if (feature === undefined) continue;
        for (const member of result.members) {
          const isAdopted = adoptedTargets.has(
            `${feature.id}:${normalizeFeaturePath(member.repositoryPath)}`,
          );
          const role = isAdopted
            ? "worktree"
            : (member.role ??
              (refKeys.has(`${feature.id}:${member.directory}`) ? "ref" : "worktree"));
          found.push({
            ...member,
            role,
            featureId: feature.id,
            hostId,
          });
        }
      }
      membersByHost.set(hostId, found);
    };

    await Promise.all(
      [...byHost.entries()].map(async ([hostId, onHost]) => {
        await scanHost(hostId, onHost);
        const roots = new Set<string>();
        const defaultRoot = await featuresFolderOf(hostId).catch(() => null);
        if (defaultRoot !== null) roots.add(normalizeFeaturePath(defaultRoot));
        for (const feature of onHost) {
          if (feature.rootPath !== null) {
            roots.add(normalizeFeaturePath(featureRootParent(feature.rootPath)));
          }
        }
        for (const root of roots) {
          if (homeProjects[root] !== undefined) continue;
          const projectId = await homeProjectOf(hostId, root);
          if (projectId !== null) homeProjects[root] = projectId;
        }
      }),
    );

    const members = [...membersByHost.values()].flat();
    const containerPaths = new Set(store.containers());
    for (const root of store.featuresRoots()) containerPaths.add(root.rootPath);
    for (const feature of features) {
      if (feature.rootPath !== null) {
        containerPaths.add(featureRootParent(feature.rootPath));
      }
    }
    const featureProjectIds = featureContainerProjectIds({
      projects: await bb.sdk.projects.list({}).catch(() => []),
      containerPaths,
    });
    const next: FeatureSnapshot = {
      features,
      adoptions,
      members,
      refLinks: trackedRefLinks,
      homeProjects,
      featureProjectIds,
      memberScanFailures: [...failedHosts],
      meta: metaStore.summaries(features.map((feature) => feature.id)),
    };
    setCached(next);
    return next;
  };

  const startRefresh = (): Promise<FeatureSnapshot> => {
    const active = runRefresh().finally(() => {
      if (inFlightRefresh === active) inFlightRefresh = null;
    });
    inFlightRefresh = active;
    return active;
  };

  const refresh = (options?: { readonly afterWrite?: boolean }): Promise<FeatureSnapshot> => {
    if (inFlightRefresh === null) return startRefresh();
    if (options?.afterWrite !== true) return inFlightRefresh;
    if (queuedRefresh === null) {
      queuedRefresh = inFlightRefresh
        .catch(() => undefined)
        .then(() => {
          queuedRefresh = null;
          return inFlightRefresh ?? startRefresh();
        });
    }
    return queuedRefresh;
  };

  const syncContextFiles = async (): Promise<void> => {
    const features = getCached().features;
    for (const feature of features) {
      if (contextWritten.has(feature.id) || feature.state === "archived") continue;
      if (await writeContext(feature, membersOf(feature.id))) {
        contextWritten.add(feature.id);
      }
    }
  };

  return { refresh, syncContextFiles };
}
