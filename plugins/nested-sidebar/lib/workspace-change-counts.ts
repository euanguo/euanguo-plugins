import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

/**
 * Line counts for every workspace row the sidebar draws, in one read.
 *
 * The Git plugin owns the read and answers per environment. The header reads
 * its one environment through `workspace-changes.ts`; the list reads all of its
 * rows here with one keyed query, so a row's `+12 −3` costs no request of its
 * own. A row with no answer simply draws no counts.
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
  const rows = new Map<string, WorkspaceChangeCount>();
  for (const [environmentId, row] of Object.entries(query.data ?? {})) {
    if (row.outcome !== "available" || row.workspace === undefined) continue;
    rows.set(environmentId, {
      insertions: row.workspace.allChanges.insertions,
      deletions: row.workspace.allChanges.deletions,
    });
  }
  return rows;
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
