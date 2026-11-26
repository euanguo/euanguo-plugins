import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import Database from "better-sqlite3";

import {
  inspectFeatureGitStatus,
  linkFeatureReference,
  pushRepoBranch,
  readCodeWorkspaceFile,
  readRepoDiff,
  unlinkFeatureReference,
} from "../host/feature-git.ts";
import {
  buildCrossRepoGitStatusCommand,
  buildFeatureHealthReport,
  canPushFeatureRepo,
  deliveryRepoReadiness,
  summarizeDeliveryMatrix,
} from "../lib/domain/feature-git.ts";
import { createFeatureRefLinkStore } from "../lib/stores/feature-ref-link-store.ts";
import { FEATURE_REPOSITORY_MIGRATIONS } from "../lib/stores/feature-repository.ts";
import { createFeatureStore } from "../lib/stores/feature-store.ts";
import { createFeatureGitOps } from "../server/feature/git-ops.ts";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

describe("feature multi-repo Git Cockpit host and service layer", () => {
  it("inspects status, synthesized untracked diffs, selective commit + push, and health", async () => {
    const rawTmp = await mkdtemp(join(tmpdir(), "harbor-git-cockpit-"));
    const root = await realpath(rawTmp);
    try {
      const originBare = join(root, "acme-web.git");
      const workRepo = join(root, "acme-web");
      await mkdir(originBare, { recursive: true });
      await git(originBare, "init", "--bare", "-b", "main");

      await mkdir(workRepo, { recursive: true });
      await git(workRepo, "init", "-b", "main");
      await git(workRepo, "config", "user.name", "Test Developer");
      await git(workRepo, "config", "user.email", "dev@example.com");
      await writeFile(join(workRepo, "index.ts"), "export const v = 1;\n", "utf8");
      await git(workRepo, "add", ".");
      await git(workRepo, "commit", "-m", "chore: initial commit");
      await git(workRepo, "remote", "add", "origin", originBare);
      await git(workRepo, "push", "-u", "origin", "main");

      // Create feature branch with an unpushed commit + unstaged modification + untracked file.
      await git(workRepo, "checkout", "-b", "feat/sync-engine");
      await writeFile(join(workRepo, "index.ts"), "export const v = 2;\n", "utf8");
      await git(workRepo, "add", "index.ts");
      await git(workRepo, "commit", "-m", "feat: bump version");

      await writeFile(join(workRepo, "index.ts"), "export const v = 3;\nexport const flag = true;\n", "utf8");
      await writeFile(join(workRepo, "notes.txt"), "line 1\nline 2\n", "utf8");

      const [status] = await inspectFeatureGitStatus({
        repos: [
          {
            directory: "acme-web",
            repository: "acme-web",
            role: "worktree",
            path: workRepo,
          },
        ],
        baseBranch: "main",
      });
      assert.ok(status);
      assert.equal(status.exists, true);
      assert.equal(status.branch, "feat/sync-engine");
      assert.equal(status.clean, false);
      assert.equal(status.changedFiles, 1);
      assert.equal(status.untrackedFiles, 1);
      assert.equal(status.aheadCommits, 1);
      assert.equal(status.behindCommits, 0);
      assert.ok(status.additions >= 3);
      assert.equal(status.lastCommitSubject, "feat: bump version");

      const diff = await readRepoDiff({ path: workRepo, includeUntracked: true });
      assert.equal(diff.status, "ok");
      assert.equal(diff.files.length, 2);
      const untracked = diff.files.find((entry) => entry.filePath === "notes.txt");
      assert.ok(untracked);
      assert.equal(untracked.status, "untracked");
      assert.match(untracked.patch, /\+line 1/u);

      const matrixSummary = summarizeDeliveryMatrix({
        featureId: "f_sync",
        additions: status.additions,
        deletions: status.deletions,
        dirtyRepoCount: 1,
        behindRepoCount: 0,
        unpushedRepoCount: 1,
        repos: [status],
      });
      assert.equal(matrixSummary.writableRepoCount, 1);
      assert.equal(matrixSummary.dirtyRepoCount, 1);
      assert.equal(matrixSummary.cleanAheadRepos.length, 0);
      assert.equal(matrixSummary.pushableRepos.length, 1);
      assert.equal(deliveryRepoReadiness(status), "dirty");
      assert.equal(canPushFeatureRepo(status), true);
      assert.match(buildCrossRepoGitStatusCommand([status]), /git -C .* status -sb/u);

      const health = buildFeatureHealthReport({
        featureId: "f_sync",
        featureName: "Sync Engine",
        rootPath: join(root, "feature"),
        gitSummary: {
          featureId: "f_sync",
          additions: status.additions,
          deletions: status.deletions,
          dirtyRepoCount: 1,
          behindRepoCount: 0,
          unpushedRepoCount: 1,
          repos: [status],
        },
        threadCount: 2,
        createdBranches: 1,
        deletesBranches: true,
      });
      assert.equal(health.blockedCount, 1);
      assert.equal(health.canDeleteBranches, false);
      assert.ok(health.warnings.some((warning) => warning.includes("acme-web")));

      // Commit via git directly, leaving notes.txt untracked, then test pushRepoBranch.
      await git(workRepo, "add", "index.ts");
      await git(workRepo, "commit", "-m", "feat(sync): update exported constants");

      const [afterCommit] = await inspectFeatureGitStatus({
        repos: [
          {
            directory: "acme-web",
            repository: "acme-web",
            role: "worktree",
            path: workRepo,
          },
        ],
        baseBranch: "main",
      });
      assert.ok(afterCommit);
      assert.equal(afterCommit.changedFiles, 0);
      assert.equal(afterCommit.untrackedFiles, 1);

      const pushAgain = await pushRepoBranch({ path: workRepo });
      assert.equal(pushAgain.status, "pushed");
    } finally {
      await rm(rawTmp, { recursive: true, force: true });
    }
  });

  it("manages read-only reference symlinks safely and blocks committing or pushing refs", async () => {
    const rawTmp = await mkdtemp(join(tmpdir(), "harbor-ref-cockpit-"));
    const root = await realpath(rawTmp);
    try {
      const featureDir = join(root, "feature-root");
      const refSource = join(root, "acme-sdk");
      const realSubdir = join(featureDir, "real-folder");
      await mkdir(featureDir, { recursive: true });
      await mkdir(refSource, { recursive: true });
      await mkdir(realSubdir, { recursive: true });
      await writeFile(join(refSource, "README.md"), "shared sdk\n", "utf8");

      const linked = await linkFeatureReference({
        featureDirectory: featureDir,
        directory: "acme-sdk",
        sourcePath: refSource,
      });
      assert.equal(linked.status, "ok");

      // Idempotent relink of the same target succeeds.
      const relinked = await linkFeatureReference({
        featureDirectory: featureDir,
        directory: "acme-sdk",
        sourcePath: refSource,
      });
      assert.equal(relinked.status, "ok");

      // Refuses to unlink a real directory.
      const refusedDir = await unlinkFeatureReference({
        featureDirectory: featureDir,
        directory: "real-folder",
      });
      assert.equal(refusedDir.status, "failed");
      assert.match(refusedDir.message ?? "", /real directory/u);

      // Cleanly unlinks the symlink without touching refSource.
      const unlinked = await unlinkFeatureReference({
        featureDirectory: featureDir,
        directory: "acme-sdk",
      });
      assert.equal(unlinked.status, "removed");
      const missingUnlink = await unlinkFeatureReference({
        featureDirectory: featureDir,
        directory: "acme-sdk",
      });
      assert.equal(missingUnlink.status, "missing");

      // Server-level createFeatureGitOps enforces forbidden error for role === "ref".
      const db = new Database(":memory:");
      for (const sql of FEATURE_REPOSITORY_MIGRATIONS) db.exec(sql);
      const store = createFeatureStore(db);
      const refLinks = createFeatureRefLinkStore(db);
      store.create({
        id: "f_refs",
        name: "Contract Review",
        slug: "contract-review",
        rootPath: featureDir,
        hostId: "host_a",
      });
      refLinks.add({
        featureId: "f_refs",
        directory: "acme-sdk",
        repository: "acme-sdk",
        sourcePath: refSource,
        hostId: "host_a",
      });
      const refMember = {
        featureId: "f_refs",
        directory: "acme-sdk",
        path: join(featureDir, "acme-sdk"),
        repository: "acme-sdk",
        repositoryPath: refSource,
        branch: null,
        hostId: "host_a",
        role: "ref" as const,
      };
      const gitOps = createFeatureGitOps({
        bb: { sdk: { environments: { list: async () => [] } } } as never,
        store,
        refLinks,
        call: async () => {
          throw new Error("host write should not execute for read-only ref");
        },
        getCached: () => ({
          features: store.list(),
          adoptions: {},
          members: [refMember],
          refLinks: refLinks.list(),
          homeProjects: {},
          featureProjectIds: [],
          memberScanFailures: [],
          meta: {},
        }),
        requireFeature: (id) => {
          const found = store.find(id);
          if (!found) throw new Error(id);
          return found;
        },
        membersOf: () => [refMember],
        createdBranchCount: () => 0,
        invalidate: () => {},
      });

      assert.equal("commitFeatureRepo" in gitOps, false);
      assert.equal("suggestFeatureCommitMessage" in gitOps, false);
      await assert.rejects(
        () =>
          gitOps.pushFeatureRepo({
            featureId: "f_refs",
            directory: "acme-sdk",
          }),
        /read-only reference/u,
      );
    } finally {
      await rm(rawTmp, { recursive: true, force: true });
    }
  });

  it("deduplicates a reference symlink present in both members and refLinks in getFeatureGitStatus", async () => {
    const db = new Database(":memory:");
    for (const sql of FEATURE_REPOSITORY_MIGRATIONS) db.exec(sql);
    const store = createFeatureStore(db);
    const refLinks = createFeatureRefLinkStore(db);
    store.create({
      id: "f_dedup",
      name: "Dedup Ref",
      slug: "dedup-ref",
      rootPath: "/repos/harbor-features/dedup-ref",
      hostId: "host_a",
    });
    refLinks.add({
      featureId: "f_dedup",
      directory: "acme-web",
      repository: "acme-web",
      sourcePath: "/repos/acme-web",
      hostId: "host_a",
    });
    const refMember = {
      featureId: "f_dedup",
      directory: "acme-web",
      path: "/repos/harbor-features/dedup-ref/acme-web",
      repository: "acme-web",
      repositoryPath: "/repos/acme-web",
      branch: null,
      hostId: "host_a",
      role: "ref" as const,
    };

    const inspectedPayloads: unknown[] = [];
    const gitOps = createFeatureGitOps({
      bb: { sdk: { environments: { list: async () => [] } } } as never,
      store,
      refLinks,
      call: (async (_method: string, args: { repos: { directory: string; repository: string; role: "ref"; path: string }[] }) => {
        inspectedPayloads.push(args.repos);
        return {
          repos: args.repos.map((r) => ({
            directory: r.directory,
            repository: r.repository,
            role: r.role,
            path: r.path,
            branch: "main",
            upstream: null,
            exists: true,
            stagedFiles: 0,
            unstagedFiles: 0,
            untrackedFiles: 0,
            changedFiles: 0,
            additions: 0,
            deletions: 0,
            aheadCommits: 0,
            behindCommits: 0,
            clean: true,
            lastCommitSubject: null,
            submodules: [],
          })),
        };
      }) as never,
      getCached: () => ({
        features: store.list(),
        adoptions: {},
        members: [refMember],
        refLinks: refLinks.list(),
        homeProjects: {},
        featureProjectIds: [],
        memberScanFailures: [],
        meta: {},
      }),
      requireFeature: (id) => {
        const found = store.find(id);
        if (!found) throw new Error(id);
        return found;
      },
      membersOf: () => [refMember],
      createdBranchCount: () => 0,
      invalidate: () => {},
    });

    const summary = await gitOps.getFeatureGitStatus("f_dedup");
    assert.equal(inspectedPayloads.length, 1);
    assert.equal(summary.repos.length, 1);
    assert.equal(summary.repos[0]?.directory, "acme-web");
    assert.equal(summary.repos[0]?.role, "ref");
  });

  it("blocks health clean & branch delete when host scan throws and marks repo unverified", async () => {
    const db = new Database(":memory:");
    for (const sql of FEATURE_REPOSITORY_MIGRATIONS) db.exec(sql);
    const store = createFeatureStore(db);
    const refLinks = createFeatureRefLinkStore(db);
    store.create({
      id: "f_fail",
      name: "Host Fail",
      slug: "host-fail",
      rootPath: "/repos/harbor-features/host-fail",
      hostId: "host_a",
    });
    store.recordBranch({ repositoryPath: "/repos/acme-web", hostId: "host_a", branch: "feat/host-fail", featureId: "f_fail" });
    const member = {
      featureId: "f_fail",
      directory: "acme-web",
      path: "/repos/harbor-features/host-fail/acme-web",
      repository: "acme-web",
      repositoryPath: "/repos/acme-web",
      branch: "feat/host-fail",
      hostId: "host_a",
      role: "worktree" as const,
    };
    const gitOps = createFeatureGitOps({
      bb: { sdk: { environments: { list: async () => [] } } } as never,
      store,
      refLinks,
      call: async () => {
        throw new Error("host timeout");
      },
      getCached: () => ({
        features: store.list(),
        adoptions: {},
        members: [member],
        refLinks: [],
        homeProjects: {},
        featureProjectIds: [],
        memberScanFailures: [],
        meta: {},
      }),
      requireFeature: (id) => {
        const found = store.find(id);
        if (!found) throw new Error(id);
        return found;
      },
      membersOf: () => [member],
      createdBranchCount: () => 1,
      invalidate: () => {},
    });
    const health = await gitOps.inspectFeatureHealth({
      featureId: "f_fail",
      deletesBranches: true,
    });
    assert.equal(health.blockedCount, 1);
    assert.equal(health.canDeleteBranches, false);
    assert.match(health.repos[0]?.blockerReason ?? "", /host timeout/u);
    db.close();
  });

  it("enforces .code-workspace extension, rejects symlinks, and sanitizes errors", async () => {
    const nonWorkspace = await readCodeWorkspaceFile({ path: "/tmp/secret-notes.txt" });
    assert.equal(nonWorkspace.status, "failed");
    assert.match(nonWorkspace.message, /\.code-workspace/u);

    const missingWorkspace = await readCodeWorkspaceFile({
      path: "/tmp/does-not-exist-harbor-test.code-workspace",
    });
    assert.equal(missingWorkspace.status, "failed");
    assert.equal(missingWorkspace.message, "Workspace file does not exist.");

    const rawTmp = await mkdtemp(join(tmpdir(), "harbor-ws-sym-"));
    try {
      const targetFile = join(rawTmp, "secret.json");
      const linkFile = join(rawTmp, "alias.code-workspace");
      await writeFile(targetFile, "{}", "utf8");
      const { symlink } = await import("node:fs/promises");
      await symlink(targetFile, linkFile);
      const symRes = await readCodeWorkspaceFile({ path: linkFile });
      assert.equal(symRes.status, "failed");
      assert.match(symRes.message, /Not a regular/u);
    } finally {
      await rm(rawTmp, { recursive: true, force: true });
    }
  });
});
