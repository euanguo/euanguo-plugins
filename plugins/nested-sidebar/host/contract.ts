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

/** A command's success shape, or the one failure shape every host command shares. */
function statusOrFailure<Success extends z.ZodObject<{ status: z.ZodLiteral<string> }>>(
  success: Success,
) {
  return z.discriminatedUnion("status", [
    success,
    z.object({ status: z.literal("failed"), message: z.string().min(1) }).strict(),
  ]);
}

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
  /** The home directory of the machine a feature directory lives on. */
  readHomeDirectory: {
    input: z.object({}).strict(),
    output: z.object({ home: z.string().min(1) }).strict(),
  },
  /** Create a feature's folder, refusing one that would sit inside a repository. */
  ensureFeatureDirectory: {
    input: z.object({ path: z.string().min(1) }).strict(),
    output: statusOrFailure(z.object({ status: z.literal("ok") }).strict()),
  },
  /**
   * The worktrees inside each feature folder, read from their `.git` files.
   *
   * This is the only answer to "what does this feature contain": nothing about
   * members is stored, so an agent's own `git worktree add` shows up the moment
   * it lands.
   */
  scanFeatureDirectories: {
    input: z.object({ roots: z.array(z.string().min(1)).max(500) }).strict(),
    output: z
      .object({
        results: z
          .array(
            z
              .object({
                root: z.string(),
                exists: z.boolean(),
                members: z
                  .array(
                    z
                      .object({
                        directory: z.string().min(1),
                        path: z.string().min(1),
                        repository: z.string().min(1),
                        repositoryPath: z.string().min(1),
                        branch: z.string().nullable(),
                      })
                      .strict(),
                  )
                  .readonly(),
              })
              .strict(),
          )
          .readonly(),
      })
      .strict(),
  },
  /** Remove a feature folder that holds only Nest's own files. */
  removeFeatureDirectory: {
    input: z.object({ featureDirectory: z.string().min(1) }).strict(),
    output: z
      .object({
        status: z.enum(["removed", "kept"]),
        reason: z.string().nullable(),
      })
      .strict(),
  },
  /**
   * What each of a feature's worktrees still holds.
   *
   * Asked before a finish or a delete, so the confirmation can say what would be
   * lost instead of asking a person to trust that nothing would be.
   */
  inspectFeatureWorktrees: {
    input: z.object({ paths: z.array(z.string().min(1)).max(200) }).strict(),
    output: z.object({
      worktrees: z
        .array(
          z
            .object({
              path: z.string(),
              changedFiles: z.number(),
              untrackedFiles: z.number(),
              aheadCommits: z.number().nullable(),
              missing: z.boolean(),
            })
            .strict(),
        )
        .readonly(),
    }),
  },
  /**
   * What a repository records, and what is at the target, before a feature adds
   * a worktree to it. The same facts answer the plan and the write.
   */
  probeFeatureWorktree: {
    input: z
      .object({
        sourcePath: z.string().min(1),
        branch: z.string().min(1),
        targetPath: z.string().min(1),
      })
      .strict(),
    output: statusOrFailure(
      z
        .object({
          status: z.literal("ok"),
          repository: z.boolean(),
          mainWorktree: z.boolean(),
          mainRepoPath: z.string().min(1).nullable(),
          worktrees: z
            .array(
              z.object({ path: z.string().min(1), branch: z.string().nullable() }).strict(),
            )
            .readonly(),
          branchExists: z.boolean(),
          targetExists: z.boolean(),
          defaultBase: z.string().min(1),
        })
        .strict(),
    ),
  },
  /** Add one worktree of one repository into a feature folder. */
  createFeatureWorktree: {
    input: z
      .object({
        mainRepoPath: z.string().min(1),
        path: z.string().min(1),
        branch: z.string().min(1),
        newBranch: z.boolean(),
        baseRef: z.string().min(1).nullable(),
      })
      .strict(),
    output: statusOrFailure(
      z
        .object({
          status: z.literal("created"),
          path: z.string().min(1),
          branch: z.string().min(1),
          base: z.string().nullable(),
          setup: z.array(z.string()).readonly(),
        })
        .strict(),
    ),
  },
  /** Write `AGENTS.md`, `CLAUDE.md` and the manifest into a feature folder. */
  writeFeatureContext: {
    input: z
      .object({
        featureDirectory: z.string().min(1),
        id: z.string().min(1),
        name: z.string().min(1),
        slug: z.string().min(1),
        branch: z.string().min(1),
        members: z
          .array(
            z
              .object({
                directory: z.string().min(1),
                repository: z.string().min(1),
                branch: z.string().nullable(),
                path: z.string().min(1),
              })
              .strict(),
          )
          .readonly(),
      })
      .strict(),
    output: statusOrFailure(z.object({ status: z.literal("ok") }).strict()),
  },
  /**
   * Rename a branch that is checked out in a worktree.
   *
   * Only used to bring a member created by an older build onto the feature's
   * topic branch, where the old name was `feat/<feature-id>/<repo>`.
   */
  renameFeatureBranch: {
    input: z
      .object({
        repositoryPath: z.string().min(1),
        from: z.string().min(1),
        to: z.string().min(1),
      })
      .strict(),
    output: statusOrFailure(z.object({ status: z.literal("renamed") }).strict()),
  },
  /** Delete a branch a feature created. Only an explicit delete asks for this. */
  deleteFeatureBranch: {
    input: z
      .object({ mainRepoPath: z.string().min(1), branch: z.string().min(1) })
      .strict(),
    output: z
      .object({ status: z.enum(["deleted", "kept"]), reason: z.string().nullable() })
      .strict(),
  },
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
