import { useMemo } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { harborRpcContract } from "@/server/contract";
import { useFocusSyncedRpc } from "@/hooks/use-focus-synced-rpc";
import { defineStoreSnapshot } from "@/lib/persistence/snapshot";
import { WORKSPACE_PATHS_SNAPSHOT_CODEC } from "@/lib/persistence/store-persistence";
import type { WorkspacePaths } from "@/lib/domain/workspace";

const EMPTY: WorkspacePaths = { environments: {}, projects: {} };

// Persisted so cold-start copy actions do not vanish while the first read resolves.
const workspacePathsSnapshot = defineStoreSnapshot<WorkspacePaths>("workspace-paths", {
  persist: WORKSPACE_PATHS_SNAPSHOT_CODEC,
});
const refreshListeners = new Set<() => void>();

/** Forces mounted `useWorkspacePaths` subscribers to re-read BB environments. */
export function triggerWorkspacePathsRefresh(): void {
  for (const listener of refreshListeners) listener();
}

/**
 * On-disk paths and live git branches for every workspace and project, synced
 * whenever thread environment facts change or the window returns to the front.
 */
export function useWorkspacePaths(): WorkspacePaths {
  const rpc = useRpc<typeof harborRpcContract>();
  const { threads } = useSidebarThreads();

  const signature = useMemo(() => {
    const facts = new Set<string>();
    for (const thread of threads) {
      const env = thread.environment;
      if (env === null || env.id === null) continue;
      facts.add([env.id, env.branchName ?? "", env.name ?? ""].join(" "));
    }
    return [...facts].sort().join("\n");
  }, [threads]);

  return useFocusSyncedRpc({
    rpcKey: rpc,
    signature,
    initialValue: () => workspacePathsSnapshot.read() ?? EMPTY,
    fetchValue: () => rpc.call("listWorkspacePaths", {}),
    onSuccess: (result) => workspacePathsSnapshot.write(result),
    listeners: refreshListeners,
  });
}
