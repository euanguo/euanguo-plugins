/**
 * Compact Harbor context injected into agent sessions at thread start.
 *
 * Keeps ordinary conversations under 1,000 tokens (typically <= 400 chars) by
 * declaring only the active access tier, the current project/workspace, an
 * unseen-worktree count when present, and the exact tools available to the
 * session — never dumping all groups, all worktrees, or other projects.
 */

import type { AgentAccessTier } from "../domain/agent-access.ts";
import { ownedWorkspaces } from "../domain/workspace-ownership.ts";
import type { SidebarIndex } from "./index-cache.ts";

/** Hard character cap keeping the contribution strictly under 1,000 tokens. */
export const MAX_INSTRUCTION_CHARS = 3500;

const MAX_NAME_CHARS = 80;
const MAX_PATH_CHARS = 200;

export function quoteName(value: string): string {
  const cleaned = cleanInstructionValue(value).slice(0, MAX_NAME_CHARS);
  return `"${cleaned}"`;
}

export function quotePath(value: string, max: number = MAX_PATH_CHARS): string {
  const cleaned = cleanInstructionValue(value).slice(0, max);
  return `"${cleaned}"`;
}

function cleanInstructionValue(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/"/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const DROP_FIRST = 2;
const DROP_SECOND = 1;
const KEEP = 0;

interface Section {
  readonly text: string;
  readonly rank: number;
}

export interface InstructionInput {
  readonly index: SidebarIndex | null;
  readonly tier: AgentAccessTier;
  /** The exact tool names offered to this session (synced with `configure`). */
  readonly toolNames: readonly string[];
  /** projectId of the thread this is being built for, when there is one. */
  readonly projectId: string | null;
  /** environmentId of the thread, used to pick the active workspace. */
  readonly environmentId?: string | null;
}

/**
 * Compact Harbor sidebar summary for one thread, or `null` when tier is `"off"`.
 */
export function agentInstructions(input: InstructionInput): string | null {
  if (input.tier === "off") return null;

  const sections: Section[] = [
    {
      rank: KEEP,
      text:
        `Harbor sidebar (access: ${input.tier}) — ` +
        "groups, project filing, and workspace aliases live in Harbor.",
    },
  ];

  if (input.index === null) {
    sections.push({
      rank: DROP_SECOND,
      text: "Sidebar index not loaded yet; call harbor_sidebar_map if needed.",
    });
  } else {
    sections.push(
      ...describeCurrentProject(
        input.index,
        input.projectId,
        input.environmentId ?? null,
      ),
    );
  }

  sections.push({
    rank: KEEP,
    text: availabilitySentence(input.tier, input.toolNames),
  });

  return fitToBudget(sections);
}

function availabilitySentence(
  tier: Exclude<AgentAccessTier, "off">,
  toolNames: readonly string[],
): string {
  const lines: string[] = [];
  if (toolNames.length > 0) {
    lines.push(`Tools (${tier}): ${toolNames.join(", ")}.`);
  }
  if (tier === "full") {
    lines.push(
      "Only modify groups, aliases, threads, or features when asked; use IDs from harbor_sidebar_map.",
    );
  }
  return lines.join("\n");
}

function describeCurrentProject(
  index: SidebarIndex,
  claimedProjectId: string | null,
  environmentId: string | null,
): Section[] {
  const projectId =
    claimedProjectId === null || environmentId === null
      ? claimedProjectId
      : index.repoFacts.workspaceOwnership[environmentId]?.ownerProjectId ??
        claimedProjectId;
  if (projectId === null) return [];

  const project = index.projects.find((candidate) => candidate.id === projectId);
  if (project === undefined) return [];

  const groupId = index.assignment[projectId] ?? null;
  const groupName =
    groupId === null
      ? "Ungrouped"
      : index.groups.find((group) => group.id === groupId)?.name ?? "Ungrouped";

  const sections: Section[] = [
    {
      rank: KEEP,
      text: `Project: ${quoteName(project.name)} (${project.id}) — group ${quoteName(groupName)}`,
    },
  ];

  const workspaces = ownedWorkspaces(
    index.repoFacts.repos,
    index.repoFacts.workspaceOwnership,
    projectId,
  );
  if (workspaces.length > 0) {
    const active =
      (environmentId === null
        ? undefined
        : workspaces.find((ws) => ws.environmentId === environmentId)) ??
      (workspaces.length === 1 ? workspaces[0] : undefined);
    if (active !== undefined) {
      const env =
        active.environmentId === null
          ? undefined
          : index.environments[active.environmentId];
      const branch = env?.branchName ?? null;
      const alias = env?.name ?? null;
      const more =
        workspaces.length > 1
          ? ` (+${workspaces.length - 1} more; call harbor_sidebar_map)`
          : "";
      sections.push({
        rank: DROP_SECOND,
        text:
          `Workspace: ${quotePath(active.workspace.path)}` +
          `${branch === null ? "" : ` — branch ${quoteName(branch)}`}` +
          `${alias === null ? "" : ` — alias ${quoteName(alias)}`}` +
          `${active.environmentId === null ? "" : ` — env ${active.environmentId}`}` +
          more,
      });
    } else {
      sections.push({
        rank: DROP_SECOND,
        text: `Workspaces: ${workspaces.length} tracked; call harbor_sidebar_map for paths and env ids.`,
      });
    }
  }

  const repoKey = index.repoFacts.repoKeyByProject[projectId] ?? null;
  const repo =
    repoKey === null
      ? undefined
      : index.repoFacts.repos.find((candidate) => candidate.key === repoKey);
  const unseen = repo?.unseenWorktrees ?? [];
  if (unseen.length > 0) {
    sections.push({
      rank: DROP_FIRST,
      text:
        `Unseen worktrees: ${unseen.length} on disk without a bb env; ` +
        "do not create a new project (call harbor_sidebar_map).",
    });
  }

  return sections;
}

function fitToBudget(sections: readonly Section[]): string {
  const kept = sections.map((section) => ({ ...section, dropped: false }));

  const liveText = (): string =>
    kept.flatMap((section) => (section.dropped ? [] : [section.text])).join("\n");

  for (const rank of [DROP_FIRST, DROP_SECOND]) {
    if (liveText().length <= MAX_INSTRUCTION_CHARS) break;
    for (const section of kept) {
      if (liveText().length <= MAX_INSTRUCTION_CHARS) break;
      if (section.rank === rank) section.dropped = true;
    }
  }

  const text = liveText();
  return text.length <= MAX_INSTRUCTION_CHARS
    ? text
    : `${text.slice(0, MAX_INSTRUCTION_CHARS - 1)}…`;
}

/**
 * Short location line for a thread outside any Harbor feature.
 */
export function workspaceInstructions(input: {
  readonly projectName: string;
  readonly environment: {
    readonly name: string | null;
    readonly path: string | null;
    readonly branchName: string | null;
  };
}): string | null {
  const environment = input.environment;
  if (environment.path === null) return null;
  const leaf = environment.path.split("/").filter(Boolean).at(-1) ?? environment.path;
  const label =
    environment.name?.trim() || environment.branchName?.trim() || leaf;
  const branch = environment.branchName?.trim();
  return [
    `You are working in ${quoteName(input.projectName)}, in the workspace ${quoteName(label)}${branch === undefined || branch.length === 0 ? "" : ` on branch ${quoteName(branch)}`}.`,
    "This checkout is the workspace the conversation runs in; other conversations in it are sibling chats, not other repositories.",
  ].join(" ");
}
