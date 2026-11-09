/**
 * The folders features live in, and the bb project at each of them.
 *
 * Kept beside the feature service rather than inside it: choosing a root is a
 * decision about a machine, not about one feature, and it is the part that has
 * to survive a restart so the next feature lands next to the last one.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { worktreeDirectoryContract } from "../host/contract.ts";
import {
  LEGACY_FEATURES_FOLDER,
  featuresFolderIn,
  isWithinPath,
  normalizePath,
  reservedWorkspaceReason,
} from "../lib/feature-root.ts";
import type { FeatureStore } from "../lib/feature-store.ts";

/** The bb project every feature's root conversation belongs to. */
export const FEATURES_PROJECT_NAME = "Features";

/** How a root was chosen; see `feature_roots.scheme`. */
export const FEATURE_ROOT_SCHEME = "bb-data-v1";

/** The one host call shape these helpers use. */
export type HostCall = <T>(
  method: keyof typeof worktreeDirectoryContract,
  payload: unknown,
  hostId: string,
  timeoutMs: number,
) => Promise<T>;

export function createFeatureContainers(input: {
  readonly bb: BbPluginApi;
  readonly store: FeatureStore;
  readonly call: HostCall;
  readonly homeOf: (hostId: string) => Promise<string>;
  readonly timeoutMs: number;
  readonly ensureDirectory: (path: string, hostId: string) => Promise<void>;
}) {
  const { bb, store, call, homeOf, ensureDirectory, timeoutMs } = input;

  /**
   * The folder feature directories live in on this machine.
   *
   * Under bb's data directory, beside the places bb reserves for itself rather
   * than inside one of them: a feature folder is somewhere a person starts a
   * conversation, and bb refuses to start one inside a managed workspace root.
   *
   * The result is written down, so a later change to the plugin cannot silently
   * move the next feature away from the existing ones. A root chosen by an
   * earlier build is kept for as long as a feature lives under it — those
   * features cannot be moved, since bb cannot change an environment's path.
   * Once nothing is there, the root is upgraded to the current scheme.
   */
  const featuresFolderOf = async (hostId: string): Promise<string> => {
    const { dataDir, failure } = await readDataDirectory(hostId);
    const stored = store.featuresRoot(hostId);
    if (stored !== null) {
      const root = normalizePath(stored.rootPath);
      const inUse = store
        .list()
        .some(
          (feature) =>
            feature.rootPath !== null && isWithinPath(root, feature.rootPath),
        );
      // An earlier root is kept while anything lives under it. Its scheme is
      // rewritten to the current one only when the folder is still a location
      // this build would choose; otherwise the old scheme records the fact so
      // the next empty root is upgraded.
      const current =
        stored.scheme === FEATURE_ROOT_SCHEME &&
        failure === null &&
        reservedWorkspaceReason({ dataDir, path: root }) === null;
      if (inUse || current) {
        if (inUse && !current) {
          store.setFeaturesRoot(hostId, stored.rootPath, stored.scheme ?? FEATURE_ROOT_SCHEME);
        }
        store.recordContainer(stored.rootPath);
        return stored.rootPath;
      }
    }
    const rootPath = await chooseFeaturesFolder(hostId, dataDir, failure);
    store.setFeaturesRoot(hostId, rootPath, FEATURE_ROOT_SCHEME);
    store.recordContainer(rootPath);
    return rootPath;
  };

  /** bb's data directory on a machine, or why it could not be read. */
  const readDataDirectory = async (
    hostId: string,
  ): Promise<{ dataDir: string; failure: string | null }> => {
    try {
      const answer = await call<{ dataDir: string }>(
        "readDataDirectory",
        {},
        hostId,
        timeoutMs,
      );
      return { dataDir: normalizePath(answer.dataDir), failure: null };
    } catch (error) {
      return { dataDir: "", failure: error instanceof Error ? error.message : String(error) };
    }
  };

  /**
   * The folder to create features in when no usable root is recorded.
   *
   * The data-directory answer is preferred. A reserved answer — a machine still
   * reporting a root from an older build, or a data directory this build cannot
   * use — is refused rather than written down, and the home folder takes over
   * as it did before data directories existed.
   */
  const chooseFeaturesFolder = async (
    hostId: string,
    dataDir: string,
    failure: string | null,
  ): Promise<string> => {
    if (failure === null && dataDir.length > 0) {
      const candidate = featuresFolderIn(dataDir);
      if (reservedWorkspaceReason({ dataDir, path: candidate }) === null) {
        return candidate;
      }
      bb.log.warn(
        `feature folders cannot live at ${candidate}: bb treats it as its own storage. Using the home folder instead.`,
      );
    }
    return `${normalizePath(await homeOf(hostId))}/${LEGACY_FEATURES_FOLDER}`;
  };

  /**
   * The Features project at a container path, created the first time it is
   * needed.
   *
   * Found by its source path rather than by a stored id, so a project the user
   * renamed is still found, and one they deleted is simply made again.
   */
  const homeProjectOf = async (hostId: string, folder: string): Promise<string | null> => {
    try {
      const projects = await bb.sdk.projects.list({});
      const existing = projects.find((project) =>
        project.sources.some(
          (source) =>
            source.hostId === hostId &&
            typeof source.path === "string" &&
            normalizePath(source.path) === normalizePath(folder),
        ),
      );
      if (existing !== undefined) return existing.id;
      await ensureDirectory(folder, hostId);
      const created = await bb.sdk.projects.create({
        name: FEATURES_PROJECT_NAME,
        source: { type: "local_path", hostId, path: folder },
      });
      return created.id;
    } catch {
      return null;
    }
  };

  return { featuresFolderOf, homeProjectOf };
}
