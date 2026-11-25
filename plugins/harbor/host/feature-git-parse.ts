/**
 * Pure git status/numstat/diff parsing helpers for Harbor's host git module.
 */
import type { DiffFileStatus } from "../lib/domain/feature-git.ts";

export const MAX_PATCH_BYTES = 128 * 1024;

export function parseBranchHeader(line: string): {
  branch: string | null;
  upstream: string | null;
} {
  if (!line.startsWith("## ")) return { branch: null, upstream: null };
  const body = line.slice(3).trim();
  if (body.startsWith("No commits yet on ")) {
    return {
      branch: body.slice("No commits yet on ".length).trim() || null,
      upstream: null,
    };
  }
  if (body.startsWith("HEAD (no branch)")) {
    return { branch: null, upstream: null };
  }
  const dotsIndex = body.indexOf("...");
  if (dotsIndex === -1) {
    return { branch: body.split(" ")[0] ?? null, upstream: null };
  }
  const branch = body.slice(0, dotsIndex).trim() || null;
  const tail = body.slice(dotsIndex + 3);
  const spaceIdx = tail.indexOf(" ");
  const upstream = (spaceIdx === -1 ? tail : tail.slice(0, spaceIdx)).trim() || null;
  return { branch, upstream };
}

export function parsePorcelainStatus(stdout: string): {
  branch: string | null;
  upstream: string | null;
  stagedFiles: number;
  unstagedFiles: number;
  untrackedFiles: number;
  changedFiles: number;
  untrackedPaths: string[];
} {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.length > 0);
  let branch: string | null = null;
  let upstream: string | null = null;
  let stagedFiles = 0;
  let unstagedFiles = 0;
  let untrackedFiles = 0;
  let changedFiles = 0;
  const untrackedPaths: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      const parsed = parseBranchHeader(line);
      branch = parsed.branch;
      upstream = parsed.upstream;
      continue;
    }
    if (line.startsWith("?? ")) {
      untrackedFiles += 1;
      untrackedPaths.push(line.slice(3));
      continue;
    }
    if (line.length < 3) continue;
    changedFiles += 1;
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    if (x !== " " && x !== "?") stagedFiles += 1;
    if (y !== " " && y !== "?") unstagedFiles += 1;
  }

  return {
    branch,
    upstream,
    stagedFiles,
    unstagedFiles,
    untrackedFiles,
    changedFiles,
    untrackedPaths,
  };
}

export function parseNumstat(stdout: string): {
  additions: number;
  deletions: number;
  byPath: Map<string, { additions: number; deletions: number }>;
} {
  let additions = 0;
  let deletions = 0;
  const byPath = new Map<string, { additions: number; deletions: number }>();
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const rawAdd = parts[0];
    const rawDel = parts[1];
    const filePath = parts.slice(2).join("\t");
    const add = rawAdd === "-" ? 0 : Number.parseInt(rawAdd ?? "0", 10) || 0;
    const del = rawDel === "-" ? 0 : Number.parseInt(rawDel ?? "0", 10) || 0;
    additions += add;
    deletions += del;
    byPath.set(filePath, { additions: add, deletions: del });
  }
  return { additions, deletions, byPath };
}

export function statusFromPorcelainXY(x: string, y: string): DiffFileStatus {
  if (x === "?" && y === "?") return "untracked";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  if (x === "R" || y === "R") return "renamed";
  return "modified";
}

export function unquoteGitPath(raw: string): string {
  const arrowIndex = raw.indexOf(" -> ");
  const target = arrowIndex === -1 ? raw : raw.slice(arrowIndex + 4);
  if (target.startsWith('"') && target.endsWith('"')) {
    return target.slice(1, -1).replace(/\\(["\\])/gu, "$1");
  }
  return target;
}

export function clampPatch(raw: string): { patch: string; truncated: boolean } {
  if (Buffer.byteLength(raw, "utf8") <= MAX_PATCH_BYTES) {
    return { patch: raw, truncated: false };
  }
  const sliced = Buffer.from(raw, "utf8")
    .subarray(0, MAX_PATCH_BYTES)
    .toString("utf8");
  const lastNewline = sliced.lastIndexOf("\n");
  return {
    patch: lastNewline > 0 ? sliced.slice(0, lastNewline) : sliced,
    truncated: true,
  };
}
