/**
 * Promote an existing single-repository worktree or checkout into a multi-repo
 * Feature without losing its conversation history.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { validBranchName } from "../../lib/domain/feature-materialize.ts";
import { featureRootParent } from "../../lib/domain/feature-root.ts";
import {
  featureBranch,
  featureForPath,
  featureNameIntent,
  newFeatureId,
  normalizeFeaturePath,
  suggestFeatureSlug,
  validFeatureSlug,
  type Feature,
  type FeatureMember,
} from "../../lib/domain/features.ts";
import type { FeatureRefLinkStore } from "../../lib/stores/feature-ref-link-store.ts";
import type { FeatureStore } from "../../lib/stores/feature-store.ts";
import type { HostCall } from "./containers.ts";
import {
  FeatureError,
  PROBE_TIMEOUT_MS,
  type FeatureSnapshot,
  type RepositoryResult,
} from "./types.ts";

function basenameOf(path: string): string {
  const cleaned = normalizeFeaturePath(path);
  const slash = cleaned.lastIndexOf("/");
  return slash === -1 ? cleaned : cleaned.slice(slash + 1);
}

export function createFeaturePromoter(input: {
  readonly bb: BbPluginApi;
  readonly store: FeatureStore;
  readonly refLinks: FeatureRefLinkStore;
  readonly call: HostCall;
  readonly ensureDirectory: (path: string, hostId: string) => Promise<void>;
  readonly featuresFolderOf: (hostId: string) => Promise<string>;
  readonly addRepositories: (args: {
    featureId: string;
    baseBranch?: string | null;
    repositories: readonly {
      projectId: string;
      branch?: string | null;
      role?: "worktree" | "ref";
      baseBranch?: string | null;
    }[];
  }) => Promise<readonly RepositoryResult[]>;
  readonly refresh: () => Promise<FeatureSnapshot>;
  readonly writeContext: (
    feature: Feature,
    members: readonly FeatureMember[],
  ) => Promise<boolean>;
  readonly membersOf: (featureId: string) => readonly FeatureMember[];
  readonly publish: () => void;
  readonly invalidate: (tags: readonly string[]) => void;
}) {
  const {
    bb,
    store,
    call,
    ensureDirectory,
    featuresFolderOf,
    addRepositories,
    refresh,
    writeContext,
    membersOf,
    publish,
    invalidate,
  } = input;

  const promoteToFeature = async (args: {
    readonly environmentId: string;
    readonly name: string;
    readonly slug?: string | null;
    readonly baseBranch?: string | null;
    readonly additionalRepositories?: readonly {
      readonly projectId: string;
      readonly branch?: string | null;
      readonly role?: "worktree" | "ref";
      readonly baseBranch?: string | null;
    }[];
  }): Promise<{
    readonly feature: Feature;
    readonly adoptedEnvironmentId: string;
    readonly repositories: readonly RepositoryResult[];
  }> => {
    const cleanName = featureNameIntent(args.name);
    if (cleanName === null) {
      throw new FeatureError(
        "A feature needs a name of up to 60 characters.",
        "invalid",
      );
    }

    const environment = await bb.sdk.environments
      .get({ environmentId: args.environmentId })
      .catch(() => null);
    if (
      environment === null ||
      typeof environment.path !== "string" ||
      environment.path.trim().length === 0
    ) {
      throw new FeatureError(
        "Cannot promote a workspace without an active local directory.",
        "not-found",
      );
    }

    const existing = store.list();
    const enclosing = featureForPath(
      existing.filter((candidate) => candidate.state !== "archived"),
      environment.path,
    );
    if (enclosing !== null) {
      throw new FeatureError(
        `This workspace already lives inside feature "${enclosing.name}".`,
        "conflict",
      );
    }

    const takenSlugs = new Set(existing.map((candidate) => candidate.slug));
    const requestedSlug = args.slug?.trim() ?? "";
    if (requestedSlug.length > 0 && !validFeatureSlug(requestedSlug)) {
      throw new FeatureError(
        "A slug is lowercase letters, digits and single dashes, up to 40 characters.",
        "invalid",
      );
    }
    if (requestedSlug.length > 0 && takenSlugs.has(requestedSlug)) {
      throw new FeatureError(
        `Another feature already uses the slug ${requestedSlug}.`,
        "conflict",
      );
    }

    const slug =
      requestedSlug.length > 0
        ? requestedSlug
        : suggestFeatureSlug(cleanName, takenSlugs);
    const hostId = environment.hostId;
    const container = await featuresFolderOf(hostId);
    const rootPath = `${container}/${slug}`;
    await ensureDirectory(rootPath, hostId);
    store.recordContainer(featureRootParent(rootPath));

    const takenIds = new Set(existing.map((candidate) => candidate.id));
    let id = newFeatureId();
    while (takenIds.has(id)) id = newFeatureId();

    const feature = store.create({
      id,
      name: cleanName,
      slug,
      rootPath,
      hostId,
    });
    if (feature === null) {
      throw new FeatureError("Could not create the promoted feature.", "unavailable");
    }

    // Preserve all existing conversations in the promoted environment.
    store.adopt(environment.id, feature.id);

    // Expose a directory entry inside the feature root pointing to the promoted
    // worktree so multi-repo agents can access it cleanly from `rootPath`.
    const linkDir = basenameOf(environment.path);
    await call<{ status: "ok" } | { status: "failed"; message: string }>(
      "linkFeatureReference",
      {
        featureDirectory: rootPath,
        directory: linkDir,
        sourcePath: environment.path,
      },
      hostId,
      PROBE_TIMEOUT_MS,
    ).catch(() => ({ status: "failed", message: "symlink skipped" }));

    const defaultBranch =
      typeof environment.branchName === "string" &&
      validBranchName(environment.branchName)
        ? environment.branchName
        : featureBranch(slug);

    const additional = args.additionalRepositories ?? [];
    const repositories =
      additional.length === 0
        ? []
        : await addRepositories({
            featureId: feature.id,
            baseBranch: args.baseBranch ?? null,
            repositories: additional.map((repo) => ({
              projectId: repo.projectId,
              role: repo.role ?? "worktree",
              baseBranch: repo.baseBranch ?? args.baseBranch ?? null,
              branch:
                repo.branch ?? (repo.role === "ref" ? null : defaultBranch),
            })),
          });

    await refresh();
    await writeContext(store.find(feature.id) ?? feature, membersOf(feature.id));
    publish();
    invalidate(["features", `feature:${feature.id}`]);

    return {
      feature: store.find(feature.id) ?? feature,
      adoptedEnvironmentId: environment.id,
      repositories,
    };
  };

  return { promoteToFeature };
}
