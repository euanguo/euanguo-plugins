import { useEffect, useMemo, useState } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { harborRpcContract } from "@/server/contract";
import { defineStoreSnapshot } from "@/lib/persistence/store-snapshot";
import { NO_REPO_FACTS, type RepoFacts } from "@/lib/domain/repo-identity";

const repoFactsSnapshot = defineStoreSnapshot<RepoFacts>("repo-facts");
const refreshListeners = new Set<() => void>();

/** Forces active `useRepoFacts` subscribers (Sidebar + Diagnostics) to re-probe. */
export function triggerRepoFactsRefresh(): void {
  for (const listener of refreshListeners) listener();
}

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
  const rpc = useRpc<typeof harborRpcContract>();
  const { threads, projects } = useSidebarThreads();
  const [facts, setFacts] = useState<RepoFacts>(
    () => repoFactsSnapshot.read() ?? NO_REPO_FACTS,
  );
  const [wakeToken, setWakeToken] = useState(0);

  /**
   * A sorted, de-duplicated signature of the environments and projects the
   * live view knows, so adding a project or worktree triggers a fresh probe.
   */
  const environmentSignature = useMemo(() => {
    const facts = new Set<string>();
    for (const project of projects) {
      facts.add(`p:${project.id}`);
    }
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
  }, [projects, threads]);

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
    const bump = () => setWakeToken((token) => token + 1);
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      bump();
    };
    refreshListeners.add(bump);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      refreshListeners.delete(bump);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, []);

  return facts;
}
