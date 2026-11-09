/**
 * The folders features live in, and the bb project at each of them.
 *
 * Kept beside the feature service rather than inside it: choosing a root is a
 * decision about a machine, not about one feature, and it is the part that has
 * to survive a restart so the next feature lands next to the last one.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { worktreeDirectoryContract } from "../host/contract.ts";
import { FEATURES_FOLDER, normalizePath } from "../lib/feature-root.ts";
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
   * bb's own plugin data directory, because these are bb's working folders:
   * not another entry at the top of the home folder, and not something mixed
   * into the user's code. The result is written down, so a later change to the
   * plugin cannot silently move the next feature away from the existing ones.
   *
   * A root chosen by an earlier build is kept for as long as a feature lives
   * under it — those features cannot be moved, since bb cannot change an
   * environment's path. Once nothing is there, the root is upgraded to the
   * current scheme.
   */
  const featuresFolderOf = async (hostId: string): Promise<string> => {
    const stored = store.featuresRoot(hostId);
    if (stored !== null) {
      const current = stored.scheme === FEATURE_ROOT_SCHEME;
      const root = normalizePath(stored.rootPath);
      const inUse = store
        .list()
        .some(
          (feature) =>
            feature.rootPath !== null &&
            (normalizePath(feature.rootPath) === root ||
              normalizePath(feature.rootPath).startsWith(`${root}/`)),
        );
      if (current || inUse) {
        if (!current) store.setFeaturesRoot(hostId, stored.rootPath, FEATURE_ROOT_SCHEME);
        store.recordContainer(stored.rootPath);
        return stored.rootPath;
      }
    }
    let rootPath: string;
    try {
      const answer = await call<{ dataDir: string }>(
        "readDataDirectory",
        {},
        hostId,
        timeoutMs,
      );
      rootPath = `${normalizePath(answer.dataDir)}/features`;
    } catch {
      // A machine that cannot say where bb keeps its data falls back to the
      // old home-folder location rather than failing to create a feature.
      rootPath = `${await homeOf(hostId)}/${FEATURES_FOLDER}`;
    }
    store.setFeaturesRoot(hostId, rootPath, FEATURE_ROOT_SCHEME);
    store.recordContainer(rootPath);
    return rootPath;
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
