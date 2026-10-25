/**
 * Which threads the tree draws, and why.
 *
 * `experimental_useSidebarThreads` has three states and no refetch. The state
 * the sidebar is least prepared for is `error`: the naive reading is "there are
 * no threads", and a sidebar that acts on it throws away a perfectly good tree
 * because one refresh failed — the user loses their place, their scroll, and
 * every row they were looking at, over a hiccup that fixes itself.
 *
 * So the rows on screen are resolved rather than read:
 *
 * - `host` — the live answer. The only source that is authoritative.
 * - `stale` — the last `host` answer, kept because the host has gone back to
 *   `loading` or `error`. The tree stays exactly as it was, one refresh behind.
 * - `recovered` — read from bb's SDK through the plugin's own backend, for the
 *   cold case where the host view has failed and there is no last answer to
 *   fall back on. This is what makes the retry do something.
 * - `none` — nothing to draw yet, which is what a first load looks like.
 *
 * The precedence is deliberate: a last-known-good host answer always beats a
 * recovery, because it came from the source that owns the question, and a
 * recovery only exists to fill the gap a cold failure leaves.
 */

import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk";

export interface ThreadViewSnapshot {
  readonly threads: readonly PluginSidebarThread[];
  readonly projects: readonly PluginSidebarProject[];
}

/** Where the rows on screen came from. */
export type ThreadViewSource = "host" | "stale" | "recovered" | "none";

export interface ThreadView extends ThreadViewSnapshot {
  readonly source: ThreadViewSource;
}

export const EMPTY_THREAD_VIEW: ThreadView = {
  source: "none",
  threads: [],
  projects: [],
};

export function resolveThreadView(input: {
  status: "error" | "loading" | "ready";
  /** The live answer, whatever the host is currently reporting. */
  host: ThreadViewSnapshot;
  /** The last answer the host gave while it was `ready`. */
  lastGoodHost: ThreadViewSnapshot | null;
  /** Rows read from bb's SDK, once a retry has succeeded. */
  recovered: ThreadViewSnapshot | null;
}): ThreadView {
  const { status, host, lastGoodHost, recovered } = input;
  if (status === "ready") {
    return { source: "host", threads: host.threads, projects: host.projects };
  }
  // A host that has gone back to `loading` is refetching, not empty: blanking
  // the list here is the flicker the last-known-good snapshot exists to stop.
  if (lastGoodHost !== null) {
    return {
      source: "stale",
      threads: lastGoodHost.threads,
      projects: lastGoodHost.projects,
    };
  }
  if (status === "error" && recovered !== null) {
    return {
      source: "recovered",
      threads: recovered.threads,
      projects: recovered.projects,
    };
  }
  return EMPTY_THREAD_VIEW;
}

/**
 * What a degraded view owes the user, or null when it owes nothing.
 *
 * Kept here rather than in the component so the two notices cannot drift from
 * the two sources that produce them, and so the wording is testable without a
 * renderer. Both are written to say what is on screen and why, because a tree
 * that is quietly a minute old is worse than one that admits it.
 */
export function threadViewNotice(source: ThreadViewSource): string | null {
  if (source === "stale") {
    return "Couldn't refresh threads. Showing the last known state.";
  }
  if (source === "recovered") {
    return "bb's sidebar view is unavailable. Showing threads read from bb directly.";
  }
  return null;
}