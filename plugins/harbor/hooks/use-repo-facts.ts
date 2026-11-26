import { useMemo } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { harborRpcContract } from "@/server/contract";
import { useFocusSyncedRpc } from "@/hooks/use-focus-synced-rpc";
import { defineStoreSnapshot } from "@/lib/persistence/snapshot";
import { NO_REPO_FACTS, type RepoFacts } from "@/lib/domain/repo-identity";

const repoFactsSnapshot = defineStoreSnapshot<RepoFacts>("repo-facts");
const refreshListeners = new Set<() => void>();

/** Forces active `useRepoFacts` subscribers (Sidebar + Diagnostics) to re-probe. */
export function triggerRepoFactsRefresh(): void {
  for (const listener of refreshListeners) listener();
}

/**
 * Physical repository identity backing each project/workspace, probed lazily and
 * refreshed when the environment list changes or the window returns to focus.
 */
export function useRepoFacts(): RepoFacts {
  const rpc = useRpc<typeof harborRpcContract>();
  const { threads, projects } = useSidebarThreads();

  const signature = useMemo(() => {
    const facts = new Set<string>();
    for (const project of projects) facts.add(`p:${project.id}`);
    for (const thread of threads) {
      const env = thread.environment;
      if (env === null) continue;
      facts.add([env.id ?? "", env.branchName ?? "", env.workspaceDisplayKind ?? ""].join(" "));
    }
    return [...facts].sort().join("\n");
  }, [projects, threads]);

  return useFocusSyncedRpc({
    rpcKey: rpc,
    signature,
    initialValue: () => repoFactsSnapshot.read() ?? NO_REPO_FACTS,
    fetchValue: () => rpc.call("listRepoFacts", {}),
    onSuccess: (result) => repoFactsSnapshot.write(result),
    listeners: refreshListeners,
  });
}
