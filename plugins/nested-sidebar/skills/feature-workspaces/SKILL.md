---
name: feature-workspaces
description: Work inside a Nest feature workspace, where one task spans several repositories. Use when the task spans more than one repo, when the user names a feature, or when a feature directory contains NEST.md. Covers reading the feature context, adding a repository worktree, and keeping git operations scoped.
---

# Feature workspaces

A feature workspace is one directory that holds a task spanning several
repositories. Each repository appears as a git worktree inside it. The
directory is the working context. It is not a git repository itself.

## Read before acting

When you start inside a feature directory, read these two files first.

- `NEST.md` says what the task is, which repositories take part, and what
  each one is responsible for.
- `.nest-feature.json` is the machine-readable member list. It carries the
  feature id, the layout version, and for each member the repository, child
  directory, branch, and state.

Do not infer the member list from the folders you see on disk. A folder can
be left over from a removed member, and a planned member has no folder yet.
The manifest is the answer.

## Check current state

The manifest is a snapshot. Before you act on a member, confirm its state.

- Call `nest_feature_context` with the feature id when the tool is available.
  It returns each member's repository, branch, directory, and live state.
- If the tool is not available, run `git -C <child> status --short` and
  `git -C <child> branch --show-current` for the member you are about to touch.

## Add a repository

Call `nest_feature_add_workspace` with the feature id and the project or
repository. Do not run `git worktree add` yourself.

The plugin owns three things you would otherwise get wrong.

- It checks `git worktree list --porcelain` first. A branch that is already
  checked out somewhere else is refused, and the answer names where it is.
- It computes the child directory name from the manifest, so two agents cannot
  create two different layouts for the same feature.
- It runs the repository's setup hook, because a fresh worktree has no `.env`,
  no dependencies, and no initialized submodules.

The call is idempotent. Calling it twice for the same member returns the
existing worktree instead of creating a second one.

## Keep git operations scoped

The feature directory is not a repository. A `git status`, `git add`, or
`git commit` run there fails or, worse, finds an enclosing repository you did
not mean to touch.

Always name the child directory.

```sh
git -C console status --short
git -C console add -A
git -C console commit -m "message"
```

Never run `git init` in the feature directory. If the feature directory
becomes a repository, every child worktree turns into an embedded repository,
and a later `git add -A` records them as bare pointers with no contents.

## Finish the work

Each repository has its own branch, its own commit, and its own pull request.
There is no single commit or single pull request across the feature.

- Commit and open a pull request per child directory.
- Report the branch and pull request for each member you changed.
- Leave a member you did not change untouched.

## What each failure means

| Message | Meaning | What to do |
| --- | --- | --- |
| branch already checked out | Another worktree holds that branch | Use another branch name, or remove the other worktree first |
| directory already exists | A stale folder from an interrupted run | Inspect it, then remove it with `git worktree remove`, not `rm -rf` |
| member is dirty | Uncommitted changes in that child | Commit or discard them before removing the member |
| host mismatch | The member is on another machine | That member cannot be materialized into this feature directory |

Never delete a child directory with `rm -rf`. It strands the worktree metadata
in the source repository and silently loses uncommitted work.

## Bound the work

One agent session with write access to five repositories is how wrong-repository
edits happen. When a feature has several members that all need changes, do one
of these.

- Change one member per turn, and state which member you are in before editing.
- Delegate per repository to a child session, each started in that member's
  directory.

Reading across members is always fine. Writing across members in one turn is
what to avoid.
