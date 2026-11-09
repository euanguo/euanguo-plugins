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
 * markers and rewrites it whenever the members change; everything outside the
 * markers — the requirement, the acceptance notes, a progress log an agent kept
 * — belongs to whoever wrote it and is never touched.
 */

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
  return `${BEGIN}
# ${context.name}

This folder is one piece of work that spans several repositories. It is **not**
a git repository. Each subfolder is a git worktree of its own repository, on
its own branch. A repository added from Nest starts on the branch picked for it,
which defaults to \`${context.suggestedBranch}\` but may be any name or an
existing branch.

${rows}

## Rules for working here

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
