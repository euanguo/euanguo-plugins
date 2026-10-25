import { useRepoFacts } from "@/hooks/use-repo-facts";
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
 */
export function RepoFactsPanel() {
  const facts = useRepoFacts();

  if (facts.repos.length === 0) {
    return (
      <p
        data-nest-repo-facts="empty"
        className="rounded-md border border-border/70 bg-background/50 px-2 py-2 text-2xs text-muted-foreground"
      >
        No workspaces have been read yet. Nest asks the machine that owns each
        one which repository it is in, so a repository whose machine is asleep
        stays unverified until it answers.
      </p>
    );
  }

  const unseen = facts.repos.reduce(
    (total, repo) => total + repo.unseenWorktrees.length,
    0,
  );
  const ownershipConflicts = Object.values(facts.workspaceOwnership).filter(
    (ownership) => ownership.conflict,
  );

  return (
    <div data-nest-repo-facts="" className="space-y-2 text-2xs">
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">
          {facts.repos.length} repositor{facts.repos.length === 1 ? "y" : "ies"}
        </span>{" "}
        read from disk. {unseen} worktree{unseen === 1 ? "" : "s"} the repository
        records {unseen === 1 ? "is" : "are"} not in bb.{" "}
        {ownershipConflicts.length === 0
          ? "Every visible workspace belongs to its claimed project."
          : `${ownershipConflicts.length} workspace record${ownershipConflicts.length === 1 ? " is" : "s are"} drawn under its filesystem owner instead of its claimed project.`}{" "}
        {facts.unavailableHostIds.length > 0
          ? `${facts.unavailableHostIds.length} machine(s) did not answer, so their workspaces are drawn unverified.`
          : "Every machine answered."}
      </p>

      <ul className="grid gap-1.5">
        {facts.repos.map((repo) => (
          <RepoRow key={repo.key} repo={repo} />
        ))}
      </ul>

      {facts.diagnostics.length > 0 ? (
        <ul data-nest-repo-diagnostics="" className="grid gap-1.5">
          {facts.diagnostics.map((diagnostic, index) => (
            <li
              key={`${diagnostic.code}-${index}`}
              className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-muted-foreground"
            >
              <span className="font-medium text-foreground">
                {DIAGNOSTIC_LABELS[diagnostic.code]}
              </span>{" "}
              — {diagnostic.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          Every workspace agrees with the project bb filed it under.
        </p>
      )}
    </div>
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

function RepoRow({ repo }: { repo: RepoIdentity }) {
  const flagged = repo.diagnostics.length > 0 || repo.unseenWorktrees.length > 0;
  return (
    <li
      className={[
        "rounded-md border px-2 py-1.5",
        flagged
          ? "border-warning/40 bg-warning/10"
          : "border-border/70 bg-background/50",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-foreground">{repo.name}</span>
        <span className="text-muted-foreground">
          {repo.kind === "directory"
            ? "plain directory"
            : repo.remoteUrl ?? "git, no remote"}
        </span>
        <span className="text-muted-foreground">
          {repo.workspaces.length} workspace
          {repo.workspaces.length === 1 ? "" : "s"}
          {repo.projectIds.length > 1
            ? ` · ${repo.projectIds.length} bb projects`
            : ""}
        </span>
      </div>
      {repo.unseenWorktrees.length > 0 ? (
        <ul className="mt-1 grid gap-0.5 text-muted-foreground">
          {repo.unseenWorktrees.map((worktree) => (
            <li key={worktree.path} className="truncate" title={worktree.path}>
              {worktree.branch ?? (worktree.detached ? "detached HEAD" : "no branch")}
              {" · "}
              {worktree.path}
              {worktree.prunable ? " · directory is gone" : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
