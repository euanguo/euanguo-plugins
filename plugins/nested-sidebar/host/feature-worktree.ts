import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname } from "node:path";

/**
 * The home directory of the machine a feature directory would live on.
 *
 * Asked of the host rather than assumed on the server: the server may run on a
 * different machine from the worktrees, and a home directory guessed from the
 * wrong one produces a path that exists nowhere.
 */
export function readHomeDirectory(): string {
  return homedir();
}

/**
 * The worktree operations a feature needs on the machine that owns the files.
 *
 * Every answer is a status rather than a throw. A branch that is already
 * checked out, a target directory left behind by an interrupted run, and a
 * source that is not a repository are all ordinary outcomes a person can act
 * on, and the server has a message for each.
 */

export type WorktreeProbeResult =
  | {
      readonly status: "ok";
      readonly repository: boolean;
      readonly mainWorktree: boolean;
      readonly mainRepoPath: string | null;
      readonly worktrees: readonly {
        readonly path: string;
        readonly branch: string | null;
      }[];
    }
  | { readonly status: "failed"; readonly message: string };

export type WorktreeCreateResult =
  | { readonly status: "created"; readonly path: string; readonly branch: string }
  | { readonly status: "failed"; readonly message: string };

interface GitRun {
  readonly exitCode: number | null;
  readonly spawnErrorCode: string | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runGit(args: readonly string[], cwd: string): Promise<GitRun> {
  return new Promise((resolve) => {
    const child = spawn("git", [...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      resolve({
        exitCode: null,
        spawnErrorCode: error.code ?? "UNKNOWN",
        stdout,
        stderr,
      });
    });
    child.on("close", (code) => {
      resolve({ exitCode: code, spawnErrorCode: null, stdout, stderr });
    });
  });
}

/**
 * What the repository records, before anything is created.
 *
 * `git worktree list --porcelain` is the single source of truth for which
 * branch is checked out where. Reading it first is what makes a refusal
 * specific instead of git's own wording arriving after a half-created state.
 */
export async function probeWorktree(input: {
  readonly sourcePath: string;
}): Promise<WorktreeProbeResult> {
  const { sourcePath } = input;
  const inside = await runGit(
    ["rev-parse", "--is-inside-work-tree"],
    sourcePath,
  );
  if (inside.spawnErrorCode === "ENOENT") {
    return { status: "failed", message: "这台机器上没有 git。" };
  }
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    return {
      status: "failed",
      message: inside.stderr.trim() || "源目录不是 git 仓库。",
    };
  }

  const [commonDir, list] = await Promise.all([
    runGit(["rev-parse", "--git-common-dir"], sourcePath),
    runGit(["worktree", "list", "--porcelain"], sourcePath),
  ]);
  if (list.exitCode !== 0) {
    return {
      status: "failed",
      message: list.stderr.trim() || "无法读取 worktree 列表。",
    };
  }

  const worktrees = parseWorktreeList(list.stdout);
  const mainRepoPath =
    commonDir.exitCode === 0
      ? resolveMainRepo(sourcePath, commonDir.stdout.trim())
      : null;
  /**
   * The first entry `git worktree list` prints is the main working tree, which
   * is also the only one a new worktree may be added from without nesting.
   *
   * Asked against the path git was pointed at, not against the main checkout:
   * this function is also called for a linked worktree, where "is this the main
   * one" is the useful answer and the caller already knows that git accepted
   * the path.
   */
  const mainWorktree = samePath(sourcePath, worktrees[0]?.path ?? "");
  return {
    status: "ok",
    repository: true,
    mainWorktree,
    mainRepoPath,
    worktrees,
  };
}

/**
 * Create the worktree, then confirm it landed where the plan said.
 *
 * `git worktree add` creates the directory itself. The parent feature
 * directory is created first, because git will not create a missing parent, and
 * the parent is deliberately never `git init`-ed.
 */
export async function createWorktree(input: {
  readonly mainRepoPath: string;
  readonly path: string;
  readonly branch: string;
  readonly baseRef: string | null;
}): Promise<WorktreeCreateResult> {
  const { mainRepoPath, path, branch, baseRef } = input;
  if (existsSync(path)) {
    return { status: "failed", message: `目录已存在：${path}。` };
  }
  try {
    await mkdir(dirname(path), { recursive: true });
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  /**
   * `-b` only when the branch does not exist. Passing `-b` for an existing
   * branch fails, and the plan has already established that no worktree holds
   * it, so an existing branch is checked out directly.
   */
  const branchExists = await branchIsKnown(mainRepoPath, branch);
  const args = branchExists
    ? ["worktree", "add", "--", path, branch]
    : [
        "worktree",
        "add",
        "-b",
        branch,
        "--",
        path,
        baseRef ?? "HEAD",
      ];
  const created = await runGit(args, mainRepoPath);
  if (created.exitCode !== 0) {
    return {
      status: "failed",
      message: created.stderr.trim() || `git 退出码 ${created.exitCode ?? "未知"}`,
    };
  }
  return { status: "created", path, branch };
}

/**
 * Write the feature's own context file.
 *
 * The directory is not a repository, so this file is the only durable record
 * that a person or an agent can read without asking the plugin. It is written
 * after the first member lands, because an empty directory with only this file
 * is a feature that has nothing to say yet.
 */
export async function writeFeatureContext(input: {
  readonly featureDirectory: string;
  readonly featureName: string;
  readonly featureId: string;
  readonly members: readonly {
    readonly repository: string;
    readonly directory: string;
    readonly branch: string;
  }[];
}): Promise<{ status: "ok" } | { status: "failed"; message: string }> {
  const { featureDirectory, featureName, featureId, members } = input;
  const manifest = {
    featureId,
    name: featureName,
    layoutVersion: 1,
    members: members.map((member) => ({
      repository: member.repository,
      directory: member.directory,
      branch: member.branch,
    })),
  };
  try {
    await mkdir(featureDirectory, { recursive: true });
    await writeFile(
      `${featureDirectory}/.nest-feature.json`,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      `${featureDirectory}/NEST.md`,
      renderContext({ featureName, featureId, members }),
      "utf8",
    );
    return { status: "ok" };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The file an agent reads first when it starts inside a feature directory. */
function renderContext(input: {
  readonly featureName: string;
  readonly featureId: string;
  readonly members: readonly {
    readonly repository: string;
    readonly directory: string;
    readonly branch: string;
  }[];
}): string {
  const { featureName, featureId, members } = input;
  const rows = members
    .map(
      (member) =>
        `| ${member.directory} | ${member.repository} | ${member.branch} |`,
    )
    .join("\n");
  return `# ${featureName}

This directory is one piece of work spread across several repositories.
It is not a git repository. Each subdirectory is a git worktree of its own
repository, on its own branch.

| Directory | Repository | Branch |
| --- | --- | --- |
${rows}

Feature id: \`${featureId}\`

## Working here

Name the subdirectory in every git command. A \`git status\` run here finds no
repository, and a \`git add -A\` would either fail or reach a repository you did
not mean to touch.

\`\`\`sh
git -C <directory> status --short
\`\`\`

Do not create a repository in this directory. If it became one, each subdirectory
would be recorded as an embedded repository with no contents.

Read \`.nest-feature.json\` for the machine-readable member list.
`;
}

function parseWorktreeList(stdout: string): {
  path: string;
  branch: string | null;
}[] {
  const worktrees: { path: string; branch: string | null }[] = [];
  for (const block of stdout.split(/\n\n+/u)) {
    let path: string | null = null;
    let branch: string | null = null;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch refs/heads/")) {
        branch = line.slice("branch refs/heads/".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length);
      }
    }
    if (path !== null) worktrees.push({ path, branch });
  }
  return worktrees;
}

/**
 * `--git-common-dir` answers relative to the repository, not to the caller.
 *
 * A linked worktree answers `../.git`, so the value has to be joined against
 * the path git was asked about before it names anything real.
 */
function resolveMainRepo(sourcePath: string, commonDir: string): string | null {
  if (commonDir.length === 0) return null;
  if (commonDir.startsWith("/")) return dirname(commonDir);
  const absolute = `${sourcePath.replace(/\/+$/u, "")}/${commonDir}`;
  return dirname(absolute);
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalize(left) === normalize(right);
}

async function branchIsKnown(repo: string, branch: string): Promise<boolean> {
  const result = await runGit(
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    repo,
  );
  return result.exitCode === 0;
}

export async function readFeatureManifest(
  featureDirectory: string,
): Promise<string | null> {
  try {
    return await readFile(`${featureDirectory}/.nest-feature.json`, "utf8");
  } catch {
    return null;
  }
}

/**
 * Take back a feature directory that no longer holds anything but its own
 * context files.
 *
 * Refused when anything else is inside: a directory with a file a person put
 * there is theirs, and the plugin only removes what it wrote itself.
 */
export async function removeFeatureDirectory(
  featureDirectory: string,
): Promise<{ status: "removed" | "kept"; reason: string | null }> {
  let entries: string[];
  try {
    entries = await readdir(featureDirectory);
  } catch {
    return { status: "kept", reason: "目录不存在。" };
  }
  const own = new Set([".nest-feature.json", "NEST.md"]);
  const foreign = entries.filter((entry) => !own.has(entry));
  if (foreign.length > 0) {
    return {
      status: "kept",
      reason: `目录里还有 ${foreign.length} 项不属于功能上下文。`,
    };
  }
  try {
    for (const entry of entries) {
      await unlink(`${featureDirectory}/${entry}`);
    }
    await rmdir(featureDirectory);
    return { status: "removed", reason: null };
  } catch (error) {
    return {
      status: "kept",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export { basename };
