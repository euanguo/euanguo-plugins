/**
 * What the workspaces view decides about a workspace row.
 *
 * In this mode the sidebar stops at the workspace and the header carries the
 * conversations, so a row has to answer, from the threads under it, the
 * questions a thread row answered by being itself: which conversation a click
 * opens, whether the row is a pin, and what a project draws below its
 * workspaces. Each answer is a pure function here, so the rows only draw.
 */

import type { ThreadFamily } from "./inbox.ts";
import { orderFamilies } from "./ordering.ts";
import type { PinnedFamily } from "./pinned.ts";
import { rollupThreads, type StatusRollup } from "./rollup.ts";
import type { ProjectNode, WorkspaceNode } from "./tree.ts";
import {
  NO_WORKSPACE_KEY,
  type Workspace,
  type WorkspaceIndex,
} from "./workspace-index.ts";

export type WorkspaceOpenTarget =
  | { readonly kind: "thread"; readonly threadId: string }
  | { readonly kind: "new-chat" };

/**
 * The conversation a click on a workspace row opens.
 *
 * Something that needs the user wins, because that is the reason to look. Then
 * the conversation the user last had open here, while it is still here; then
 * the oldest one, which is where a workspace's work usually started. A
 * workspace with nothing in it opens a new conversation bound to it.
 */
export function workspaceOpenTarget(input: {
  readonly rollup: StatusRollup;
  readonly families: readonly ThreadFamily[];
  readonly lastActiveThreadId: string | null;
}): WorkspaceOpenTarget {
  const { rollup, families, lastActiveThreadId } = input;
  if ((rollup.kind === "failed" || rollup.kind === "needs-you") && rollup.leadThreadId !== null) {
    return { kind: "thread", threadId: rollup.leadThreadId };
  }
  const stillHere =
    lastActiveThreadId !== null &&
    families.some(
      (family) =>
        family.root.id === lastActiveThreadId ||
        family.children.some((child) => child.id === lastActiveThreadId),
    );
  if (stillHere && lastActiveThreadId !== null) {
    return { kind: "thread", threadId: lastActiveThreadId };
  }
  const earliest = families
    .map((family) => family.root)
    .reduce<ThreadFamily["root"] | null>(
      (first, root) =>
        first === null ||
        root.createdAt < first.createdAt ||
        (root.createdAt === first.createdAt && root.id < first.id)
          ? root
          : first,
      null,
    );
  return earliest === null ? { kind: "new-chat" } : { kind: "thread", threadId: earliest.id };
}

/**
 * A project's rows in the workspaces view.
 *
 * One row per workspace, checkout first, in the order the tree already worked
 * out. A conversation with no workspace — the personal project's, mostly — has
 * no row to stand behind, so it is drawn as a compact row of its own, newest
 * activity first, since there is no workspace order to keep.
 */
export interface ProjectWorkspaceRows {
  readonly workspaces: readonly WorkspaceNode[];
  readonly loose: readonly ThreadFamily[];
}

export function projectWorkspaceRows(node: ProjectNode, now: number): ProjectWorkspaceRows {
  const loose = node.workspaces.find((workspace) => workspace.ref.key === NO_WORKSPACE_KEY);
  return {
    workspaces: node.workspaces.filter((workspace) => workspace.ref.key !== NO_WORKSPACE_KEY),
    loose: orderFamilies(loose?.families ?? [], {
      manual: undefined,
      mode: "updated-desc",
      now,
    }),
  };
}

/** A workspace drawn in Pinned, with the project its menu acts on. */
export interface PinnedWorkspaceNode extends WorkspaceNode {
  readonly ref: Workspace;
  readonly projectId: string;
  readonly projectName: string;
  /** The pinned conversations that put it here, for the pin order. */
  readonly pinnedRootIds: readonly string[];
}

export interface PinnedWorkspaces {
  readonly workspaces: readonly PinnedWorkspaceNode[];
  /** Pinned conversations with no workspace, drawn as compact rows. */
  readonly loose: readonly PinnedFamily[];
}

/** The workspaces that hold a pinned conversation, each once. */
export function pinnedWorkspaceKeys(
  pinned: readonly PinnedFamily[],
  workspaceIndex: WorkspaceIndex,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const entry of pinned) {
    const workspace = workspaceIndex.workspaceOfThread(entry.family.root);
    if (workspace !== null) keys.add(workspace.key);
  }
  return keys;
}

/**
 * Pinned, one row per workspace.
 *
 * A pin is on a conversation, but this mode draws no conversations, so the
 * workspace holding it is what is kept in view, once however many of its
 * conversations are pinned. It carries every conversation drawn in it, pinned
 * or not, because the row's status and click target are the workspace's.
 * Rows follow the pin order of the first pinned conversation in each.
 */
export function pinnedWorkspaces(input: {
  /** In the order the section draws pins. */
  readonly pinned: readonly PinnedFamily[];
  /** Every family drawn, pinned ones included. */
  readonly families: readonly ThreadFamily[];
  readonly workspaceIndex: WorkspaceIndex;
  readonly projectNames: ReadonlyMap<string, string>;
  readonly now: number;
}): PinnedWorkspaces {
  const { pinned, workspaceIndex } = input;
  const keys = pinnedWorkspaceKeys(pinned, workspaceIndex);
  const familiesByKey = new Map<string, ThreadFamily[]>();
  for (const family of input.families) {
    const key = workspaceIndex.workspaceOfThread(family.root)?.key;
    if (key === undefined || !keys.has(key)) continue;
    const bucket = familiesByKey.get(key) ?? [];
    bucket.push(family);
    familiesByKey.set(key, bucket);
  }
  const workspaces = new Map<string, PinnedWorkspaceNode>();
  const loose: PinnedFamily[] = [];
  for (const entry of pinned) {
    const workspace = workspaceIndex.workspaceOfThread(entry.family.root);
    if (workspace === null) {
      loose.push(entry);
      continue;
    }
    const existing = workspaces.get(workspace.key);
    if (existing !== undefined) {
      workspaces.set(workspace.key, {
        ...existing,
        pinnedRootIds: [...existing.pinnedRootIds, entry.family.root.id],
      });
      continue;
    }
    const families = familiesByKey.get(workspace.key) ?? [entry.family];
    workspaces.set(workspace.key, {
      ref: workspace,
      families,
      rollup: rollupThreads(
        families.flatMap((family) => [family.root, ...family.children]),
        input.now,
      ),
      projectId: workspace.projectId,
      projectName: input.projectNames.get(workspace.projectId) ?? entry.projectName,
      pinnedRootIds: [entry.family.root.id],
    });
  }
  return { workspaces: [...workspaces.values()], loose };
}

/**
 * Pinned rows in bb's pin order, which the view model does not know: it is
 * read after the model names the pinned conversations.
 */
export function orderPinnedWorkspaces(
  pinned: PinnedWorkspaces,
  ordered: readonly PinnedFamily[],
): PinnedWorkspaces {
  const rank = new Map(ordered.map((entry, index) => [entry.family.root.id, index]));
  const firstPin = (node: PinnedWorkspaceNode) =>
    Math.min(...node.pinnedRootIds.map((id) => rank.get(id) ?? Infinity));
  const looseIds = new Set(pinned.loose.map((entry) => entry.family.root.id));
  return {
    workspaces: [...pinned.workspaces].sort((left, right) => firstPin(left) - firstPin(right)),
    loose: ordered.filter((entry) => looseIds.has(entry.family.root.id)),
  };
}

/** What a workspace row's leading glyph should show. */
export const WORKSPACE_GLYPH_KINDS = ["status", "pull-request", "type"] as const;
export type WorkspaceGlyphKind = (typeof WORKSPACE_GLYPH_KINDS)[number];

/**
 * The glyph's priority: what the threads are doing, then the pull request, then
 * what kind of directory it is. A failure or a raised hand must never hide
 * behind a decorative icon, and the pull request outranks the type because it
 * is news about this workspace's work.
 */
export function workspaceGlyphKind(input: {
  readonly rollupKind: string;
  readonly hasPullRequest: boolean;
}): WorkspaceGlyphKind {
  if (
    input.rollupKind === "failed" ||
    input.rollupKind === "needs-you" ||
    input.rollupKind === "working" ||
    input.rollupKind === "unread"
  ) {
    return "status";
  }
  return input.hasPullRequest ? "pull-request" : "type";
}

/** Which directory icon a workspace draws when nothing outranks it. */
export type WorkspaceTypeIcon = "Folder" | "GitBranch" | "FolderGit" | "MessageSquare";

export function workspaceTypeIcon(
  ref: Pick<Workspace, "kind" | "featureId" | "parentKey">,
): WorkspaceTypeIcon {
  if (ref.kind === "personal") return "MessageSquare";
  if (ref.featureId !== null && ref.parentKey === null) return "FolderGit";
  if (ref.kind === "project-checkout") return "Folder";
  return "GitBranch";
}
