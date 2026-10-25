/**
 * What every thread is told about the sidebar, before it does anything.
 *
 * The point is not to describe the tools; it is to answer the question an agent
 * does not know to ask. An agent that creates a project for a worktree is not
 * being careless — it has no way to know the worktree already belongs to one,
 * because that fact is in this plugin's database and nowhere in its context. The
 * summary is that fact, delivered for free.
 *
 * It is delivered through `contributeInstructions`, which runs on the thread-start
 * path and must be synchronous, so everything here is served from the
 * materialized index (`index-cache.ts`) and nothing is awaited.
 *
 * Two hard limits shape the whole file:
 *
 * - **4096 characters.** The host truncates past that, and a truncation lands
 *   wherever it lands — which is how a workspace list becomes one missing its
 *   last path. So the summary is built as named sections and whole sections are
 *   dropped, in a fixed order, until what is left fits.
 * - **Every value is untrusted.** A project name, a group name and a workspace
 *   alias are all free text a person or an agent typed, and this text goes into
 *   an instruction block. A newline in a name would let it forge a line of
 *   instructions, so names are collapsed, stripped of control characters and
 *   quoted rather than interpolated raw.
 */

import type { AgentToolFeature, AgentToolFlags } from "./toolkit.ts";
import type { SidebarIndex } from "./index-cache.ts";
import { ownedWorkspaces } from "../workspace-ownership.ts";

/** The host's cap. Past this the contribution is truncated by the host. */
export const MAX_INSTRUCTION_CHARS = 4096;

/** How much of one name is worth spending. Long enough for a real path. */
const MAX_NAME_CHARS = 80;

/**
 * A name, made safe to put in an instruction block.
 *
 * Control characters and newlines are removed rather than escaped: there is no
 * escape in this format, and a name is a label — one that only makes sense with
 * a line break in it is not worth carrying. Double quotes become single quotes
 * so the surrounding pair stays the only delimiters.
 */
export function quoteName(value: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/"/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_CHARS);
  return `"${cleaned}"`;
}

/**
 * When a section goes, if the summary does not fit.
 *
 * A rank rather than an order, because the sections are assembled in reading
 * order and dropped in importance order, and those are not the same order. The
 * higher the rank, the sooner it goes.
 */
const DROP_FIRST = 5;
const DROP_SECOND = 4;
const DROP_THIRD = 3;
const DROP_FOURTH = 2;
/** Never dropped: the sentence saying what this is, and what the agent may do. */
const KEEP = 0;

interface Section {
  readonly text: string;
  readonly rank: number;
}

/** The feature each tool belongs to, for the "what is off" sentence. */
const FEATURE_LABELS: Readonly<Record<AgentToolFeature, string>> = {
  read: "read",
  grouping: "filing projects into groups",
  groups: "creating and renaming groups",
  aliases: "renaming workspaces",
};

export interface InstructionInput {
  readonly index: SidebarIndex | null;
  readonly flags: AgentToolFlags;
  /** The tool names a session starting now would be offered. */
  readonly toolNames: readonly string[];
  /** projectId of the thread this is being built for, when there is one. */
  readonly projectId: string | null;
  /** environmentId of the thread, used to resolve its physical owner. */
  readonly environmentId?: string | null;
}

/**
 * The contribution for one thread, or null to contribute nothing.
 *
 * Null rather than an empty string for the master gate: the host reads a null as
 * "this plugin has nothing to say", where an empty string would still be a
 * section heading with nothing under it.
 */
export function agentInstructions(input: InstructionInput): string | null {
  if (!input.flags.enabled) return null;

  const sections: Section[] = [
    {
      rank: KEEP,
      text:
        "Nest sidebar — a project organization layer bb itself does not know about. " +
        "Groups, a project's group, and a workspace's alias live in Nest, not in bb.",
    },
  ];

  if (input.flags.read) {
    if (input.index === null) {
      // A real state: a thread started in the second before the first read
      // landed. Worth saying the tools exist even then, so the agent asks
      // instead of assuming there is nothing to ask about.
      sections.push({
        rank: DROP_FOURTH,
        text: "The current structure has not been read yet; use the map tool.",
      });
    } else {
      sections.push(
        ...describeSidebar(
          input.index,
          input.projectId,
          input.environmentId ?? null,
        ),
      );
    }
  }

  sections.push({
    rank: KEEP,
    text: availabilitySentence(input.flags, input.toolNames),
  });

  return fitToBudget(sections);
}

/**
 * What the agent may and may not do, stated once.
 *
 * The permission sentence is not decoration. Every write tool here changes
 * something the user made, and an agent that has been told it *can* file a
 * project will eventually file one nobody asked it to.
 */
function availabilitySentence(flags: AgentToolFlags, toolNames: readonly string[]): string {
  const off = (Object.keys(FEATURE_LABELS) as AgentToolFeature[]).filter(
    (feature) => !flags.enabled || !flags[feature],
  );
  const lines: string[] = [];
  if (toolNames.length > 0) {
    lines.push(`Tools available now: ${toolNames.join(", ")}.`);
  }
  if (off.length > 0) {
    lines.push(
      `Off in Nest's settings: ${off.map((feature) => FEATURE_LABELS[feature]).join(", ")}.`,
    );
  }
  lines.push(
    "Only change a group, a group name or an alias when the user asks for it, " +
      "and use the ids from the map rather than the names you see.",
  );
  return lines.join("\n");
}

/** The map, as prose, in reading order and with each part's drop rank. */
function describeSidebar(
  index: SidebarIndex,
  claimedProjectId: string | null,
  environmentId: string | null,
): Section[] {
  const projectId =
    claimedProjectId === null || environmentId === null
      ? claimedProjectId
      : index.repoFacts.workspaceOwnership[environmentId]?.ownerProjectId ??
        claimedProjectId;
  const groupName = (id: string | null): string => {
    if (id === null) return "Ungrouped";
    return index.groups.find((group) => group.id === id)?.name ?? "Ungrouped";
  };

  const groupCounts = new Map<string, number>();
  for (const project of index.projects) {
    const groupId = index.assignment[project.id] ?? "";
    groupCounts.set(groupId, (groupCounts.get(groupId) ?? 0) + 1);
  }

  const sections: Section[] = [];
  const groupLines = index.groups
    .map((group) => `${quoteName(group.name)} (${group.id}, ${groupCounts.get(group.id) ?? 0})`)
    .join(" · ");
  sections.push({
    rank: DROP_FOURTH,
    text: `Groups: ${groupLines.length > 0 ? groupLines : "none"} · ${groupCounts.get("") ?? 0} ungrouped`,
  });

  if (projectId !== null) {
    const project = index.projects.find((candidate) => candidate.id === projectId);
    if (project !== undefined) {
      const repoKey = index.repoFacts.repoKeyByProject[projectId] ?? null;
      const repo = repoKey === null
        ? undefined
        : index.repoFacts.repos.find((candidate) => candidate.key === repoKey);

      const lines = [
        `This thread's project: ${quoteName(project.name)} (${project.id}) — group ${quoteName(groupName(index.assignment[projectId] ?? null))}`,
      ];
      if (repo !== undefined) {
        lines.push(
          `  repository ${quoteName(repo.name)}${repo.remoteUrl === null ? " (no remote)" : ` (${repo.remoteUrl})`}`,
        );
      }
      // The project's identity is never dropped: it is the one being worked in.
      sections.push({ rank: KEEP, text: lines.join("\n") });

      const workspaces = ownedWorkspaces(
        index.repoFacts.repos,
        index.repoFacts.workspaceOwnership,
        projectId,
      );
      if (workspaces.length > 0) {
        const rows = workspaces.map((workspace) => {
          const environmentId = workspace.environmentId ?? undefined;
          const environment = environmentId === undefined
            ? undefined
            : index.environments[environmentId];
          const branch = environment?.branchName ?? null;
          const alias = environment?.name ?? null;
          return (
            `    ${workspace.workspace.path}` +
            `${workspace.repo.key === repo?.key ? "" : ` — repository ${quoteName(workspace.repo.name)}`}` +
            `${branch === null ? "" : ` — branch ${quoteName(branch)}`}` +
            `${alias === null ? "" : ` — alias ${quoteName(alias)}`}` +
            `${environmentId === undefined ? "" : ` — env ${environmentId}`}`
          );
        });
        sections.push({ rank: DROP_THIRD, text: ["  workspaces:", ...rows].join("\n") });
      }

      const unseen = repo?.unseenWorktrees ?? [];
      if (unseen.length > 0) {
        sections.push({
          rank: DROP_SECOND,
          text:
            `  ${unseen.length} worktree${unseen.length === 1 ? "" : "s"} in this repository that bb has no environment for: ` +
            `${unseen.map((worktree) => worktree.path).join(", ")}\n` +
            "  A worktree with no environment cannot hold a thread until one is registered; do not create a project for it.",
        });
      }
    }
  }

  const others = index.projects
    .filter((project) => project.id !== projectId)
    .map(
      (project) =>
        `${quoteName(project.name)} (${project.id}, ${quoteName(groupName(index.assignment[project.id] ?? null))})`,
    );
  if (others.length > 0) {
    // An index of everything else, and the first thing a reader can live without.
    sections.push({ rank: DROP_FIRST, text: `Other projects: ${others.join(" · ")}` });
  }

  return sections;
}

/**
 * Drop whole sections until the text fits, highest rank first.
 *
 * Never a section in half, and never the two KEEP sections. When even those do
 * not fit — a project name at the cap, which takes 80 characters of a 4096
 * budget — the tail is cut, because at that point there is nothing left to
 * choose between.
 */
function fitToBudget(sections: readonly Section[]): string {
  const kept = sections.map((section) => ({ ...section, dropped: false }));

  /** The text as it would read now, which is what the budget is measured on. */
  const liveText = (): string =>
    kept.flatMap((section) => (section.dropped ? [] : [section.text])).join("\n");

  for (const rank of [DROP_FIRST, DROP_SECOND, DROP_THIRD, DROP_FOURTH]) {
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
