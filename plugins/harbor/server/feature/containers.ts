/**
 * The folders features live in, and the bb project at each of them.
 *
 * Kept beside the feature service rather than inside it: choosing a root is a
 * decision about a machine, not about one feature, and it is the part that has
 * to survive a restart so the next feature lands next to the last one.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { worktreeDirectoryContract } from "../../host/contract.ts";
import {
  HOME_FEATURES_FOLDER,
  daemonDataRoot,
  featuresFolderIn,
  isWithinPath,
  normalizePath,
  reservedWorkspaceReason,
} from "../../lib/domain/feature-root.ts";
import type { FeatureStore } from "../../lib/stores/feature-store.ts";

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

  const featuresFolderOf = async (hostId: string): Promise<string> => {
    const { dataDir, failure } = await readDataDirectory(hostId);
    const stored = store.featuresRoot(hostId);
    if (stored !== null) {
      const root = normalizePath(stored.rootPath);
      const dataRoot = daemonDataRoot(dataDir);
      const inUse = store
        .list()
        .some(
          (feature) =>
            feature.rootPath !== null && isWithinPath(root, feature.rootPath),
        );
      const current =
        stored.scheme === FEATURE_ROOT_SCHEME &&
        failure === null &&
        dataRoot !== null &&
        !isWithinPath(dataDir, root) &&
        reservedWorkspaceReason({ dataDir: dataRoot, path: root }) === null;
      if (inUse || current) {
        store.recordContainer(stored.rootPath);
        return stored.rootPath;
      }
    }
    const rootPath = await chooseFeaturesFolder(hostId, dataDir, failure);
    store.setFeaturesRoot(hostId, rootPath, FEATURE_ROOT_SCHEME);
    store.recordContainer(rootPath);
    return rootPath;
  };

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

  const chooseFeaturesFolder = async (
    hostId: string,
    dataDir: string,
    failure: string | null,
  ): Promise<string> => {
    if (failure === null && dataDir.length > 0) {
      const dataRoot = daemonDataRoot(dataDir);
      if (dataRoot === null) {
        bb.log.warn(
          `feature folders cannot be placed under ${dataDir}: it is plugin storage, not bb's data directory. Using the home folder instead.`,
        );
      } else {
        const candidate = featuresFolderIn(dataRoot);
        if (reservedWorkspaceReason({ dataDir: dataRoot, path: candidate }) === null) {
          return candidate;
        }
        bb.log.warn(
          `feature folders cannot live at ${candidate}: bb treats it as its own storage. Using the home folder instead.`,
        );
      }
    }
    return `${normalizePath(await homeOf(hostId))}/${HOME_FEATURES_FOLDER}`;
  };

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
