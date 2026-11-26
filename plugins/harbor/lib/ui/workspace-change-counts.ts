import { useMemo } from "react";
import { experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { defineRpcContract } from "../schemas/rpc-contract.ts";

/**
 * Line counts for workspace rows and the active header button, read from `bb--git`.
 */
const GIT_PLUGIN_ID = "bb--git";
const MAX_KEYS = 200;

const keysInput = z.object({ keys: z.array(z.string().min(1)) });

const gitStatusRowSchema = z.looseObject({
  outcome: z.string(),
  workspace: z
    .looseObject({
      allChanges: z.object({
        insertions: z.number(),
        deletions: z.number(),
      }),
    })
    .optional(),
});

const gitReadContract = defineRpcContract({
  status: {
    input: keysInput,
    output: z.record(z.string(), gitStatusRowSchema),
  },
});

export interface WorkspaceChangeCount {
  readonly insertions: number;
  readonly deletions: number;
}

export function useWorkspaceChanges(
  environmentId: string | null,
): WorkspaceChangeCount | null {
  const keys = environmentId === null ? [] : [environmentId];
  const query = experimental_useRpcKeyedQuery({
    pluginId: GIT_PLUGIN_ID,
    contract: gitReadContract,
    method: "status",
    keys,
    enabled: keys.length > 0,
  });
  if (environmentId === null) return null;
  const row = query.data?.[environmentId];
  if (row === undefined || row.outcome !== "available" || row.workspace === undefined) {
    return null;
  }
  return {
    insertions: row.workspace.allChanges.insertions,
    deletions: row.workspace.allChanges.deletions,
  };
}

export function useWorkspaceChangeCounts(
  environmentIds: readonly string[],
): ReadonlyMap<string, WorkspaceChangeCount> {
  const keys = environmentIds.slice(0, MAX_KEYS);
  const query = experimental_useRpcKeyedQuery({
    pluginId: GIT_PLUGIN_ID,
    contract: gitReadContract,
    method: "status",
    keys,
    enabled: keys.length > 0,
  });
  /**
   * One map per read, not one per render, so the memoized tree contexts retain
   * reference stability.
   */
  return useMemo(() => {
    const rows = new Map<string, WorkspaceChangeCount>();
    for (const [environmentId, row] of Object.entries(query.data ?? {})) {
      if (row.outcome !== "available" || row.workspace === undefined) continue;
      rows.set(environmentId, {
        insertions: row.workspace.allChanges.insertions,
        deletions: row.workspace.allChanges.deletions,
      });
    }
    return rows;
  }, [query.data]);
}

/** A workspace's counts: the first of its records the Git plugin answered for. */
export function changeCountFor(
  counts: ReadonlyMap<string, WorkspaceChangeCount>,
  environmentIds: readonly string[],
): WorkspaceChangeCount | null {
  for (const environmentId of environmentIds) {
    const count = counts.get(environmentId);
    if (count !== undefined) return count;
  }
  return null;
}
