/**
 * Feature creation, root resolution, and adding worktree members.
 */
import {
  featureRootParent,
} from "../../lib/domain/feature-root.ts";
import {
  newFeatureId,
  suggestFeatureSlug,
  validFeatureSlug,
  type Feature,
} from "../../lib/domain/features.ts";
import { messageOf } from "./removal-ops.ts";
import { planFeatureRepository } from "./repositories.ts";
import {
  CREATE_TIMEOUT_MS,
  FeatureError,
  PROBE_TIMEOUT_MS,
  type FeatureServiceCore,
  type FeatureSnapshot,
  type RepositoryResult,
} from "./types.ts";

const PROVISION_CONCURRENCY = 4;

async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const run = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const idx = nextIndex;
      nextIndex += 1;
      const item = items[idx];
      if (item === undefined) continue;
      results[idx] = await worker(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  );
  return results;
}

export function createFeatureProvisioner(input: {
  readonly core: FeatureServiceCore;
  readonly refresh: () => Promise<FeatureSnapshot>;
}) {
  const { core, refresh } = input;
  const {
    store,
    repository: repoStore,
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

  const isRefLinked = (featureId: string, directory: string): boolean =>
    repoStore.refLinks
      .list(featureId)
      .some((link) => link.directory === directory);

  /** Read what adding one repository would do, without touching anything. */
  const plan = (args: {
    featureId: string;
    projectId: string;
    branch?: string | null;
    role?: "worktree" | "ref";
    baseBranch?: string | null;
  }) =>
    planFeatureRepository({
      args,
      requireFeature,
      ensureRoot,
      projectSource,
      call,
      timeoutMs: PROBE_TIMEOUT_MS,
      isRefLinked,
    });

  /**
   * Add several repositories in 4-way concurrency.
   *
   * Each is planned and materialized on its own, so one refusal does not stop
   * the others, and the answer reports every repository separately.
   */
  const addRepositories = async (args: {
    featureId: string;
    baseBranch?: string | null;
    repositories: readonly {
      projectId: string;
      branch?: string | null;
      role?: "worktree" | "ref";
      baseBranch?: string | null;
    }[];
  }): Promise<readonly RepositoryResult[]> => {
    const feature = await ensureRoot(requireFeature(args.featureId));
    const results = await mapConcurrent(
      args.repositories,
      PROVISION_CONCURRENCY,
      async (repoInput): Promise<RepositoryResult> => {
        const requestedRole: "worktree" | "ref" =
          repoInput.role === "ref" ? "ref" : "worktree";
        const effectiveBaseBranch =
          repoInput.baseBranch ?? args.baseBranch ?? null;
        const planned = await plan({
          featureId: args.featureId,
          projectId: repoInput.projectId,
          branch: repoInput.branch ?? null,
          role: requestedRole,
          baseBranch: effectiveBaseBranch,
        }).catch((error: unknown) => ({
          projectId: repoInput.projectId,
          repository: "",
          branch: "",
          path: "",
          outcome: "blocked" as const,
          newBranch: false,
          base: null,
          reason: messageOf(error),
          role: requestedRole,
          mainRepoPath: null,
          hostId: "",
          directory: "",
          baseBranch: effectiveBaseBranch,
        }));

        if (planned.outcome !== "create" || planned.mainRepoPath === null) {
          return {
            projectId: planned.projectId,
            repository: planned.repository,
            outcome: planned.outcome === "reuse" ? "reused" : "blocked",
            path: planned.outcome === "reuse" ? planned.path : null,
            branch: planned.outcome === "reuse" ? planned.branch : null,
            role: planned.role,
            setup: [],
            reason:
              planned.outcome === "create"
                ? "Could not find the repository's main checkout."
                : planned.reason,
          };
        }

        if (planned.role === "ref") {
          const linkAnswer = await call<
            { status: "ok"; path: string } | { status: "failed"; message: string }
          >(
            "linkFeatureReference",
            {
              featureDirectory: feature.rootPath,
              directory: planned.directory,
              sourcePath: planned.mainRepoPath,
            },
            planned.hostId,
            PROBE_TIMEOUT_MS,
          ).catch((error: unknown) => ({
            status: "failed" as const,
            message: messageOf(error),
          }));
          if (linkAnswer.status === "failed") {
            return {
              projectId: planned.projectId,
              repository: planned.repository,
              outcome: "blocked",
              path: null,
              branch: null,
              role: "ref",
              setup: [],
              reason: linkAnswer.message,
            };
          }
          repoStore.refLinks.add({
            featureId: args.featureId,
            directory: planned.directory,
            repository: planned.repository,
            sourcePath: planned.mainRepoPath,
            hostId: planned.hostId,
          });
          return {
            projectId: planned.projectId,
            repository: planned.repository,
            outcome: "created",
            path: linkAnswer.path,
            branch: null,
            role: "ref",
            setup: ["Linked as read-only reference."],
            reason: null,
          };
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
            baseRef: effectiveBaseBranch,
          },
          planned.hostId,
          CREATE_TIMEOUT_MS,
        ).catch((error: unknown) => ({
          status: "failed" as const,
          message: messageOf(error),
        }));
        if (created.status === "created" && planned.newBranch) {
          store.recordBranch({
            featureId: args.featureId,
            repositoryPath: planned.mainRepoPath,
            hostId: planned.hostId,
            branch: created.branch,
          });
        }
        return created.status === "created"
          ? {
              projectId: planned.projectId,
              repository: planned.repository,
              outcome: "created",
              path: created.path,
              branch: created.branch,
              role: "worktree",
              setup: created.setup,
              reason: null,
            }
          : {
              projectId: planned.projectId,
              repository: planned.repository,
              outcome: "blocked",
              path: null,
              branch: null,
              role: "worktree",
              setup: [],
              reason: created.message,
            };
      },
    );

    await refresh();
    const updatedFeature = store.find(args.featureId);
    if (updatedFeature !== undefined) {
      await writeContext(updatedFeature, membersOf(updatedFeature.id));
    }
    publish();
    return results;
  };

  const addReferenceRepo = async (args: {
    featureId: string;
    projectId: string;
  }) => {
    const [result] = await addRepositories({
      featureId: args.featureId,
      repositories: [{ projectId: args.projectId, branch: null, role: "ref" }],
    });
    if (result === undefined || result.outcome === "blocked") {
      throw new FeatureError(
        result?.reason ?? "Could not attach reference repository.",
        "invalid",
      );
    }
    return result;
  };

  const removeReferenceRepo = async (args: {
    featureId: string;
    directory: string;
  }) => {
    const feature = requireFeature(args.featureId);
    if (feature.rootPath === null || feature.hostId === null) {
      throw new FeatureError("Feature has no folder on disk.", "invalid");
    }
    const answer = await call<{
      status: "removed" | "missing" | "failed";
      message?: string;
    }>(
      "unlinkFeatureReference",
      { featureDirectory: feature.rootPath, directory: args.directory },
      feature.hostId,
      PROBE_TIMEOUT_MS,
    );
    if (answer.status === "failed") {
      throw new FeatureError(
        answer.message ?? "Could not unlink reference repository.",
        "invalid",
      );
    }
    const removed = repoStore.refLinks.remove(args.featureId, args.directory);
    await refresh();
    await writeContext(feature, membersOf(feature.id));
    publish();
    return { removed: removed || answer.status === "removed" };
  };

  const create = async (args: {
    name: string;
    slug?: string | null;
    baseBranch?: string | null;
    repositories?: readonly {
      projectId: string;
      branch: string | null;
      role?: "worktree" | "ref";
    }[];
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
        : await addRepositories({
            featureId: feature.id,
            baseBranch: args.baseBranch ?? null,
            repositories: args.repositories,
          });
    if (repositories.length === 0) {
      await refresh();
      publish();
    }
    return { feature: store.find(feature.id) ?? feature, repositories };
  };

  return {
    ensureRoot,
    plan,
    addRepositories,
    addReferenceRepo,
    removeReferenceRepo,
    create,
  };
}
