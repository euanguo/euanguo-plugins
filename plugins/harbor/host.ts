import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { worktreeDirectoryContract } from "./host/contract.ts";
import { removeGitWorktree } from "./host/git-worktree.ts";
import { probeProjectIcon } from "./host/project-icon.ts";
import { resolveWorkspaceFacts } from "./host/workspace-facts.ts";
import {
  inspectFeatureGitStatus,
  linkFeatureReference,
  pushRepoBranch,
  readCodeWorkspaceFile,
  readRepoDiff,
  unlinkFeatureReference,
} from "./host/feature-git.ts";
import {
  createWorktree,
  deleteBranch,
  ensureFeatureDirectory,
  inspectWorktrees,
  probeWorktree,
  readHomeDirectory,
  removeFeatureDirectory,
  renameBranch,
  scanFeatureDirectories,
  writeFeatureContext,
} from "./host/feature-worktree.ts";

/**
 * Harbor's host entry: the commands it runs on the machine that owns a workspace.
 * Everything else the plugin does is a store or a decision, and those belong on
 * the server.
 */
export default experimental_defineHostEntry({
  contract: worktreeDirectoryContract,
  handlers: {
    readHomeDirectory: () => ({ home: readHomeDirectory() }),
    readDataDirectory: (_input, context) => ({
      dataDir: context.experimental_paths.dataDir,
    }),
    ensureFeatureDirectory: (input, context) =>
      ensureFeatureDirectory({ ...input, signal: context.signal }),
    scanFeatureDirectories: async (input) => ({
      results: await scanFeatureDirectories(input),
    }),
    inspectFeatureWorktrees: async (input, context) => ({
      worktrees: await inspectWorktrees({ ...input, signal: context.signal }),
    }),
    removeFeatureDirectory: (input) => removeFeatureDirectory(input.featureDirectory),
    probeFeatureWorktree: (input, context) => probeWorktree({ ...input, signal: context.signal }),
    createFeatureWorktree: (input, context) => createWorktree({ ...input, signal: context.signal }),
    writeFeatureContext: (input) => writeFeatureContext(input),
    renameFeatureBranch: (input, context) => renameBranch({ ...input, signal: context.signal }),
    deleteFeatureBranch: (input, context) => deleteBranch({ ...input, signal: context.signal }),
    removeWorktree: (input, context) => removeGitWorktree({ ...input, signal: context.signal }),
    /**
     * The probe is total by construction: it answers every path it was given,
     * with `realPath: null` for one it could not read. So there is nothing to
     * catch here — an error reaching this boundary would be a bug in the
     * probe, not a directory the user should hear about.
     */
    resolveWorkspaceFacts: async (input) => ({
      facts: await resolveWorkspaceFacts(input.paths),
    }),
    /**
     * The probe is total by construction and answers `unchanged` when the
     * cached icon file still has the same mtime, so the server can keep its
     * bytes without another read. Errors are caught at the boundary.
     */
    detectProjectIcon: async (input) => {
      try {
        const result = await probeProjectIcon(input);
        switch (result.status) {
          case "found":
            return {
              status: "found" as const,
              ...result.icon,
              mtimeMs: result.mtimeMs,
            };
          case "unchanged":
            return { status: "unchanged" as const };
          case "none":
            return result.reason === undefined
              ? { status: "none" as const }
              : { status: "none" as const, reason: result.reason };
          case "too-large":
            return {
              status: "too-large" as const,
              label: result.label,
              size: result.size,
            };
        }
      } catch (error) {
        return {
          status: "failed" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    inspectFeatureGitStatus: async (input, context) => ({
      repos: [
        ...(await inspectFeatureGitStatus({ ...input, signal: context.signal })),
      ],
    }),
    readRepoDiff: async (input, context) => {
      const result = await readRepoDiff({ ...input, signal: context.signal });
      return {
        ...result,
        files: [...result.files],
      };
    },
    pushRepoBranch: (input, context) =>
      pushRepoBranch({ ...input, signal: context.signal }),
    linkFeatureReference: (input) => linkFeatureReference(input),
    unlinkFeatureReference: (input) => unlinkFeatureReference(input),
    readCodeWorkspaceFile: (input) => readCodeWorkspaceFile(input),
  },
});
