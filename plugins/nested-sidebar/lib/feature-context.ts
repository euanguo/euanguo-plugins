/**
 * The files an agent reads when it starts inside a feature directory.
 *
 * Nothing is sent to the thread. A new conversation in a feature is an empty
 * conversation, and the agent learns where it is the way it learns about any
 * repository: from the instruction file in its working directory. Codex reads
 * `AGENTS.md`; Claude Code reads `CLAUDE.md`, which here is one line importing
 * `AGENTS.md`, so there is one text and no copy to drift.
 *
 * `AGENTS.md` is shared with the person. Nest owns the block between its two
 * markers and rewrites it whenever the members or the feature's requirement and
 * decisions change; everything outside the markers — free-form notes, a progress
 * log an agent kept — belongs to whoever wrote it and is never touched.
 */

import {
  SUMMARY_BLOCKER_LIMIT,
  SUMMARY_DECISION_LIMIT,
  SUMMARY_QUESTION_LIMIT,
  SUMMARY_REF_LIMIT,
  SUMMARY_TEXT_LIMIT,
  SUMMARY_TOTAL_LIMIT,
  activeDecisions,
  neutralizeBlockMarkers,
  type FeatureDecision,
  type FeatureMeta,
  type RefKind,
} from "./feature-meta.ts";

export const AGENTS_FILE = "AGENTS.md";
export const CLAUDE_FILE = "CLAUDE.md";
export const MANIFEST_FILE = ".nest-feature.json";
/** What an older build wrote instead of `AGENTS.md`; removed on the next write. */
export const LEGACY_CONTEXT_FILE = "NEST.md";

/** The files Nest itself writes into a feature directory. */
export const FEATURE_OWN_FILES: readonly string[] = [
  AGENTS_FILE,
  CLAUDE_FILE,
  MANIFEST_FILE,
  LEGACY_CONTEXT_FILE,
];

export const CLAUDE_CONTENT = "@AGENTS.md\n";

const BEGIN = "<!-- nest:begin · managed by Nest, rewritten when repositories change -->";
const END = "<!-- nest:end -->";

export interface ContextMember {
  readonly directory: string;
  readonly repository: string;
  readonly branch: string | null;
  /** How this checkout installs its dependencies, when that can be told. */
  readonly install: string | null;
}

export interface FeatureContext {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  /** The branch suggested for a repository that has not been given one. */
  readonly suggestedBranch: string;
  readonly members: readonly ContextMember[];
  /**
   * What this work is for, its references and the decisions that stand.
   *
   * Rendered by the server from the feature's stored metadata, so the host does
   * not have to read the database or know its shape. Empty means the feature
   * has nothing recorded yet, and the block stays as it was before.
   */
  readonly summary?: string;
}

/** Nest's block, markers included. */
export function renderManagedBlock(context: FeatureContext): string {
  const rows =
    context.members.length === 0
      ? "_No repositories yet._ Add one with the `nest_feature_add_repos` tool, or from the feature's row in the Nest sidebar."
      : [
          "| Folder | Repository | Branch | Install |",
          "| --- | --- | --- | --- |",
          ...context.members.map(
            (member) =>
              `| \`${member.directory}/\` | ${member.repository} | \`${member.branch ?? "detached"}\` | ${member.install === null ? "—" : `\`${member.install}\``} |`,
          ),
        ].join("\n");
  const summary = context.summary?.trim() ?? "";
  const summarySection = summary.length === 0 ? "" : `${summary}\n\n`;
  return `${BEGIN}
# ${context.name}

This folder is one piece of work that spans several repositories. It is **not**
a git repository. Each subfolder is a git worktree of its own repository, on
its own branch. A repository added from Nest starts on the branch picked for it,
which defaults to \`${context.suggestedBranch}\` but may be any name or an
existing branch.

${rows}

${summarySection}## Rules for working here

- Name the repository in every git command: \`git -C <folder> status\`. In this
  folder itself \`git\` finds no repository, and \`git add -A\` would either fail
  or reach one you did not mean to touch.
- Never run \`git init\` here. Each subfolder would be recorded as an empty
  embedded repository.
- Commit and open a pull request per repository. There is no cross-repository
  commit.
- Fresh worktrees have no dependencies installed. Run the install command in
  that folder before building or testing.
- To bring another repository into this work, call \`nest_feature_add_repos\`
  rather than \`git worktree add\`: it checks the branch is free, puts the folder
  where the others are, and updates this file.

Feature \`${context.slug}\` · id \`${context.id}\`
${END}`;
}

/**
 * What a feature's stored intent looks like inside `AGENTS.md`.
 *
 * This is a digest, not the log. Every conversation in the feature reads it
 * before it starts, so it carries only what changes how someone acts: the goal,
 * what would make the work done, the open questions, where the work came from,
 * and the decisions that still stand. The rest is one tool call away.
 *
 * User-authored text is normalized to one line per field and stripped of the
 * block markers first — a rationale that quotes an HTML comment must not be
 * able to close Nest's block from the inside.
 */
export function renderFeatureSummary(meta: FeatureMeta): string {
  const brief = meta.brief;
  const blocks: string[] = [];

  const requirement: string[] = [];
  const goal = oneLine(brief.goal, SUMMARY_TEXT_LIMIT);
  if (goal.length > 0) requirement.push(`**Goal.** ${goal}`);
  const nonGoals = oneLine(brief.nonGoals, SUMMARY_TEXT_LIMIT);
  if (nonGoals.length > 0) requirement.push(`**Not this work.** ${nonGoals}`);
  const acceptance = oneLine(brief.acceptance, SUMMARY_TEXT_LIMIT);
  if (acceptance.length > 0) requirement.push(`**Acceptance.** ${acceptance}`);
  const notes = oneLine(brief.notes, SUMMARY_TEXT_LIMIT);
  if (notes.length > 0) requirement.push(`**Notes.** ${notes}`);
  if (requirement.length > 0) {
    blocks.push(`## What this work is for\n\n${requirement.join("\n\n")}`);
  }

  if (brief.openQuestions.length > 0) {
    blocks.push(
      `## Open questions\n\n${listLines(brief.openQuestions, SUMMARY_QUESTION_LIMIT)}`,
    );
  }
  if (brief.blockers.length > 0) {
    blocks.push(
      `## Blocked by\n\n${listLines(brief.blockers, SUMMARY_BLOCKER_LIMIT)}`,
    );
  }

  if (meta.refs.length > 0) {
    const shown = meta.refs.slice(0, SUMMARY_REF_LIMIT).map((ref) => {
      const title = oneLine(ref.title, 200).replace(/[[\]]/gu, "\\$&");
      const label = `${refKindLabel(ref.kind)} · ${title}`;
      const link =
        ref.url === null ? label : `[${label}](<${ref.url}>)`;
      const id =
        ref.refId === null || title.includes(ref.refId)
          ? ""
          : ` (\`${oneLine(ref.refId, 200)}\`)`;
      return `- ${link}${id}`;
    });
    const more =
      meta.refs.length > SUMMARY_REF_LIMIT
        ? `\n\n_${meta.refs.length - SUMMARY_REF_LIMIT} more; call \`nest_feature_brief\` to read them._`
        : "";
    blocks.push(`## References\n\n${shown.join("\n")}${more}`);
  }

  const active = activeDecisions(meta.decisions);
  if (active.length > 0) {
    const shown = [...active]
      .reverse()
      .slice(0, SUMMARY_DECISION_LIMIT)
      .map(decisionLine);
    const more =
      active.length > SUMMARY_DECISION_LIMIT
        ? `\n\n_Showing the newest ${SUMMARY_DECISION_LIMIT} of ${active.length}; call \`nest_feature_brief\` for the full log._`
        : "";
    blocks.push(`## Decisions that stand\n\n${shown.join("\n")}${more}`);
  }

  const drafts = meta.decisions.filter(
    (decision) => decision.status === "draft",
  ).length;
  if (drafts > 0) {
    blocks.push(
      `_${drafts} draft decision${drafts === 1 ? "" : "s"} awaiting a person's confirmation. They are not decisions yet; call \`nest_feature_brief\` to read them._`,
    );
  }

  return fitTotal(blocks.join("\n\n"));
}

function decisionLine(decision: FeatureDecision): string {
  const title = oneLine(decision.title, 200);
  const choice = oneLine(decision.choice, SUMMARY_TEXT_LIMIT);
  const rationale = oneLine(decision.rationale, SUMMARY_TEXT_LIMIT);
  const why = rationale.length === 0 ? "" : `\n  Why: ${rationale}`;
  return `- **#${decision.seq} ${title}** — ${choice}${why}`;
}

function listLines(items: readonly string[], limit: number): string {
  const shown = items
    .slice(0, limit)
    .map((item) => `- ${oneLine(item, SUMMARY_TEXT_LIMIT)}`);
  const more =
    items.length > limit
      ? `\n- … ${items.length - limit} more`
      : "";
  return `${shown.join("\n")}${more}`;
}

function refKindLabel(kind: RefKind): string {
  if (kind === "ticket") return "Ticket";
  if (kind === "document") return "Doc";
  return "Link";
}

function oneLine(value: string, limit: number): string {
  const collapsed = neutralizeBlockMarkers(value)
    .replace(/\s+/gu, " ")
    .trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit - 1)}…` : collapsed;
}

/** Keep the whole digest under the cap without cutting a line in half. */
function fitTotal(text: string): string {
  if (text.length <= SUMMARY_TOTAL_LIMIT) return text;
  const head = text.slice(0, SUMMARY_TOTAL_LIMIT);
  const breakAt = head.lastIndexOf("\n");
  return `${breakAt === -1 ? head : head.slice(0, breakAt)}\n\n_… summary shortened; call \`nest_feature_brief\` for the full log._`;
}

/**
 * The whole file after Nest's block is replaced.
 *
 * A file with no markers — one a person wrote before the feature had a block —
 * keeps every line, below the new block. A file with markers keeps everything
 * outside them, byte for byte.
 */
export function mergeAgentsFile(existing: string | null, block: string): string {
  if (existing === null || existing.trim().length === 0) {
    return `${block}\n\n## Notes\n\nWrite the requirement, decisions and progress here. Nest never edits below its block.\n`;
  }
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END, start === -1 ? 0 : start);
  if (start === -1 || end === -1) return `${block}\n\n${existing}`;
  return `${existing.slice(0, start)}${block}${existing.slice(end + END.length)}`;
}

/** The text outside Nest's block, trimmed; empty when the person wrote nothing. */
export function userNotesOf(existing: string | null): string {
  if (existing === null) return "";
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END, start === -1 ? 0 : start);
  const outside =
    start === -1 || end === -1
      ? existing
      : `${existing.slice(0, start)}${existing.slice(end + END.length)}`;
  return outside
    .replace(/## Notes\s+Write the requirement, decisions and progress here\. Nest never edits below its block\./u, "")
    .trim();
}

/** The machine-readable twin of the block, for tools that would rather not parse markdown. */
export function renderManifest(context: FeatureContext): string {
  return `${JSON.stringify(
    {
      layoutVersion: 2,
      featureId: context.id,
      name: context.name,
      slug: context.slug,
      suggestedBranch: context.suggestedBranch,
      members: context.members.map((member) => ({
        directory: member.directory,
        repository: member.repository,
        branch: member.branch,
      })),
    },
    null,
    2,
  )}\n`;
}
