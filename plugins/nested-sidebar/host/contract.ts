import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { PROJECT_ICON_SOURCES } from "../lib/project-icons.ts";

/**
 * How many directories one probe may be asked about.
 *
 * The caller batches a whole sidebar's worth of paths into one call, and the
 * number is the same cap its environment read uses: beyond it the answer would
 * be a partial one the caller could not tell from a complete one.
 */
export const MAX_FACTS_PATHS = 500;

const worktreeFactSchema = z
  .object({
    path: z.string().min(1),
    branch: z.string().nullable(),
    head: z.string().nullable(),
    detached: z.boolean(),
    prunable: z.boolean(),
  })
  .strict();

const workspaceFactSchema = z
  .object({
    path: z.string().min(1),
    realPath: z.string().min(1).nullable(),
    isDirectory: z.boolean(),
    isMainWorktree: z.boolean(),
    isLinkedWorktree: z.boolean(),
    isNestedRepository: z.boolean(),
    repositoryRoot: z.string().min(1).nullable(),
    commonDir: z.string().min(1).nullable(),
    remoteUrl: z.string().min(1).nullable(),
    worktrees: z.array(worktreeFactSchema).readonly(),
  })
  .strict();

/**
 * The three things this plugin needs a machine for.
 *
 * Removing a worktree's directory is not just deleting files: git keeps the
 * worktree's own record in the main repository, and a plain delete leaves that
 * record behind for `git worktree list` to trip over. So the removal runs where
 * the directory lives, through git when git is there.
 *
 * Reading a project's icon is the other, and it is here for a blunter reason:
 * the checkout's bytes are on that machine, and the plugin server cannot open a
 * file at all. A method that cannot open one is a method that cannot answer.
 *
 * Reading what each workspace *is* — where it really lives, which repository it
 * belongs to, which worktrees that repository records — is the third, and the
 * only one whose answer the sidebar cannot compute from bb's data at all. bb
 * knows the environments someone made; it does not know a worktree another tool
 * made. Only the repository does, and the repository is on that machine.
 *
 * All three travel in one contract because bb gives a plugin exactly one host
 * entry, and all are shape-only: the reasons to refuse an answer are decisions,
 * and decisions live on the server with the rest of them.
 */
export const worktreeDirectoryContract = defineRpcContract({
  removeWorktree: {
    input: z
      .object({
        path: z.string().min(1),
        mainRepoPath: z.string().min(1),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("removed") }).strict(),
      /**
       * git will not take this one — the directory is not a worktree of that
       * repository, or git is not installed — so the caller has to delete it
       * plainly and say what it could not clean up.
       */
      z
        .object({ status: z.literal("fallback"), reason: z.string().min(1) })
        .strict(),
      z
        .object({ status: z.literal("failed"), message: z.string().min(1) })
        .strict(),
    ]),
  },
  /**
   * Probe a project's checkout for an icon it already ships.
   *
   * `none` is an answer, not a failure: most checkouts have no icon, and the
   * server stores it so the next sidebar mount does not ask again.
   */
  detectProjectIcon: {
    input: z.object({ path: z.string().min(1) }).strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("found"),
          src: z.string().min(1),
          label: z.string(),
          source: z.enum(PROJECT_ICON_SOURCES),
        })
        .strict(),
      z.object({ status: z.literal("none") }).strict(),
      z
        .object({ status: z.literal("failed"), message: z.string().min(1) })
        .strict(),
    ]),
  },
  /**
   * Where a set of directories really are, and which repository each is in.
   *
   * One call per machine per sidebar load, deduplicated and bounded. The answer
   * is per requested path and in the order asked, because the caller matches it
   * back by path: a directory that could not be read answers with
   * `realPath: null` rather than by being left out, so a short answer is never
   * mistaken for a complete one.
   */
  resolveWorkspaceFacts: {
    input: z
      .object({ paths: z.array(z.string().min(1)).max(MAX_FACTS_PATHS) })
      .strict(),
    output: z.object({ facts: z.array(workspaceFactSchema).readonly() }).strict(),
  },
});
