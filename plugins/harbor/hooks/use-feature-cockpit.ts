import { useMemo } from "react";
import {
  experimental_useRpcMutation,
  experimental_useRpcQuery,
} from "@get-bb/plugin-sdk/app";

import { harborRpcContract } from "@/server/contract";

export function useFeatureGitStatus(
  featureId: string | null,
  options?: { readonly baseBranch?: string | null; readonly enabled?: boolean },
) {
  return experimental_useRpcQuery({
    contract: harborRpcContract,
    method: "getFeatureGitStatus",
    input: {
      featureId: featureId ?? "__none__",
      baseBranch: options?.baseBranch ?? null,
    },
    enabled: Boolean(featureId) && (options?.enabled ?? true),
  });
}

export function useFeatureRepoDiff(
  featureId: string | null,
  directory: string | null,
  options?: {
    readonly filePath?: string | null;
    readonly includeUntracked?: boolean;
    readonly enabled?: boolean;
  },
) {
  return experimental_useRpcQuery({
    contract: harborRpcContract,
    method: "readFeatureRepoDiff",
    input: {
      featureId: featureId ?? "__none__",
      directory: directory ?? "__none__",
      filePath: options?.filePath ?? null,
      includeUntracked: options?.includeUntracked ?? true,
    },
    enabled:
      Boolean(featureId) && Boolean(directory) && (options?.enabled ?? true),
  });
}

export function useFeaturePresets(enabled = true) {
  return experimental_useRpcQuery({
    contract: harborRpcContract,
    method: "listFeaturePresets",
    input: {},
    enabled,
  });
}

export function useFeatureHealth(
  featureId: string | null,
  deletesBranches: boolean,
  enabled = true,
) {
  return experimental_useRpcQuery({
    contract: harborRpcContract,
    method: "inspectFeatureHealth",
    input: {
      featureId: featureId ?? "__none__",
      deletesBranches,
    },
    enabled: Boolean(featureId) && enabled,
  });
}

export function useFeatureCockpitMutations() {
  const pushRepo = experimental_useRpcMutation({
    contract: harborRpcContract,
    method: "pushFeatureRepo",
  });
  const savePreset = experimental_useRpcMutation({
    contract: harborRpcContract,
    method: "saveFeaturePreset",
  });
  const deletePreset = experimental_useRpcMutation({
    contract: harborRpcContract,
    method: "deleteFeaturePreset",
  });
  const importWorkspace = experimental_useRpcMutation({
    contract: harborRpcContract,
    method: "importCodeWorkspace",
  });
  const activateOrphan = experimental_useRpcMutation({
    contract: harborRpcContract,
    method: "activateOrphanWorktree",
  });
  const batchSettle = experimental_useRpcMutation({
    contract: harborRpcContract,
    method: "batchSettleIdleThreads",
  });

  return useMemo(
    () => ({
      pushRepo,
      savePreset,
      deletePreset,
      importWorkspace,
      activateOrphan,
      batchSettle,
    }),
    [
      pushRepo,
      savePreset,
      deletePreset,
      importWorkspace,
      activateOrphan,
      batchSettle,
    ],
  );
}
