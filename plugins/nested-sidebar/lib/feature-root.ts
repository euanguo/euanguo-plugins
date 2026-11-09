/**
 * Where feature folders live, and which projects hold them.
 *
 * Feature folders are bb's working state, and they sit in bb's data directory
 * so they follow bb rather than being guessed from the user's repositories.
 * They must not, however, sit in one of the places bb reserves for itself:
 *
 * - `<dataDir>/worktrees` and `<dataDir>/personal-workspaces` are the legacy
 *   managed-workspace roots;
 * - `<dataDir>/plugins/<id>/host-data` and `<dataDir>/plugins/<id>/bridge-data`
 *   hold a plugin's own private data.
 *
 * A thread started at a path in either place is refused with "inside bb-managed
 * storage but is not a workspace of this project", because bb only honours a
 * workspace it created there. Feature folders are places a person starts
 * conversations in, so they belong beside those reserved roots, not inside
 * them: `<dataDir>/nested-sidebar-features/<slug>`.
 *
 * The name carries the plugin on purpose. The data directory is shared by every
 * plugin and by bb itself, so a generic `features` folder would be a promise
 * this plugin cannot keep.
 *
 * The one exception to the folder above is a root an earlier build chose:
 * those folders cannot be moved, because bb has no way to change an
 * environment's path once a thread runs there, so an old root stays in use for
 * as long as a feature lives under it.
 */

/** The folder under bb's data directory that holds this plugin's features. */
export const FEATURES_FOLDER = "nested-sidebar-features";

/** The home-folder name an older build used, kept only as a fallback. */
export const LEGACY_FEATURES_FOLDER = "NestFeatures";

/** The data-directory children bb reserves for its own workspaces. */
const RESERVED_WORKSPACE_ROOTS = ["worktrees", "personal-workspaces"] as const;

/** The data-directory children that hold a plugin's private data. */
const PLUGIN_DATA_KINDS = ["host-data", "bridge-data"] as const;

/** The folder a feature's own directory lives in. */
export function featureRootParent(featureRootPath: string): string {
  return parentOf(normalizePath(featureRootPath));
}

export function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/u, "");
}

/** Whether `path` is `root` itself or sits below it. */
export function isWithinPath(root: string, path: string): boolean {
  const outer = normalizePath(root);
  const inner = normalizePath(path);
  if (outer.length === 0) return false;
  return inner === outer || inner.startsWith(`${outer}/`);
}

/**
 * The folder this plugin's features live in, given bb's data directory.
 *
 * Derived rather than configured: the data directory is whatever bb reports at
 * runtime, and the only thing added is this plugin's own name.
 */
export function featuresFolderIn(dataDir: string): string {
  return `${normalizePath(dataDir)}/${FEATURES_FOLDER}`;
}

/**
 * Why bb would refuse to start a thread at `path`, or null when it would not.
 *
 * Mirrors bb's own rule so a folder this plugin chooses is never one bb
 * reserves. It is a guard, not a second implementation of the rule: the answer
 * is only used to reject a candidate root before anything is created.
 */
export function reservedWorkspaceReason(input: {
  readonly dataDir: string;
  readonly path: string;
}): string | null {
  const dataDir = normalizePath(input.dataDir);
  const path = normalizePath(input.path);
  if (dataDir.length === 0) return null;
  for (const name of RESERVED_WORKSPACE_ROOTS) {
    if (isWithinPath(`${dataDir}/${name}`, path)) {
      return `it is inside ${name}/, where bb keeps its own managed workspaces`;
    }
  }
  const pluginsRoot = `${dataDir}/plugins`;
  if (!isWithinPath(pluginsRoot, path)) return null;
  const relative = path.slice(pluginsRoot.length + 1).split("/");
  const [, kind] = relative;
  if (kind !== undefined && PLUGIN_DATA_KINDS.some((candidate) => candidate === kind)) {
    return `it is inside a plugin's private ${kind}/ directory`;
  }
  return null;
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
