/**
 * Feature creation, root resolution, and adding worktree members.
 */
import { featureRootParent } from "../../lib/domain/feature-root.ts";
import {
  newFeatureId,
  suggestFeatureSlug,
  validFeatureSlug,
  type Feature,
} from "../../lib/domain/features.ts";
import { messageOf } from "./removal-ops.ts";
import { planFeatureRepository, type RepositoryPlan } from "./repositories.ts";
import {
  CREATE_TIMEOUT_MS,
  FeatureError,
  PROBE_TIMEOUT_MS,
  type FeatureServiceCore,
  type FeatureSnapshot,
  type RepositoryResult,
} from "./types.ts";

export function createFeatureProvisioner(input: {
  readonly core: FeatureServiceCore;
  readonly refresh: () => Promise<FeatureSnapshot>;
}) {
  const { core, refresh } = input;
  const {
    store,
    projectSource,
    call,
    publish,
    membersOf,
    requireFeature,
    writeContext,
    ensureDirectory,
    featuresFolderOf,
    pickHost,
  } = core;

  /** Give a feature without a recorded directory one on a connected host. */
  const ensureRoot = async (feature: Feature): Promise<Feature> => {
    if (feature.rootPath !== null && feature.hostId !== null) return feature;
    const hostId = feature.hostId ?? (await pickHost([]));
    const rootPath = `${await featuresFolderOf(hostId)}/${feature.slug}`;
    await ensureDirectory(rootPath, hostId);
    store.setRoot(feature.id, rootPath, hostId);
    store.recordContainer(featureRootParent(rootPath));
    const next = store.find(feature.id) ?? feature;
    await writeContext(next, []);
    return next;
  };

  /** Read what adding one repository would do, without touching anything. */
  const plan = (args: {
    featureId: string;
    projectId: string;
    branch?: string | null;
  }): Promise<RepositoryPlan & { mainRepoPath: string | null; hostId: string }> =>
    planFeatureRepository({
      args,
      requireFeature,
      ensureRoot,
      projectSource,
      call,
      timeoutMs: PROBE_TIMEOUT_MS,
    });

  /**
   * Add several repositories in one go.
   *
   * Each is planned and created on its own, so one refusal does not stop the
   * others, and the answer reports every repository separately. The context
   * files are rewritten once at the end, from a fresh scan.
   */
  const addRepositories = async (args: {
    featureId: string;
    repositories: readonly { projectId: string; branch?: string | null }[];
  }): Promise<readonly RepositoryResult[]> => {
    const results: RepositoryResult[] = [];
    for (const repository of args.repositories) {
      const planned = await plan({ featureId: args.featureId, ...repository }).catch(
        (error: unknown) => ({
          projectId: repository.projectId,
          repository: "",
          branch: "",
          path: "",
          outcome: "blocked" as const,
          newBranch: false,
          base: null,
          reason: messageOf(error),
          mainRepoPath: null,
          hostId: "",
        }),
      );
      if (planned.outcome !== "create" || planned.mainRepoPath === null) {
        results.push({
          projectId: planned.projectId,
          repository: planned.repository,
          outcome: planned.outcome === "reuse" ? "reused" : "blocked",
          path: planned.outcome === "reuse" ? planned.path : null,
          branch: planned.outcome === "reuse" ? planned.branch : null,
          setup: [],
          reason:
            planned.outcome === "create"
              ? "Could not find the repository's main checkout."
              : planned.reason,
        });
        continue;
      }
      const created = await call<
        | {
            status: "created";
            path: string;
            branch: string;
            base: string | null;
            setup: readonly string[];
          }
        | { status: "failed"; message: string }
      >(
        "createFeatureWorktree",
        {
          mainRepoPath: planned.mainRepoPath,
          path: planned.path,
          branch: planned.branch,
          newBranch: planned.newBranch,
          baseRef: null,
        },
        planned.hostId,
        CREATE_TIMEOUT_MS,
      ).catch((error: unknown) => ({ status: "failed" as const, message: messageOf(error) }));
      if (created.status === "created" && planned.newBranch) {
        store.recordBranch({
          featureId: args.featureId,
          repositoryPath: planned.mainRepoPath,
          hostId: planned.hostId,
          branch: created.branch,
        });
      }
      results.push(
        created.status === "created"
          ? {
              projectId: planned.projectId,
              repository: planned.repository,
              outcome: "created",
              path: created.path,
              branch: created.branch,
              setup: created.setup,
              reason: null,
            }
          : {
              projectId: planned.projectId,
              repository: planned.repository,
              outcome: "blocked",
              path: null,
              branch: null,
              setup: [],
              reason: created.message,
            },
      );
    }
    await refresh();
    const feature = store.find(args.featureId);
    if (feature !== undefined) await writeContext(feature, membersOf(feature.id));
    publish();
    return results;
  };

  const create = async (args: {
    name: string;
    slug?: string | null;
    repositories?: readonly { projectId: string; branch: string | null }[];
  }): Promise<{ feature: Feature; repositories: readonly RepositoryResult[] }> => {
    const existing = store.list();
    const takenSlugs = new Set(existing.map((feature) => feature.slug));
    const requested = args.slug?.trim() ?? "";
    if (requested.length > 0 && !validFeatureSlug(requested)) {
      throw new FeatureError(
        "A slug is lowercase letters, digits and single dashes, up to 40 characters.",
        "invalid",
      );
    }
    if (requested.length > 0 && takenSlugs.has(requested)) {
      throw new FeatureError(`Another feature already uses the slug ${requested}.`, "conflict");
    }
    const slug = requested.length > 0 ? requested : suggestFeatureSlug(args.name, takenSlugs);
    const hostId = await pickHost((args.repositories ?? []).map((repo) => repo.projectId));
    const container = await featuresFolderOf(hostId);
    const rootPath = `${container}/${slug}`;
    await ensureDirectory(rootPath, hostId);
    store.recordContainer(container);
    const takenIds = new Set(existing.map((feature) => feature.id));
    let id = newFeatureId();
    while (takenIds.has(id)) id = newFeatureId();
    const feature = store.create({
      id,
      name: args.name,
      slug,
      rootPath,
      hostId,
    });
    if (feature === null) throw new FeatureError("That feature could not be saved.", "unavailable");
    await writeContext(feature, []);
    const repositories =
      args.repositories === undefined || args.repositories.length === 0
        ? []
        : await addRepositories({ featureId: feature.id, repositories: args.repositories });
    if (repositories.length === 0) {
      await refresh();
      publish();
    }
    return { feature: store.find(feature.id) ?? feature, repositories };
  };

  return { ensureRoot, plan, addRepositories, create };
}
