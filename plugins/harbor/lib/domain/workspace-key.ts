/**
 * The one identity a physical workspace has.
 *
 * A workspace is a directory on a machine. bb records it as an environment with
 * a path, and that path is what every row, stored order and ownership decision
 * keys on. The project an environment claims is metadata: a claim can change,
 * and when it did the old project-scoped key took the user's order and
 * expansion with it.
 *
 * There were three spellings of this identity — the realPath key in
 * `repo-identity`, the bb-recorded path in `workspace-index`, and the
 * project-scoped `workspace:<host>:<project>:<path>` form in `workspace`. They
 * are one factory now: the primary key is always the bb-recorded normalized
 * path.
 *
 * This module is pure: no React, no SDK, no filesystem. The brand is
 * compile-time only, so a key is the string it always was on the wire and in
 * storage.
 */

declare const workspaceKeyBrand: unique symbol;

/**
 * A workspace's primary key.
 *
 * The brand keeps a raw environment id or a project id from being passed where
 * a workspace key is expected. It erases at runtime.
 */
export type WorkspaceKey = string & { readonly [workspaceKeyBrand]: true };

/** A path in the one spelling every key compares. */
export function normalizeWorkspacePath(
  path: string | null | undefined,
): string | null {
  const trimmed = path?.trim();
  if (trimmed === undefined || trimmed.length === 0) return null;
  const normalized = trimmed
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
  return normalized.length === 0 ? "/" : normalized;
}

/**
 * The identity of a directory: `ws:<hostId>:<normalizedPath>`.
 *
 * Not the environment id. bb can hold two records for one directory, and one
 * record can be retired and replaced; both are the same workspace, and drawing
 * them apart is how one worktree becomes two rows.
 *
 * Not the project either. A project claim is metadata, so two records that
 * disagree about it still answer to one key.
 */
export function physicalWorkspaceKey(
  hostId: string,
  path: string,
): WorkspaceKey {
  return `ws:${hostId}:${normalizeWorkspacePath(path) ?? path}` as WorkspaceKey;
}

/**
 * The fallback identity for a record with no usable path.
 *
 * An environment bb could not place on disk has no physical identity, so it
 * keeps the id it came with. It never merges with a path-backed row.
 */
export function environmentWorkspaceKey(environmentId: string): WorkspaceKey {
  return `environment:${environmentId}` as WorkspaceKey;
}
