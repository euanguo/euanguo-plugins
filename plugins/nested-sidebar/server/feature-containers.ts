/**
 * The folders features live in, and the bb project at each of them.
 *
 * Kept beside the feature service rather than inside it: choosing a root is a
 * decision about a machine, not about one feature, and it is the part that has
 * to survive a restart so the next feature lands next to the last one.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { chooseFeaturesRoot, normalizePath } from "../lib/feature-root.ts";
import type { FeatureStore } from "../lib/feature-store.ts";

/** The bb project every feature's root conversation belongs to. */
export const FEATURES_PROJECT_NAME = "Features";

export function createFeatureContainers(input: {
  readonly bb: BbPluginApi;
  readonly store: FeatureStore;
  readonly homeOf: (hostId: string) => Promise<string>;
  readonly ensureDirectory: (path: string, hostId: string) => Promise<void>;
}) {
  const { bb, store, homeOf, ensureDirectory } = input;

  /**
   * The folder features on this machine live in, chosen once and remembered.
   *
   * `~/NestFeatures` was the first design and it put a code directory at the
   * top of the home folder, where nobody looks for code. The root is now
   * derived from where the machine's projects already are — the most common
   * parent of its project sources — and written down, so a later project
   * cannot move new features away from the existing ones.
   */
  const featuresFolderOf = async (hostId: string): Promise<string> => {
    const stored = store.featuresRoot(hostId);
    if (stored !== null) return stored;
    const home = await homeOf(hostId);
    let projectPaths: string[] = [];
    try {
      const projects = await bb.sdk.projects.list({});
      projectPaths = projects.flatMap((project) =>
        project.sources
          .filter((source) => source.hostId === hostId)
          .map((source) => source.path)
          .filter((path): path is string => typeof path === "string" && path.length > 0),
      );
    } catch {
      // A project list that cannot be read leaves the home fallback.
    }
    const rootPath = chooseFeaturesRoot({ home, projectPaths });
    store.setFeaturesRoot(hostId, rootPath);
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
