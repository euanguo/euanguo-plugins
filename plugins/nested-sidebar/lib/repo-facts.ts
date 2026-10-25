/**
 * The last answer each machine gave about its directories, kept briefly.
 *
 * A probe is a round trip to the machine that owns the paths, and the sidebar
 * asks on every mount. Without a cache that is a network hop in front of the
 * first frame every time the settings route is opened and closed; with a cache
 * that never expires, a worktree created by another tool stays invisible until
 * bb restarts.
 *
 * So the answer is kept for a short window. The window is the whole policy:
 * long enough that a user moving between the sidebar and the settings page pays
 * for one probe, short enough that the repository's own record — which is the
 * only place a worktree made outside bb shows up — is re-read while the user is
 * still looking at the list.
 *
 * Nothing is persisted. A fact about a directory on a machine is only as good
 * as the last time that machine was asked, and a stored answer would outlive
 * the process that could have refreshed it.
 */

import type { WorkspaceFacts } from "./repo-identity.ts";

/** How long one machine's answer about one directory may be reused. */
export const REPO_FACTS_TTL_MS = 30_000;

/** One directory on one machine, which is what a probe is asked about. */
export interface WorkspaceProbeTarget {
  readonly hostId: string;
  readonly path: string;
}

/**
 * Ask one machine about a batch of paths.
 *
 * Injected rather than imported so this module has no transport and no host
 * client: the cache is about when an answer may be reused, and that decision is
 * testable without a machine.
 */
export type WorkspaceProbe = (
  hostId: string,
  paths: readonly string[],
) => Promise<readonly WorkspaceFacts[]>;

export interface RepoFactsRead {
  readonly facts: readonly WorkspaceFacts[];
  /** Machines that did not answer, so the caller can say the picture is partial. */
  readonly unavailableHostIds: readonly string[];
}

export interface RepoFactsCache {
  read(targets: readonly WorkspaceProbeTarget[]): Promise<RepoFactsRead>;
  /**
   * Forget everything.
   *
   * For a change this plugin made itself: it knows the answer it just
   * invalidated, so waiting out the window would be a deliberate delay.
   */
  invalidate(): void;
}

interface HeldFact {
  readonly facts: WorkspaceFacts;
  readonly at: number;
}

export function createRepoFactsCache(input: {
  readonly probe: WorkspaceProbe;
  readonly now?: () => number;
  readonly ttlMs?: number;
}): RepoFactsCache {
  const now = input.now ?? Date.now;
  const ttlMs = input.ttlMs ?? REPO_FACTS_TTL_MS;
  /** hostId -> path -> the last answer about it. */
  const held = new Map<string, Map<string, HeldFact>>();

  return {
    async read(targets) {
      const at = now();
      const byHost = new Map<string, Set<string>>();
      for (const target of targets) {
        const paths = byHost.get(target.hostId) ?? new Set<string>();
        paths.add(target.path);
        byHost.set(target.hostId, paths);
      }

      const unavailableHostIds: string[] = [];
      await Promise.all(
        [...byHost.entries()].map(async ([hostId, paths]) => {
          const forHost = held.get(hostId) ?? new Map<string, HeldFact>();
          held.set(hostId, forHost);

          const stale = [...paths].filter((path) => {
            const fact = forHost.get(path);
            return fact === undefined || at - fact.at >= ttlMs;
          });
          if (stale.length > 0) {
            try {
              for (const fact of await input.probe(hostId, stale)) {
                forHost.set(fact.path, { facts: fact, at });
              }
            } catch {
              // A machine that did not answer is not a machine with no
              // worktrees. What is already held is still the best answer there
              // is, so it is kept rather than dropped, and the caller is told
              // the picture is partial.
              unavailableHostIds.push(hostId);
            }
          }
        }),
      );

      const facts: WorkspaceFacts[] = [];
      for (const [hostId, paths] of byHost) {
        for (const path of paths) {
          const fact = held.get(hostId)?.get(path);
          if (fact !== undefined) facts.push(fact.facts);
        }
      }
      return { facts, unavailableHostIds };
    },

    invalidate() {
      held.clear();
    },
  };
}
