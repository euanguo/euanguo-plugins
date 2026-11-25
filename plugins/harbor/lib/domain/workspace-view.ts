/**
 * What the workspaces view decides about a workspace row.
 *
 * In this mode the sidebar stops at the workspace and the header carries the
 * conversations, so a row has to answer, from the threads under it, the
 * questions a thread row answered by being itself: which conversation a click
 * opens, what a project draws below its workspaces, and which glyph leads a
 * row. Each answer is a pure function here, so the rows only draw.
 *
 * Pins are not one of them. A pin is on a conversation, and this mode draws
 * none, so a pin never moves a workspace row: it stays under its project.
 */

import type { ThreadFamily } from "./inbox.ts";
import { orderFamilies } from "./ordering.ts";
import type { StatusRollup } from "./rollup.ts";
import type { ProjectNode, WorkspaceNode } from "./tree.ts";
import { NO_WORKSPACE_KEY, type Workspace } from "./workspace-index.ts";

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
