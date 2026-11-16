import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

/**
 * Line counts for one environment, the number the Changes button shows.
 *
 * The Git plugin owns the read. The header asks for the one environment it
 * draws, and a missing answer simply leaves the button saying Changes.
 */
const GIT_PLUGIN_ID = "bb--git";

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

export interface WorkspaceChanges {
  readonly insertions: number;
  readonly deletions: number;
}

export function useWorkspaceChanges(
  environmentId: string | null,
): WorkspaceChanges | null {
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
