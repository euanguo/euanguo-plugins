import { useRepoFacts } from "@/hooks/use-repo-facts";
import { Icon } from "@/components/ui/icon";
import { Pill } from "@/components/ui/pill";
import { TruncateStart } from "@/components/ui/truncate-start";
import { cn, formatHomePathForDisplay } from "@/lib/utils";
import type { RepoDiagnostic, RepoIdentity } from "@/lib/repo-identity";

/**
 * What the machines said about the workspaces Nest is drawing.
 *
 * This is the only surface in the plugin that shows something bb does not know:
 * a worktree another tool created is in the repository's own record and nowhere
 * else, and a project filed against the wrong repository only looks wrong when
 * two things are compared. Neither is visible in a tree that draws what bb
 * holds, so both are written down here.
 *
 * It is deliberately a report and not a repair. `threads.update` cannot change a
 * thread's project and bb has no way to move a worktree between projects, so the
 * honest answer is to say what was found and let the user fix it where it lives.
 *
 * Three changes from the first draft, all of them about reading twelve rows at
 * once:
 *
 * - **Counts first.** The paragraph that opened this panel ran four facts
 *   together; they are three numbers now, and a zero is drawn quietly instead of
 *   being buried mid-sentence.
 * - **One row per repository, and nothing to report if nothing is wrong.** The
 *   old version printed "1 workspace" on twelve cards, which is the same value
 *   twelve times and tells nobody anything. A clean repository is one line.
 * - **A path is read from its end.** `…/worktrees/tab-nest-3c0de-08b129d6` is
 *   the part that identifies it and the part the old `truncate` cut off; these
 *   run through `TruncateStart`, and the leading `~` shortens the home prefix
 *   the way the rest of bb does.
 */
export function RepoFactsPanel() {
  const facts = useRepoFacts();

  if (facts.repos.length === 0) {
    return (
      <div
        data-nest-repo-facts="empty"
        className="flex items-start gap-2 rounded border border-border/80 px-2 py-2 text-2xs leading-relaxed text-muted-foreground"
      >
        <Icon name="Server" className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Nothing has been read yet. Nest asks the machine that owns each
          workspace which repository it is in, so a repository whose machine is
          asleep stays unverified until it answers.
        </span>
      </div>
    );
  }

  const unseen = facts.repos.reduce(
    (total, repo) => total + repo.unseenWorktrees.length,
    0,
  );
  const conflicts = Object.values(facts.workspaceOwnership).filter(
    (ownership) => ownership.conflict,
  ).length;
  const silent = facts.unavailableHostIds.length;

  // Repositories with something to say first, then alphabetically: the reason
  // to open this tab is almost always one of the top rows.
  const ordered = [...facts.repos].sort((a, b) => {
    const weight = (repo: RepoIdentity) =>
      repo.unseenWorktrees.length +
      repo.diagnostics.filter((d) => d.code !== "unseen-worktree").length;
    return weight(b) - weight(a) || a.name.localeCompare(b.name);
  });

  return (
    <div data-nest-repo-facts="" className="space-y-2">
      <dl className="-mx-3 grid grid-cols-3 divide-x divide-border/80 border-y border-border/80">
        <Stat label="repositories" value={facts.repos.length} />
        <Stat
          label="unregistered worktrees"
          value={unseen}
          tone={unseen > 0 ? "warning" : "quiet"}
        />
        <Stat
          label={silent > 0 ? "machines silent" : "ownership conflicts"}
          value={silent > 0 ? silent : conflicts}
          tone={(silent > 0 ? silent : conflicts) > 0 ? "warning" : "quiet"}
        />
      </dl>

      <ul className="pt-1">
        {ordered.map((repo, index) => {
          const previous = ordered[index - 1];
          return (
            <RepoRow
              key={repo.key}
              repo={repo}
              // The list is sorted findings-first, so one rule marks where
              // "things to look at" stops and "everything is fine" starts.
              separatorBefore={
                previous !== undefined &&
                hasFindings(previous) &&
                !hasFindings(repo)
              }
            />
          );
        })}
      </ul>
    </div>
  );
}

/**
 * One number with its name under it.
 *
 * The tone is on the number, not the card: a count is either worth a glance or
 * it is not, and a tinted card for "zero" would draw the eye to nothing.
 */
function Stat({
  label,
  value,
  tone = "quiet",
}: {
  label: string;
  value: number;
  tone?: "quiet" | "warning";
}) {
  return (
    <div className="px-3 py-2">
      <dd
        className={cn(
          "tabular-nums text-sm font-medium",
          tone === "warning" ? "text-warning-foreground" : "text-foreground",
        )}
      >
        {value}
      </dd>
      <dt className="mt-0.5 text-2xs leading-snug text-muted-foreground">
        {label}
      </dt>
    </div>
  );
}

/** Whether this repository has anything the reader came here to see. */
function hasFindings(repo: RepoIdentity): boolean {
  return (
    repo.unseenWorktrees.length > 0 ||
    repo.diagnostics.some((d) => d.code !== "unseen-worktree")
  );
}

function RepoRow({
  repo,
  separatorBefore = false,
}: {
  repo: RepoIdentity;
  separatorBefore?: boolean;
}) {
  // `unseen-worktree` says "this repository has worktrees bb does not know",
  // and the list below already says it with the paths in it. The remaining
  // codes say something the list cannot.
  const reported = repo.diagnostics.filter(
    (diagnostic) => diagnostic.code !== "unseen-worktree",
  );
  const findings = reported.length > 0 || repo.unseenWorktrees.length > 0;

  // A repository with nothing to report is one line: its name, its remote, and
  // nothing else. Seven of twelve are clean on a normal machine, and giving
  // each of them a second line is what made this panel a scroll.
  if (!findings) {
    return (
      <li
        data-nest-repo-row={repo.key}
        data-nest-repo-clean=""
        className={cn(
          "flex items-baseline gap-2 py-2.5",
          separatorBefore && "mt-1 border-t border-border pt-3",
        )}
      >
        <span className="shrink-0 text-xs font-medium text-foreground">
          {repo.name}
        </span>
        {repo.kind === "directory" ? (
          <Pill variant="outline" size="sm" className="shrink-0">
            no repo
          </Pill>
        ) : null}
        {repo.projectIds.length > 1 ? (
          <Pill variant="outline" size="sm" className="shrink-0">
            {repo.projectIds.length} projects
          </Pill>
        ) : null}
        {repo.remoteUrl === null ? null : (
          <TruncateStart className="min-w-0 flex-1 text-2xs text-muted-foreground">
            {repo.remoteUrl}
          </TruncateStart>
        )}
      </li>
    );
  }

  return (
    <li
      data-nest-repo-row={repo.key}
      className={cn("py-2.5", separatorBefore && "border-t border-border")}
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-foreground">
          {repo.name}
        </span>
        {repo.kind === "directory" ? (
          <Pill variant="outline" size="sm" className="shrink-0">
            no repo
          </Pill>
        ) : null}
        {repo.projectIds.length > 1 ? (
          <Pill variant="outline" size="sm" className="shrink-0">
            {repo.projectIds.length} projects
          </Pill>
        ) : null}
        <span className="ml-auto shrink-0">
          {repo.unseenWorktrees.length > 0 ? (
            <Pill variant="secondary" size="sm">
              {repo.unseenWorktrees.length} new
            </Pill>
          ) : (
            <Pill variant="outline" size="sm">
              check
            </Pill>
          )}
        </span>
      </div>

      {repo.remoteUrl === null ? null : (
        // From the end: the owner and repository identify it, and those are
        // exactly the part a leading truncation keeps.
        <TruncateStart className="mt-0.5 text-2xs text-muted-foreground">
          {repo.remoteUrl}
        </TruncateStart>
      )}

      {repo.unseenWorktrees.length === 0 ? null : (
        // Two fixed columns and a state, so every path starts at the same x.
        // The branch is capped rather than `shrink-0`: one long `bb/thr_…`
        // name would otherwise push its own path out of line with the rest.
        <ul className="mt-1.5 space-y-px border-l border-border pl-3">
          {repo.unseenWorktrees.map((worktree) => (
            <li
              key={worktree.path}
              // Three fixed columns rather than `auto` for the last: each row
              // is its own grid, so an `auto` column is sized per row and the
              // state words land at a different x on every line.
              className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_3.25rem] items-baseline gap-2 py-0.5 text-2xs"
            >
              <span
                className="truncate font-medium text-foreground/85"
                title={worktree.branch ?? undefined}
              >
                {worktree.branch ?? (worktree.detached ? "detached" : "—")}
              </span>
              <TruncateStart title={worktree.path} className="text-muted-foreground">
                {formatHomePathForDisplay(worktree.path)}
              </TruncateStart>
              <span className="text-right">
                {worktree.prunable ? (
                  <span
                    className="text-2xs text-muted-foreground/70"
                    title="The directory is gone; only the git worktree record is left."
                  >
                    missing
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {reported.length === 0 ? null : (
        <ul className="mt-1 space-y-1">
          {reported.map((diagnostic, index) => (
            <DiagnosticRow
              key={`${diagnostic.code}-${index}`}
              diagnostic={diagnostic}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * One disagreement, said in the row of the repository it is about.
 *
 * These used to be collected into a second list under every repository, which
 * made the reader match "chaoshangtong has 5 worktrees…" against a row twelve
 * lines up. They belong to a repository; they are drawn inside it.
 */
function DiagnosticRow({ diagnostic }: { diagnostic: RepoDiagnostic }) {
  return (
    <li className="flex items-start gap-1.5 text-2xs leading-relaxed text-muted-foreground">
      <Icon
        name="AlertCircle"
        className="mt-0.5 size-3 shrink-0 text-warning-foreground"
        aria-hidden
      />
      <span className="min-w-0">
        <span className="font-medium text-foreground/85">
          {DIAGNOSTIC_LABELS[diagnostic.code]}
        </span>
        {" — "}
        {diagnostic.message}
      </span>
    </li>
  );
}

/** The short name for a diagnostic, so the list is skimmable before it is read. */
const DIAGNOSTIC_LABELS: Readonly<Record<RepoDiagnostic["code"], string>> = {
  "split-repo": "One repository, several projects",
  "multi-repo-project": "One project, several repositories",
  "orphan-workspace": "Workspace in another repository",
  "ownership-conflict": "Workspace moved to its filesystem owner",
  "ambiguous-owner": "Repository shared by several projects",
  "dangling-path": "Path could not be read",
  "duplicate-path": "Two records for one directory",
  "unseen-worktree": "Worktree bb does not know",
  "path-not-canonical": "Path spelled differently",
};
