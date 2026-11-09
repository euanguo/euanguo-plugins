import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { worktreeDirectoryContract } from "./host/contract.ts";
import { removeGitWorktree } from "./host/git-worktree.ts";
import { detectProjectIcon } from "./host/project-icon.ts";
import { resolveWorkspaceFacts } from "./host/workspace-facts.ts";
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
 * Nest's host entry: the commands it runs on the machine that owns a workspace.
 * Everything else the plugin does is a store or a decision, and those belong on
 * the server.
 */
export default experimental_defineHostEntry({
  contract: worktreeDirectoryContract,
  handlers: {
    readHomeDirectory: () => ({ home: readHomeDirectory() }),
    ensureFeatureDirectory: (input) => ensureFeatureDirectory(input),
    scanFeatureDirectories: async (input) => ({
      results: await scanFeatureDirectories(input),
    }),
    inspectFeatureWorktrees: async (input) => ({
      worktrees: await inspectWorktrees(input),
    }),
    removeFeatureDirectory: (input) => removeFeatureDirectory(input.featureDirectory),
    probeFeatureWorktree: (input) => probeWorktree(input),
    createFeatureWorktree: (input) => createWorktree(input),
    writeFeatureContext: (input) => writeFeatureContext(input),
    renameFeatureBranch: (input) => renameBranch(input),
    deleteFeatureBranch: (input) => deleteBranch(input),
    removeWorktree: (input) => removeGitWorktree(input),
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
     * The detector answers `null` for a checkout with no icon, which is the
     * same answer as a checkout it could not read — but only one of those is
     * worth writing down as a probe that ran. So the throw is caught here, at
     * the boundary, and the server decides what to store.
     */
    detectProjectIcon: async (input) => {
      try {
        const icon = await detectProjectIcon(input.path);
        return icon === null
          ? { status: "none" as const }
          : { status: "found" as const, ...icon };
      } catch (error) {
        return {
          status: "failed" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  },
});
