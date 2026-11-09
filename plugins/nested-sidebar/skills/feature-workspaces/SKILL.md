---
name: feature-workspaces
description: Work inside a Nest feature folder, where one piece of work spans several repositories as sibling git worktrees. Use when the working directory contains AGENTS.md with a "nest:begin" block, when the instructions say the thread is in a Nest feature, or when the user asks to add or drop a repository from the current work.
---

# Feature workspaces

A Nest feature is one folder for one piece of work. Each subfolder is a git
worktree of a different repository; new ones start on the feature's topic
branch `feat/<slug>`. The folder itself is **not** a git repository.

## Read first

`AGENTS.md` in the feature folder has two parts:

- the block between `<!-- nest:begin -->` and `<!-- nest:end -->`, which Nest
  rewrites whenever repositories change: the folder list, branches, install
  commands and working rules;
- everything outside it, which belongs to the user — the requirement,
  decisions, acceptance notes, progress. Read it; add to it when you learn
  something the next session needs. Never edit inside Nest's block.

`.nest-feature.json` is the same member list in JSON.

The block can be a few minutes stale. When it matters, call
`nest_feature_context` — it reads the folder as it is right now.

## Git

- Name the repository in every git command: `git -C tea-app-im status`. In the
  feature folder itself git finds nothing.
- Never `git init` the feature folder.
- Commit, push and open a pull request per repository.
- A new worktree has no dependencies installed. Run the install command listed
  in `AGENTS.md` inside that folder before building or testing.

## Bringing a repository in

Call `nest_feature_add_repos` with the bb project names, e.g.
`["tea-app-im-buy"]`. Do not run `git worktree add` yourself. The tool:

- refuses a branch that is already checked out elsewhere and says where;
- puts the worktree next to the others, starts it from the remote default
  branch, copies untracked `.env*` files and initialises submodules;
- updates `AGENTS.md`;
- is harmless to call again for a repository that is already there.

Pass `branch` only when the user wants an existing branch checked out instead
of the topic branch.

## Dropping one

Call `nest_feature_remove_repo` with the folder name, only when the user asks.
It removes the worktree, archives its threads and keeps the branch. It refuses
while the worktree has uncommitted or untracked files; pass `force` only with
the user's explicit agreement.

## When something is refused

| Answer | What to do |
| --- | --- |
| Branch is checked out at another path | Tell the user where; ask whether to use a different branch. |
| Folder already exists | Something is left over at that path. Ask the user before touching it. |
| Different machine | The repository's checkout is on another machine than the feature folder; it cannot join. |
| Not inside a feature | This thread runs elsewhere. `nest_feature_list` shows where each feature lives. |
