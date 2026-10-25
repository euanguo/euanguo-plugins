import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk";
import {
  familyStatus,
  type FamilyStatusKind,
  type FamilyStatusPresentation,
} from "./family-status.ts";
import { buildProjectGroups, type ThreadFamily } from "./inbox.ts";
import { projectBadgePresentation } from "./project-colors.ts";
import { rollupThreads, statusKindRank } from "./rollup.ts";
import type { WorkspaceOwnershipMap } from "./workspace-ownership.ts";

const ATTENTION_KINDS: ReadonlySet<FamilyStatusKind> = new Set([
  "failed",
  "needs-you",
  "working",
  "unread",
]);

export interface TitleAttentionEntry {
  readonly projectId: string;
  readonly projectName: string;
  readonly family: ThreadFamily;
  readonly status: FamilyStatusPresentation;
  readonly color: string;
  /** The thread that raised the dominant state; clicking should land there. */
  readonly leadThreadId: string;
}

const CHIP_MIN_WIDTH = 72;
const CHIP_GAP = 4;

/**
 * Keep the queue inside the measured title bar without dropping urgency.
 *
 * The entries are already ordered, so the visible prefix is the part that
 * matters most. The caller renders the remainder as one compact `+N` chip.
 */
export function titleAttentionWindow(
  entries: readonly TitleAttentionEntry[],
  width: number,
): {
  readonly visible: readonly TitleAttentionEntry[];
  readonly hidden: readonly TitleAttentionEntry[];
} {
  const capacity = Math.max(
    1,
    Math.floor((width + CHIP_GAP) / (CHIP_MIN_WIDTH + CHIP_GAP)),
  );
  if (entries.length <= capacity) {
    return { visible: entries, hidden: [] };
  }
  const visibleCount = Math.max(1, capacity - 1);
  return {
    visible: entries.slice(0, visibleCount),
    hidden: entries.slice(visibleCount),
  };
}

/**
 * The thread families worth putting in the title bar right now.
 *
 * This is deliberately a projection of state, not a favourites list: a family
 * enters while failed, waiting, working or unread, and leaves when the quiet
 * states are all that remain. `isActive` is the lifecycle's shelf decision, so
 * a snoozed family does not leak back in just because it was unread.
 */
export function titleAttentionEntries(input: {
  threads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
  projectColors: ReadonlyMap<string, string>;
  workspaceOwnership?: WorkspaceOwnershipMap;
  now: number;
  isActive: (thread: PluginSidebarThread) => boolean;
}): TitleAttentionEntry[] {
  const visible = input.threads.filter(
    (thread) => !thread.isArchived && input.isActive(thread),
  );
  const entries: TitleAttentionEntry[] = [];
  for (const group of buildProjectGroups(
    visible,
    input.projects,
    input.workspaceOwnership,
  )) {
    for (const family of group.families) {
      const members = [family.root, ...family.children];
      const status = familyStatus(members, input.now);
      if (!ATTENTION_KINDS.has(status.kind)) continue;
      const rollup = rollupThreads(members, input.now);
      entries.push({
        projectId: group.project.id,
        projectName: group.project.name,
        family,
        status,
        color: projectBadgePresentation(
          group.project.id,
          input.projectColors.get(group.project.id),
        ).backgroundColor,
        leadThreadId: rollup.leadThreadId ?? family.root.id,
      });
    }
  }
  return entries.sort(compareEntries);
}

/** Urgency first, then the family that moved most recently. */
function compareEntries(
  left: TitleAttentionEntry,
  right: TitleAttentionEntry,
): number {
  const rank =
    statusKindRank(left.status.kind) - statusKindRank(right.status.kind);
  if (rank !== 0) return rank;
  const recency = familyRecency(right.family) - familyRecency(left.family);
  if (recency !== 0) return recency;
  return left.family.root.id.localeCompare(right.family.root.id);
}

function familyRecency(family: ThreadFamily): number {
  let latest = 0;
  for (const thread of [family.root, ...family.children]) {
    latest = Math.max(latest, thread.updatedAt, thread.latestAttentionAt);
  }
  return latest;
}
