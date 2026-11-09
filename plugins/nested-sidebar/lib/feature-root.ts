/**
 * Where feature folders live, and which projects hold them.
 *
 * Feature folders are bb's working state, so they live under bb's own plugin
 * data directory (`<dataDir>/features`) rather than in the home folder or among
 * the user's repositories. The one exception is a root an earlier build chose:
 * those folders cannot be moved, because bb has no way to change an
 * environment's path once a thread runs there, so an old root stays in use for
 * as long as a feature lives under it.
 *
 * `~/NestFeatures` remains only as the fallback for a machine that cannot say
 * where its data directory is.
 */

export const FEATURES_FOLDER = "NestFeatures";

/** The folder a feature's own directory lives in. */
export function featureRootParent(featureRootPath: string): string {
  return parentOf(normalizePath(featureRootPath));
}

export function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/u, "");
}

/**
 * The bb projects that hold feature folders.
 *
 * Every project whose source is one of the container paths: the current root,
 * and any root a feature folder was created under before the root moved. The
 * project view hides all of them — their rows are folders named after the work,
 * which the feature view already draws by the feature's name.
 */
export function featureContainerProjectIds(input: {
  readonly projects: readonly {
    readonly id: string;
    readonly sources: readonly { readonly path?: string | null }[];
  }[];
  readonly containerPaths: Iterable<string>;
}): string[] {
  const wanted = new Set(
    [...input.containerPaths].map(normalizePath).filter((path) => path.length > 0),
  );
  return input.projects
    .filter((project) =>
      project.sources.some(
        (source) =>
          typeof source.path === "string" && wanted.has(normalizePath(source.path)),
      ),
    )
    .map((project) => project.id);
}

function parentOf(path: string): string {
  const parts = normalizePath(path).split("/");
  parts.pop();
  return parts.join("/") || "/";
}
