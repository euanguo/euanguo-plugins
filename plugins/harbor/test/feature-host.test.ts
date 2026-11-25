import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  createWorktree,
  ensureFeatureDirectory,
  inspectWorktrees,
  probeWorktree,
  scanFeatureDirectories,
  writeFeatureContext,
} from "../host/feature-worktree.ts";

/**
 * The host commands against real git, in a scratch directory.
 *
 * These are the facts the whole feature model rests on — that a member is
 * found from its `.git` file, that a plain leftover folder is seen by the plan,
 * that a topic branch does not track main — so they are checked against git
 * itself rather than against a fake of it.
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).trim();
}

async function scratch() {
  const root = await mkdtemp(join(tmpdir(), "harbor-host-"));
  const repo = join(root, "code", "acme-web");
  await mkdir(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  await writeFile(join(repo, "README.md"), "hi\n");
  await writeFile(join(repo, ".env.local"), "SECRET=1\n");
  await writeFile(join(repo, ".gitignore"), ".env.local\n");
  git(repo, "add", "README.md", ".gitignore");
  git(repo, "commit", "-q", "-m", "init");
  const feature = join(root, "HarborFeatures", "ai-voice");
  return { root, repo, feature };
}

describe("feature host commands, against real git", () => {
  it("creates a feature folder, and refuses one inside a repository", async () => {
    const { repo, feature } = await scratch();
    assert.deepEqual(await ensureFeatureDirectory({ path: feature }), { status: "ok" });
    const inside = await ensureFeatureDirectory({ path: join(repo, "nested") });
    assert.equal(inside.status, "failed");
  });

  it("plans, creates and then finds a member worktree", async () => {
    const { repo, feature } = await scratch();
    await ensureFeatureDirectory({ path: feature });
    const target = join(feature, "acme-web");
    const probe = await probeWorktree({ sourcePath: repo, branch: "feat/ai-voice", targetPath: target });
    assert.equal(probe.status, "ok");
    if (probe.status !== "ok") return;
    assert.equal(probe.mainWorktree, true);
    assert.equal(probe.branchExists, false);
    assert.equal(probe.targetExists, false);
    assert.ok(probe.mainRepoPath?.endsWith("acme-web"));

    const created = await createWorktree({
      mainRepoPath: probe.mainRepoPath ?? repo,
      path: target,
      branch: "feat/ai-voice",
      newBranch: true,
      baseRef: null,
    });
    assert.equal(created.status, "created");
    if (created.status !== "created") return;
    assert.deepEqual(created.setup, ["Copied .env.local from the main checkout."]);
    assert.equal(await readFile(join(target, ".env.local"), "utf8"), "SECRET=1\n");
    // --no-track: the topic branch does not count main's commits as its own.
    assert.throws(() => git(target, "config", "--get", "branch.feat/ai-voice.merge"));

    const [scan] = await scanFeatureDirectories({ roots: [feature] });
    assert.equal(scan?.exists, true);
    assert.deepEqual(
      scan?.members.map((member) => [member.directory, member.repository, member.branch]),
      [["acme-web", "acme-web", "feat/ai-voice"]],
    );
  });

  it("sees a worktree made by hand, and ignores plain folders", async () => {
    const { repo, feature } = await scratch();
    await ensureFeatureDirectory({ path: feature });
    git(repo, "worktree", "add", "-q", "-b", "by-hand", join(feature, "manual"));
    await mkdir(join(feature, "notes"));
    const [scan] = await scanFeatureDirectories({ roots: [feature] });
    assert.deepEqual(scan?.members.map((member) => member.directory), ["manual"]);
    assert.equal(scan?.members[0]?.branch, "by-hand");
  });

  it("reports a leftover plain folder to the plan", async () => {
    const { repo, feature } = await scratch();
    await mkdir(join(feature, "acme-web"), { recursive: true });
    const probe = await probeWorktree({
      sourcePath: repo,
      branch: "feat/x",
      targetPath: join(feature, "acme-web"),
    });
    assert.equal(probe.status === "ok" && probe.targetExists, true);
  });

  it("counts commits on no remote as unpushed even without an upstream", async () => {
    const { repo, feature } = await scratch();
    const target = join(feature, "acme-web");
    git(repo, "worktree", "add", "-q", "-b", "feat/y", target);
    await writeFile(join(target, "a.txt"), "a\n");
    git(target, "add", "a.txt");
    git(target, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "a");
    await writeFile(join(target, "b.txt"), "b\n");
    const [state] = await inspectWorktrees({ paths: [target] });
    assert.equal(state?.untrackedFiles, 1);
    assert.ok((state?.aheadCommits ?? 0) >= 1);
  });

  it("writes AGENTS.md and CLAUDE.md and preserves the person's notes", async () => {
    const { feature } = await scratch();
    await mkdir(feature, { recursive: true });
    const write = (members: { directory: string; repository: string; branch: string | null; path: string }[]) =>
      writeFeatureContext({
        featureDirectory: feature,
        id: "f_1",
        name: "AI 助手",
        slug: "ai-voice",
        suggestedBranch: "feat/ai-voice",
        members,
      });
    assert.deepEqual(await write([]), { status: "ok" });
    const agents = await readFile(join(feature, "AGENTS.md"), "utf8");
    await writeFile(join(feature, "AGENTS.md"), `${agents}\n- decided: ship behind a flag\n`);
    await write([{ directory: "acme-web", repository: "acme-web", branch: "feat/ai-voice", path: join(feature, "acme-web") }]);
    const after = await readFile(join(feature, "AGENTS.md"), "utf8");
    assert.match(after, /decided: ship behind a flag/u);
    assert.match(after, /`acme-web\/`/u);
    assert.equal(await readFile(join(feature, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
    const manifest = JSON.parse(await readFile(join(feature, ".harbor-feature.json"), "utf8")) as {
      featureId: string;
    };
    assert.equal(manifest.featureId, "f_1");
  });
});
