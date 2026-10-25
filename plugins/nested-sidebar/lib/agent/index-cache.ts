/**
 * The sidebar's own state, in a form the two synchronous agent callbacks can read.
 *
 * `bb.agents.contributeInstructions` and `bb.agents.configure` both run on the
 * thread-start path and both must be synchronous, and they need things that only
 * come back from an await: the project list, the environments, the repository
 * read. So the answer is materialized — written down whenever the server has
 * finished computing it, and read back synchronously when a thread starts.
 *
 * Two tiers, and both are needed. Memory covers the ordinary case and costs
 * nothing. The row covers the reload: a plugin restarted by a settings change or
 * an update has no memory of anything, and a thread starting in the second
 * before the first read lands would otherwise be told nothing about a sidebar
 * that has not changed at all.
 *
 * The row is a cache and is treated as one. It is never authoritative — the read
 * that replaces it always follows, and a value that will not decode is dropped
 * rather than trusted. A version field is the whole migration story: a build
 * that changes what the index holds bumps it, and an old row is discarded
 * instead of misread as the new shape.
 */

import type Database from "better-sqlite3";
import type { GroupAssignment, ProjectGroup } from "../groups.ts";
import type { RepoFacts } from "../repo-identity.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "../workspace.ts";

/** Bumped whenever the shape below changes, so an old row is discarded. */
export const SIDEBAR_INDEX_VERSION = 2;

/**
 * One row, because there is one index.
 *
 * A table rather than `bb.storage.kv` because that API is asynchronous, and the
 * whole reason this exists is a callback that cannot wait.
 */
export const SIDEBAR_INDEX_MIGRATION = `CREATE TABLE IF NOT EXISTS sidebar_index (
  id         INTEGER PRIMARY KEY CHECK (id = 0),
  version    INTEGER NOT NULL,
  payload    TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

/**
 * Everything the agent callbacks need, which is everything the server already
 * computes for the sidebar. No new vocabulary: the same records the tree and the
 * map tool are built from, so there is one description of a workspace rather
 * than two that can disagree.
 */
export interface SidebarIndex {
  readonly projects: readonly { readonly id: string; readonly name: string }[];
  readonly groups: readonly ProjectGroup[];
  /** projectId -> groupId; a project absent from this is in Ungrouped. */
  readonly assignment: GroupAssignment;
  readonly repoFacts: RepoFacts;
  readonly environments: Readonly<Record<string, WorkspaceEnvironmentDescriptor>>;
  readonly projectSources: Readonly<Record<string, WorkspaceProjectDescriptor>>;
  /** When the server computed this, so a reader can say how old it is. */
  readonly updatedAt: number;
}

export interface SidebarIndexCache {
  /** The freshest index there is, or null when nothing has been computed yet. */
  read(): SidebarIndex | null;
  write(index: SidebarIndex): void;
}

/**
 * Whether the payload is one this build can read.
 *
 * Shallow on purpose, and shallow for a different reason than the browser-side
 * codecs in `store-persistence.ts` are deep. Those decode `localStorage`, which
 * is user-writable and shared with every other script on the origin, so a
 * poisoned entry is an attacker's input. This row is in the plugin's own
 * database, written by the plugin and read by the plugin: it is a *version*
 * boundary, not a trust boundary. The version column catches what actually
 * happens — a build that changed the shape — and these container checks catch a
 * write that did not finish. Validating every nested workspace here would
 * restate the types and still not make a truncated row worth drawing.
 */
function isSidebarIndexPayload(value: unknown): value is SidebarIndex {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    Array.isArray(row.projects) &&
    Array.isArray(row.groups) &&
    row.assignment !== null && typeof row.assignment === "object" &&
    row.repoFacts !== null && typeof row.repoFacts === "object" &&
    row.environments !== null && typeof row.environments === "object" &&
    row.projectSources !== null && typeof row.projectSources === "object" &&
    typeof row.updatedAt === "number"
  );
}

function decodeSidebarIndex(raw: string): SidebarIndex | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isSidebarIndexPayload(parsed)) return null;
  const { projects, groups, assignment, repoFacts, environments, projectSources, updatedAt } = parsed;
  return { projects, groups, assignment, repoFacts, environments, projectSources, updatedAt };
}

export function createSidebarIndexCache(db: Database.Database): SidebarIndexCache {
  /** The hot tier, filled on the first read after a load. */
  let held: SidebarIndex | null = null;

  const readRow = (): SidebarIndex | null => {
    const row = db
      .prepare(`SELECT version, payload FROM sidebar_index WHERE id = 0`)
      .get() as { version: unknown; payload: unknown } | undefined;
    if (typeof row?.payload !== "string") return null;
    // The column is the only place the version lives. Stamping it into the
    // payload as well would be two answers to one question, and the one that
    // got read would be whichever this function happened to look at.
    if (row.version !== SIDEBAR_INDEX_VERSION) return null;
    return decodeSidebarIndex(row.payload);
  };

  return {
    read() {
      if (held === null) held = readRow();
      return held;
    },
    write(index) {
      held = index;
      // The row is a convenience for the next process, so a write that cannot
      // land must not fail the read that produced the index. The plugin's own
      // database is WAL-mode and on the same disk as everything else it stores,
      // so this is the same failure surface as any other write here.
      try {
        db.prepare(
          `INSERT INTO sidebar_index (id, version, payload, updated_at)
           VALUES (0, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             version = excluded.version,
             payload = excluded.payload,
             updated_at = excluded.updated_at`,
        ).run(SIDEBAR_INDEX_VERSION, JSON.stringify(index), index.updatedAt);
      } catch {
        // Memory still has it, which is what this turn needs.
      }
    },
  };
}
