import type { InfoCardRow } from "@/components/ui/hover-card";
import type { FeatureMember } from "@/lib/domain/features";
import { pullRequestPresentation } from "@/lib/domain/pull-request-presentation";
import type { PullRequestState, WorkspacePullRequest } from "@/lib/domain/pull-request";
import { relativeTimeLabel } from "@/lib/domain/relative-time";
import { formatLineCount, workspaceKindLabel } from "@/lib/domain/workspace";
import type { Workspace } from "@/lib/domain/workspace-index";
import { formatHomePathForDisplay } from "@/lib/ui/utils";
import {
  changeCountFor,
  type WorkspaceChangeCount,
} from "@/lib/ui/workspace-change-counts";

export interface HoverPreviewModel {
  readonly label: string;
  readonly subtitle?: string;
  readonly summary?: string;
  readonly rows: InfoCardRow[];
}

const MAX_FEATURE_PREVIEW_REPOS = 6;

/**
 * Concise, read-only hover preview for a workspace or worktree row.
 *
 * Keeps raw IDs and copy buttons inside `Copy ▸` and `Inspect details…`.
 */
export function buildWorkspaceHoverPreview({
  title,
  ref,
  projectName,
  path,
  changes,
  pullRequest,
  threadCount,
  latestThreadUpdatedAt,
  now,
}: {
  title: string;
  ref: Workspace;
  projectName: string;
  path: string | null;
  changes: WorkspaceChangeCount | null;
  pullRequest: WorkspacePullRequest | null;
  threadCount: number;
  latestThreadUpdatedAt: number | null;
  now: number;
}): HoverPreviewModel {
  const rows: InfoCardRow[] = [];
  if (ref.branch !== null && ref.branch !== title) {
    rows.push({ label: "Branch", value: ref.branch, mono: true });
  }
  if (changes !== null && (changes.insertions > 0 || changes.deletions > 0)) {
    const parts: string[] = [];
    if (changes.insertions > 0) parts.push(`+${formatLineCount(changes.insertions)}`);
    if (changes.deletions > 0) parts.push(`-${formatLineCount(changes.deletions)}`);
    rows.push({ label: "Changes", value: parts.join(" "), mono: true });
  }
  if (pullRequest !== null) {
    const pr = pullRequestPresentation(pullRequest);
    rows.push({
      label: "PR",
      value: `#${pullRequest.number} · ${pr.label}`,
    });
  }
  const latestAt = maxTimestamp(latestThreadUpdatedAt, ref.lastActiveAt ?? null);
  if (latestAt !== null) {
    rows.push({
      label: "Active",
      value: `${relativeTimeLabel(latestAt, now)} ago`,
    });
  }
  if (ref.dangling) {
    rows.push({ label: "Status", value: "Missing on disk" });
  } else if (ref.diagnostic !== null) {
    rows.push({ label: "Note", value: ref.diagnostic });
  }
  if (path !== null) {
    rows.push({
      label: "Path",
      value: formatHomePathForDisplay(path),
      mono: true,
    });
  }

  const threadText = `${threadCount} ${threadCount === 1 ? "thread" : "threads"}`;
  return {
    label: title,
    subtitle: `${projectName} · ${workspaceKindLabel(ref.kind)}`,
    summary: threadText,
    rows,
  };
}

/** Concise hover preview for a project row. */
export function buildProjectHoverPreview({
  projectName,
  isPersonal,
  remoteUrl,
  hostName,
  projectPath,
  workspaceCount,
  inactiveCount,
  threadCount,
  latestUpdatedAt,
  now,
}: {
  projectName: string;
  isPersonal: boolean;
  remoteUrl: string | null;
  hostName: string | null;
  projectPath: string | null;
  workspaceCount: number;
  inactiveCount: number;
  threadCount: number;
  latestUpdatedAt: number | null;
  now: number;
}): HoverPreviewModel {
  const rows: InfoCardRow[] = [];
  if (remoteUrl !== null) {
    rows.push({ label: "Remote", value: remoteUrl, mono: true });
  } else if (hostName !== null) {
    rows.push({ label: "Host", value: hostName });
  }
  const activeWs = `${workspaceCount} active`;
  const wsSummary =
    inactiveCount > 0 ? `${activeWs}, ${inactiveCount} inactive` : activeWs;
  rows.push({ label: "Workspaces", value: wsSummary });
  if (latestUpdatedAt !== null) {
    rows.push({
      label: "Active",
      value: `${relativeTimeLabel(latestUpdatedAt, now)} ago`,
    });
  }
  if (projectPath !== null) {
    rows.push({
      label: "Path",
      value: formatHomePathForDisplay(projectPath),
      mono: true,
    });
  }
  return {
    label: projectName,
    subtitle: isPersonal ? "Personal" : "Project",
    summary: `${threadCount} ${threadCount === 1 ? "thread" : "threads"}`,
    rows,
  };
}

/** Concise hover preview for a Feature row showing a compact cross-repo micro-list. */
export function buildFeatureHoverPreview({
  name,
  state,
  members,
  workspaces,
  threadCount,
  workspaceChanges,
  rootPath,
}: {
  name: string;
  state: "active" | "parked" | "archived";
  members: readonly FeatureMember[];
  workspaces: readonly {
    readonly ref: {
      readonly path: string | null;
      readonly environmentIds: readonly string[];
    };
  }[];
  threadCount: number;
  workspaceChanges: ReadonlyMap<string, WorkspaceChangeCount>;
  rootPath: string | null;
}): HoverPreviewModel {
  const envIdsByPath = new Map(
    workspaces
      .filter((workspace) => workspace.ref.path !== null)
      .map((workspace) => [workspace.ref.path, workspace.ref.environmentIds] as const),
  );
  const rows: InfoCardRow[] = [];
  const shownMembers = members.slice(0, MAX_FEATURE_PREVIEW_REPOS);
  for (const member of shownMembers) {
    const branchLabel =
      member.role === "ref" ? "ref" : (member.branch ?? "detached");
    const envIds = envIdsByPath.get(member.path) ?? [];
    const change = changeCountFor(workspaceChanges, envIds);
    const dirtyTag =
      change !== null && (change.insertions > 0 || change.deletions > 0)
        ? ` (+${formatLineCount(change.insertions)} -${formatLineCount(change.deletions)})`
        : "";
    rows.push({
      label: member.directory,
      value: `${branchLabel}${dirtyTag}`,
      mono: true,
    });
  }
  if (members.length > MAX_FEATURE_PREVIEW_REPOS) {
    rows.push({
      label: "More",
      value: `+${members.length - MAX_FEATURE_PREVIEW_REPOS} repositories`,
    });
  }
  if (rootPath !== null) {
    rows.push({
      label: "Folder",
      value: formatHomePathForDisplay(rootPath),
      mono: true,
    });
  }
  return {
    label: name,
    subtitle:
      state === "active"
        ? "Feature"
        : state === "parked"
          ? "Parked feature"
          : "Finished feature",
    summary: `${members.length} ${members.length === 1 ? "repo" : "repos"} · ${threadCount} ${threadCount === 1 ? "thread" : "threads"}`,
    rows,
  };
}

export function isOpenPullRequest(state: PullRequestState): boolean {
  return state === "open" || state === "draft";
}

function maxTimestamp(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}
