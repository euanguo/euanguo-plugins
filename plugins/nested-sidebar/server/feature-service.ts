/**
 * Features on the server: creating one, reading what it contains, adding and
 * removing its repositories, and finishing or deleting it.
 *
 * Three rules shape the whole file.
 *
 * **A feature is a directory from the moment it is named.** The folder, its
 * `AGENTS.md` and its `CLAUDE.md` are written by `create`, so an empty feature
 * is already a place to start a conversation — planning the work is the first
 * thing a person does in it, before any repository is checked out.
 *
 * **What a feature contains is read, never recorded.** Members are scanned from
 * the folder on the machine that holds it; threads are attributed by their
 * workspace path. `snapshot` keeps the last answer in memory, because the agent
 * configuration hook is synchronous and has to know where a thread is without a
 * round trip.
 *
 * **Root conversations live in one bb project.** A bb thread belongs to exactly
 * one project, and a feature spans several, so every feature on a machine
 * shares a project called Features whose source is the folder all feature
 * directories sit in. Each feature directory is then one workspace of it, which
 * is what the project view draws, and the conversation's cwd is the feature
 * directory itself.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { worktreeDirectoryContract } from "../host/contract.ts";
import {
  childDirectoryFor,
  planMaterialize,
  validBranchName,
} from "../lib/feature-materialize.ts";
import type { FeatureStore } from "../lib/feature-store.ts";
import {
  featureBranch,
  featureForPath,
  isFeatureRoot,
  newFeatureId,
  normalizeFeaturePath,
  planFeatureRemoval,
  suggestFeatureSlug,
  validFeatureSlug,
  type Feature,
  type FeatureAssignment,
  type FeatureMember,
  type FeatureRemovalSurvey,
} from "../lib/features.ts";
import { FEATURE_CHANNEL } from "../lib/realtime-channels.ts";
import { createFeatureContainers, type HostCall } from "./feature-containers.ts";
import { featureContainerProjectIds, featureRootParent } from "../lib/feature-root.ts";
import { renameFeatureMemberBranch } from "./feature-branch-rename.ts";
export type { HostCall } from "./feature-containers.ts";

/** The folder under a machine's home that holds every feature directory. */
export { FEATURES_FOLDER } from "../lib/feature-root.ts";
/** The bb project every feature's root conversation belongs to. */
export { FEATURES_PROJECT_NAME } from "./feature-containers.ts";

const PROBE_TIMEOUT_MS = 30_000;
const CREATE_TIMEOUT_MS = 180_000;
const SCAN_TIMEOUT_MS = 15_000;

/** The single call shape the host entry exposes. */
export interface FeatureHost {
  call<Method extends keyof typeof worktreeDirectoryContract>(
    method: Method,
    input: unknown,
    options: { hostId: string; timeoutMs: number },
  ): Promise<unknown>;
}

export interface FeatureSnapshot {
  readonly features: readonly Feature[];
  readonly adoptions: FeatureAssignment;
  readonly members: readonly FeatureMember[];
  /**
   * A feature container path -> the Features project at that path.
   *
   * Keyed by path, not by host: a feature created before the root moved still
   * lives under the old one, and its conversations must stay in the project
   * whose source is that folder.
   */
  readonly homeProjects: Readonly<Record<string, string>>;
  /**
   * Every bb project that is a feature container, old roots included.
   *
   * The project view hides all of them: their rows are feature folders, which
   * the feature view already draws by the feature's name.
   */
  readonly featureProjectIds: readonly string[];
}

export interface RepositoryPlan {
  readonly projectId: string;
  readonly repository: string;
  readonly branch: string;
  readonly path: string;
  readonly outcome: "create" | "reuse" | "blocked";
  /** Set when `outcome` is `create`: whether the branch is new. */
  readonly newBranch: boolean;
  /** Where a new branch starts, before the fetch. */
  readonly base: string | null;
  readonly reason: string | null;
}

export interface RepositoryResult {
  readonly projectId: string;
  readonly repository: string;
  readonly outcome: "created" | "reused" | "blocked";
  readonly path: string | null;
  readonly branch: string | null;
  readonly setup: readonly string[];
  readonly reason: string | null;
}

export class FeatureError extends Error {}

export function createFeatureService(input: {
  readonly bb: BbPluginApi;
  readonly store: FeatureStore;
  readonly host: FeatureHost;
  readonly projectSource: (projectId: string) => Promise<{ path: string; hostId: string } | null>;
}) {
  const { bb, store, host, projectSource } = input;
  const publish = () => bb.realtime.publish(FEATURE_CHANNEL, {});

  let cached: FeatureSnapshot = {
    features: store.list(),
    adoptions: store.adoptions(),
    members: [],
    homeProjects: {},
    featureProjectIds: [],
  };
  const homes = new Map<string, string>();
  /**
   * Features whose context files have been rewritten since this load.
   *
   * Once per load, so a folder an older build wrote — `NEST.md`, no
   * `AGENTS.md` — is brought up to date the first time it is read, and a
   * folder whose members an agent changed by hand gets its block refreshed on
   * the next start rather than never.
   */
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
    if (answer.status === "failed") throw new FeatureError(answer.message);
  };

  const { featuresFolderOf, homeProjectOf } = createFeatureContainers({
    bb,
    store,
    call,
    homeOf,
    ensureDirectory,
    timeoutMs: PROBE_TIMEOUT_MS,
  });

  /** The machine a new feature lives on: its first repository's, or any connected one. */
  const pickHost = async (projectIds: readonly string[]): Promise<string> => {
    for (const projectId of projectIds) {
      const source = await projectSource(projectId).catch(() => null);
      if (source !== null) return source.hostId;
    }
    const existing = store.list().find((feature) => feature.hostId !== null)?.hostId;
    if (existing !== undefined && existing !== null) return existing;
    const hosts = await bb.sdk.hosts.list();
    const connected = hosts.find((candidate) => candidate.status === "connected");
    if (connected === undefined) throw new FeatureError("No machine is connected.");
    return connected.id;
  };

  /**
   * Rewrite a feature's `AGENTS.md` block, `CLAUDE.md` and manifest.
   *
   * Never fatal: a context file that could not be written leaves the feature
   * usable, so the failure is logged rather than turned into a refusal of the
   * operation that triggered it.
   */
  const writeContext = async (
    feature: Feature,
    members: readonly FeatureMember[],
  ): Promise<boolean> => {
    if (feature.rootPath === null || feature.hostId === null) return false;
    const answer = await call<{ status: "ok" } | { status: "failed"; message: string }>(
      "writeFeatureContext",
      {
        featureDirectory: feature.rootPath,
        id: feature.id,
        name: feature.name,
        slug: feature.slug,
        suggestedBranch: featureBranch(feature.slug),
        members: members.map((member) => ({
          directory: member.directory,
          repository: member.repository,
          branch: member.branch,
          path: member.path,
        })),
      },
      feature.hostId,
      PROBE_TIMEOUT_MS,
    ).catch((error: unknown) => ({ status: "failed" as const, message: messageOf(error) }));
    if (answer.status === "failed") {
      bb.log.warn(`could not write the context files of ${feature.slug}: ${answer.message}`);
      return false;
    }
    return true;
  };

  /**
   * Give a feature an older build created without a folder its folder.
   *
   * Older builds only made the directory on first materialize, so a feature
   * named and never filled has none. It gets one now, on the machine of any
   * connected host, so it becomes a place to talk like every other.
   */
  const ensureRoot = async (feature: Feature): Promise<Feature> => {
    if (feature.rootPath !== null && feature.hostId !== null) return feature;
    const hostId = feature.hostId ?? (await pickHost([]));
    const rootPath = `${await featuresFolderOf(hostId)}/${feature.slug}`;
    await ensureDirectory(rootPath, hostId);
    store.setRoot(feature.id, rootPath, hostId);
    const next = store.find(feature.id) ?? feature;
    await writeContext(next, []);
    return next;
  };

  /** Re-read everything: features, the folders on disk, the Features projects. */
  const refresh = async (): Promise<FeatureSnapshot> => {
    store.backfillSlugs();
    let features = store.list();
    for (const feature of features) {
      if (feature.rootPath === null || feature.hostId === null) {
        await ensureRoot(feature).catch(() => undefined);
      }
    }
    features = store.list();
    const byHost = new Map<string, Feature[]>();
    for (const feature of features) {
      if (feature.rootPath === null || feature.hostId === null) continue;
      const bucket = byHost.get(feature.hostId) ?? [];
      bucket.push(feature);
      byHost.set(feature.hostId, bucket);
    }
    const homeProjects: Record<string, string> = { ...cached.homeProjects };
    const membersByHost = new Map<string, FeatureMember[]>();
    const scanHost = async (hostId: string, onHost: readonly Feature[]): Promise<void> => {
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
        // A machine that did not answer keeps what it said last time, rather
        // than making every repository of its features disappear.
        membersByHost.set(
          hostId,
          cached.members.filter((member) =>
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
            normalizeFeaturePath(candidate.rootPath) === normalizeFeaturePath(result.root),
        );
        if (feature === undefined) continue;
        for (const member of result.members) {
          found.push({ ...member, featureId: feature.id, hostId });
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
    /**
     * Every container this plugin has ever used, not only the ones with
     * features in them. The last feature under a root can be deleted while its
     * empty project stays; it must remain hidden rather than reappear as a
     * project in the sidebar.
     */
    const containerPaths = new Set(store.containers());
    for (const root of store.featuresRoots()) containerPaths.add(root.rootPath);
    for (const feature of features) {
      if (feature.rootPath !== null) containerPaths.add(featureRootParent(feature.rootPath));
    }
    for (const path of containerPaths) store.recordContainer(path);
    const featureProjectIds = featureContainerProjectIds({
      projects: await bb.sdk.projects.list({}).catch(() => []),
      containerPaths,
    });
    cached = {
      features,
      adoptions: store.adoptions(),
      members,
      homeProjects,
      featureProjectIds,
    };
    for (const feature of features) {
      if (contextWritten.has(feature.id) || feature.state !== "active") continue;
      if (await writeContext(feature, membersOf(feature.id))) contextWritten.add(feature.id);
    }
    return cached;
  };

  const membersOf = (featureId: string) =>
    cached.members.filter((member) => member.featureId === featureId);

  const requireFeature = (featureId: string): Feature => {
    const feature = store.find(featureId);
    if (feature === undefined) throw new FeatureError("That feature no longer exists.");
    return feature;
  };

  /** Read what adding one repository would do, without touching anything. */
  const plan = async (args: {
    featureId: string;
    projectId: string;
    branch?: string | null;
  }): Promise<RepositoryPlan & { mainRepoPath: string | null; hostId: string }> => {
    const feature = await ensureRoot(requireFeature(args.featureId));
    const source = await projectSource(args.projectId);
    const branch = args.branch?.trim() || featureBranch(feature.slug);
    const blocked = (reason: string, repository = "", path = "") => ({
      projectId: args.projectId,
      repository,
      branch,
      path,
      outcome: "blocked" as const,
      newBranch: false,
      base: null,
      reason,
      mainRepoPath: null,
      hostId: feature.hostId ?? "",
    });
    if (source === null) return blocked("This project has no folder on a machine.");
    const repository = repositoryNameOf(source.path);
    if (!validBranchName(branch)) return blocked(`${branch} is not a valid branch name.`, repository);
    if (feature.hostId !== source.hostId) {
      return blocked(
        "This repository lives on a different machine from the feature's folder.",
        repository,
      );
    }
    const target = `${feature.rootPath}/${childDirectoryFor(repository)}`;
    const probe = await call<
      | {
          status: "ok";
          repository: boolean;
          mainWorktree: boolean;
          mainRepoPath: string | null;
          worktrees: readonly { path: string; branch: string | null }[];
          branchExists: boolean;
          targetExists: boolean;
          defaultBase: string;
        }
      | { status: "failed"; message: string }
    >(
      "probeFeatureWorktree",
      { sourcePath: source.path, branch, targetPath: target },
      source.hostId,
      PROBE_TIMEOUT_MS,
    );
    if (probe.status === "failed") return blocked(probe.message, repository, target);
    const decision = planMaterialize({
      featureDirectory: feature.rootPath ?? "",
      repositoryName: repository,
      branch,
      probe,
    });
    return {
      projectId: args.projectId,
      repository,
      branch,
      path: decision.path,
      outcome: decision.status,
      newBranch: decision.status === "create" ? decision.newBranch : false,
      base: decision.status === "create" && decision.newBranch ? probe.defaultBase : null,
      reason: decision.status === "blocked" ? decision.reason : null,
      mainRepoPath: probe.mainRepoPath,
      hostId: source.hostId,
    };
  };

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
        | { status: "created"; path: string; branch: string; base: string | null; setup: readonly string[] }
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
      );
    }
    if (requested.length > 0 && takenSlugs.has(requested)) {
      throw new FeatureError(`Another feature already uses the slug ${requested}.`);
    }
    const slug = requested.length > 0 ? requested : suggestFeatureSlug(args.name, takenSlugs);
    const hostId = await pickHost((args.repositories ?? []).map((repo) => repo.projectId));
    const rootPath = `${await featuresFolderOf(hostId)}/${slug}`;
    await ensureDirectory(rootPath, hostId);
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
    if (feature === null) throw new FeatureError("That feature could not be saved.");
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

  /** Every bb environment inside a feature's folder: its root and its members. */
  const environmentsOf = async (feature: Feature) => {
    if (feature.rootPath === null || feature.hostId === null) return [];
    const environments = await bb.sdk.environments.list({
      hostId: feature.hostId,
      limit: 1_000,
    });
    return environments.filter(
      (environment) =>
        featureForPath([feature], environment.path) !== null ||
        cached.adoptions[environment.id] === feature.id,
    );
  };

  const survey = async (
    featureId: string,
    options: { readonly deletesBranches: boolean },
  ) => {
    const feature = requireFeature(featureId);
    const members = membersOf(featureId);
    const [worktrees, environments] = await Promise.all([
      members.length === 0 || feature.hostId === null
        ? Promise.resolve([] as FeatureRemovalSurvey["worktrees"])
        : call<{ worktrees: FeatureRemovalSurvey["worktrees"] }>(
            "inspectFeatureWorktrees",
            { paths: members.map((member) => member.path) },
            feature.hostId,
            PROBE_TIMEOUT_MS,
          ).then((answer) => answer.worktrees),
      environmentsOf(feature),
    ]);
    const threadLists = await Promise.all(
      environments.map((environment) =>
        bb.sdk.threads.list({ environmentId: environment.id, archived: false }),
      ),
    );
    const threadCount = threadLists.reduce((total, list) => total + list.length, 0);
    const result = planFeatureRemoval({ worktrees, threadCount }, options);
    return {
      feature,
      members,
      environments,
      worktrees,
      threadCount,
      warnings: result.warnings,
      requiresConfirmation: result.requiresConfirmation,
    };
  };

  /** Take a feature's worktrees back through git, so the repository's own records go too. */
  const removeMembers = async (members: readonly FeatureMember[]) => {
    let removed = 0;
    const leftovers: string[] = [];
    for (const member of members) {
      const answer = await call<{ status: string }>(
        "removeWorktree",
        { path: member.path, mainRepoPath: member.repositoryPath },
        member.hostId,
        60_000,
      ).catch(() => ({ status: "failed" }));
      if (answer.status === "removed") removed += 1;
      else leftovers.push(member.path);
    }
    return { removed, leftovers };
  };

  const archiveThreads = async (environmentIds: readonly string[]) => {
    let archived = 0;
    for (const environmentId of environmentIds) {
      const answer = await bb.sdk.environments
        .archiveThreads({ environmentId })
        .catch(() => null);
      archived += answer?.archivedThreadIds.length ?? 0;
    }
    return archived;
  };

  /**
   * Finish: the work is done, so its worktrees go and its record stays.
   *
   * Branches are kept — they hold the commits, and a merged branch is the
   * remote's to clean up. The folder and its `AGENTS.md` are kept as the record
   * of what the work was; reopening the feature finds them where they were.
   */
  const finish = async (featureId: string, acknowledged: boolean) => {
    const surveyed = await survey(featureId, { deletesBranches: false });
    if (surveyed.requiresConfirmation && !acknowledged) {
      throw new FeatureError(`This feature still holds work: ${surveyed.warnings.join("; ")}.`);
    }
    const archived = await archiveThreads(surveyed.environments.map((environment) => environment.id));
    const { removed, leftovers } = await removeMembers(surveyed.members);
    store.setState(featureId, "archived");
    await refresh();
    const feature = store.find(featureId);
    if (feature !== undefined) await writeContext(feature, membersOf(featureId));
    publish();
    return { archivedThreads: archived, removedWorktrees: removed, leftovers };
  };

  const reopen = async (featureId: string) => {
    requireFeature(featureId);
    store.setState(featureId, "active");
    await refresh();
    publish();
  };

  /** Delete: everything finish does, then the folder, and the branches Nest created if asked. */
  const remove = async (args: {
    featureId: string;
    acknowledged: boolean;
    deleteBranches: boolean;
  }) => {
    const surveyed = await survey(args.featureId, { deletesBranches: args.deleteBranches });
    if (surveyed.requiresConfirmation && !args.acknowledged) {
      throw new FeatureError(`This feature still holds work: ${surveyed.warnings.join("; ")}.`);
    }
    const { feature } = surveyed;
    const archived = await archiveThreads(surveyed.environments.map((environment) => environment.id));
    const { removed, leftovers } = await removeMembers(surveyed.members);
    let deletedBranches = 0;
    if (args.deleteBranches) {
      /**
       * Only branches this feature created, from the record kept when they were
       * made. Members may be on any name — their own convention, or a branch
       * that existed before — so a name alone no longer says who made it. A
       * branch the user had before and checked out here is theirs and stays.
       */
      for (const target of store.branches(feature.id)) {
        const answer = await call<{ status: string }>(
          "deleteFeatureBranch",
          { mainRepoPath: target.repositoryPath, branch: target.branch },
          target.hostId,
          PROBE_TIMEOUT_MS,
        ).catch(() => ({ status: "kept" }));
        if (answer.status === "deleted") deletedBranches += 1;
      }
    }
    let removedFolder = false;
    if (feature.rootPath !== null && feature.hostId !== null && leftovers.length === 0) {
      const answer = await call<{ status: string }>(
        "removeFeatureDirectory",
        { featureDirectory: feature.rootPath },
        feature.hostId,
        PROBE_TIMEOUT_MS,
      ).catch(() => ({ status: "kept" }));
      removedFolder = answer.status === "removed";
    }
    store.remove(args.featureId);
    await refresh();
    publish();
    return {
      archivedThreads: archived,
      removedWorktrees: removed,
      leftovers,
      deletedBranches,
      removedFolder,
    };
  };

  /** Take one repository out of a feature. Refused while it holds work, unless forced. */
  const removeRepository = async (args: {
    featureId: string;
    directory: string;
    force: boolean;
  }) => {
    const feature = requireFeature(args.featureId);
    const member = membersOf(args.featureId).find(
      (candidate) => candidate.directory === args.directory,
    );
    if (member === undefined) throw new FeatureError(`No repository folder ${args.directory} in this feature.`);
    const [state] = await call<{ worktrees: FeatureRemovalSurvey["worktrees"] }>(
      "inspectFeatureWorktrees",
      { paths: [member.path] },
      member.hostId,
      PROBE_TIMEOUT_MS,
    ).then((answer) => answer.worktrees);
    const loses =
      state !== undefined &&
      (state.changedFiles > 0 || state.untrackedFiles > 0);
    if (loses && !args.force) {
      throw new FeatureError(
        `${args.directory} has ${state.changedFiles} changed and ${state.untrackedFiles} untracked files. Commit them first, or remove with force.`,
      );
    }
    const environments = (await environmentsOf(feature)).filter(
      (environment) =>
        environment.path !== null &&
        normalizeFeaturePath(environment.path).startsWith(normalizeFeaturePath(member.path)),
    );
    await archiveThreads(environments.map((environment) => environment.id));
    const { removed } = await removeMembers([member]);
    await refresh();
    await writeContext(feature, membersOf(feature.id));
    publish();
    return { removed: removed === 1 };
  };

  /**
   * Prime the snapshot, and keep trying until the machines answer.
   *
   * The first attempt can land while host calls are still refused, so it is
   * retried with a growing pause, the same shape the sidebar index primes with.
   * Done when every active feature's folder has been read and its context
   * written.
   */
  const prime = async (attempts: number): Promise<void> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      const snapshot = await refresh().catch(() => null);
      if (
        snapshot !== null &&
        snapshot.features.every(
          (feature) => feature.state !== "active" || contextWritten.has(feature.id),
        )
      ) {
        return;
      }
    }
  };

  return {
    snapshot: () => cached,
    refresh,
    prime,
    create,
    plan,
    addRepositories,
    survey,
    finish,
    reopen,
    remove,
    removeRepository,
    renameMemberBranch: (args: { featureId: string; directory: string; branch: string }) =>
      renameFeatureMemberBranch(
        {
          store,
          call,
          requireFeature,
          membersOf,
          refresh,
          writeContext,
          publish,
          timeoutMs: PROBE_TIMEOUT_MS,
        },
        args,
      ),
    createdBranchCount: (featureId: string) => store.branches(featureId).length,
    rename: async (featureId: string, name: string) => {
      const ok = store.rename(featureId, name);
      if (!ok) return false;
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
    /** Which feature a path is in, from memory: safe on the thread-start path. */
    locate: (path: string | null) => {
      const feature = featureForPath(
        cached.features.filter((candidate) => candidate.state === "active"),
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

function repositoryNameOf(sourcePath: string): string {
  const parts = sourcePath.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) ?? "repo";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
