/**
 * Where a machine keeps its feature directories.
 *
 * A feature folder must not sit inside a repository, and it must not sit at the
 * top of the home directory either: `~/NestFeatures` is the first thing a
 * person sees and the last place they look for their code. So the root is
 * chosen from the machine itself — the folder most of its projects already
 * live in — and then written down, because a root that moved whenever a project
 * was added would be a root that stops matching the feature folders under it.
 *
 * The rule is deliberately one line: the most common parent of the projects on
 * this machine, with `NestFeatures` under it. A machine with no projects, or
 * with every project directly in the home directory, falls back to the home
 * directory — the old behaviour, kept as the last resort rather than the first.
 */

export const FEATURES_FOLDER = "NestFeatures";

export function chooseFeaturesRoot(input: {
  readonly home: string;
  /** Every project source path known on this machine. */
  readonly projectPaths: readonly string[];
}): string {
  const home = normalizePath(input.home);
  const counts = new Map<string, number>();
  for (const raw of input.projectPaths) {
    const path = normalizePath(raw);
    if (path.length === 0) continue;
    const parent = parentOf(path);
    if (parent.length === 0) continue;
    // A project directly in the home directory says nothing about where code
    // lives; the home directory is also the fallback, never a heuristic hit.
    if (parent === home) continue;
    // Nor is a feature folder a place to put feature folders.
    if (baseName(parent) === FEATURES_FOLDER) continue;
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0];
  return `${best?.[0] ?? home}/${FEATURES_FOLDER}`;
}

/** The folder a feature's own directory lives in. */
export function featureRootParent(featureRootPath: string): string {
  return parentOf(normalizePath(featureRootPath));
}

export function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/u, "");
}

function parentOf(path: string): string {
  const parts = normalizePath(path).split("/");
  parts.pop();
  return parts.join("/") || "/";
}

function baseName(path: string): string {
  return normalizePath(path).split("/").at(-1) ?? "";
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
