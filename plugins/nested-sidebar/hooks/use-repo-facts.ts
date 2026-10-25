import { useEffect, useMemo, useState } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server";
import { defineStoreSnapshot } from "@/lib/store-snapshot";
import { NO_REPO_FACTS, type RepoFacts } from "@/lib/repo-identity";

export type { RepoFacts } from "@/lib/repo-identity";

// Deliberately not persisted. Every other snapshot in this plugin holds
// something the user arranged and would miss; this holds what a machine said
// about its own disk a moment ago, which is the one thing here that can be
// wrong rather than merely absent. A stale repository map drawn from storage
// would be a confident wrong answer, and the read that corrects it costs one
// round trip against a server-side cache.
const repoFactsSnapshot = defineStoreSnapshot<RepoFacts>("repo-facts");

/**
 * Which repository each workspace really belongs to.
 *
 * This is the second, physical axis under the sidebar: bb files a thread under
 * a project, and a project is a record someone or something created. A
 * repository is not a record — two checkouts of it share one `.git` — so this
 * read is what lets the tree group by something an agent cannot get wrong.
 *
 * Read at mount, and again whenever the environments change shape, because a
 * worktree appearing or disappearing is exactly what moves a workspace from one
 * repository's list to another's. That signature is the whole trigger: this
 * plugin's own worktree removal already moves it, and a worktree made by another
 * tool leaves no signal at all — which is why the server's answer also expires
 * on its own, and why the window coming back to the front re-reads. That is the
 * cheap guess in its place, and it is the moment the user is about to look.
 *
 * Failure is not an error here. The tree draws from `projectId` without this,
 * so a machine that never answers costs the repo grouping and nothing else.
 */
export function useRepoFacts(): RepoFacts {
  const rpc = useRpc<typeof nestRpcContract>();
  const { threads } = useSidebarThreads();
  const [facts, setFacts] = useState<RepoFacts>(
    () => repoFactsSnapshot.read() ?? NO_REPO_FACTS,
  );
  const [wakeToken, setWakeToken] = useState(0);

  /**
   * A sorted, de-duplicated signature of the environments the live view knows.
   *
   * The same trick `useWorkspacePaths` uses and for the same reason: a
   * workspace's path or branch moving is the only thing this read cares about,
   * and thread activity that says nothing new about an environment must not
   * cost a probe.
   */
  const environmentSignature = useMemo(() => {
    const facts = new Set<string>();
    for (const thread of threads) {
      const environment = thread.environment;
      if (environment === null) continue;
      facts.add(
        [
          environment.id ?? "",
          environment.branchName ?? "",
          environment.workspaceDisplayKind ?? "",
        ].join(" "),
      );
    }
    return [...facts].sort().join("\n");
  }, [threads]);

  useEffect(() => {
    let cancelled = false;
    rpc
      .call("listRepoFacts", {})
      .then((result) => {
        if (cancelled) return;
        setFacts(result);
        repoFactsSnapshot.write(result);
      })
      .catch(() => {
        // The project grouping still works, so there is nothing to tell the
        // user about: the tree keeps the last answer it had.
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, environmentSignature, wakeToken]);

  useEffect(() => {
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      setWakeToken((token) => token + 1);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, []);

  return facts;
}
