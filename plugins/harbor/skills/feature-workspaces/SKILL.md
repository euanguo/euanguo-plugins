---
name: feature-workspaces
description: Work inside a Harbor feature folder, where one piece of work spans several repositories as sibling git worktrees, each on its own branch. Use when this thread runs in a feature (its AGENTS.md carries a harbor:begin block), or when the user asks to change which repositories a feature holds, restart a finished one, or open work in another of its repositories.
---

# Feature workspaces

One Harbor feature is one folder for one piece of work. Each subfolder is a git
worktree (or read-only `ref` symlink) of a different repository, on its own branch.
The folder itself is **not** a git repository. This skill is offered only to a
thread running inside that folder when **Agent Access** is enabled (`read-only`
or `full`). A thread outside a feature still gets the global Harbor tools
(`harbor_sidebar_map`, `harbor_feature_list`, and in `full` tier
`harbor_feature_lifecycle`, `harbor_sidebar_organize`, `harbor_thread_spawn`,
`harbor_admin_delete`), but not the feature-inside tools (`harbor_feature_brief`,
`harbor_feature_git_status`, `harbor_feature_meta`, `harbor_feature_repos`).

## Read first

`AGENTS.md` in the feature folder is the source of truth. Its **managed block** —
between `<!-- harbor:begin -->` and `<!-- harbor:end -->` — lists every repository
folder, its branch, its install command and the working rules, plus the
requirement digest: the goal, acceptance criteria, open questions, references,
and the decisions that still stand. Harbor rewrites the block whenever those
change. Everything outside the block belongs to the user: free-form notes and
progress. Read it, and add to it what the next session needs. Leave the managed
block to Harbor.

`.harbor-feature.json` is the same member list as JSON, with the feature id, slug
and suggested branch. Use it when a call needs those values.

The managed block can lag behind recent changes in sibling worktrees. Before
touching repositories in the feature, make a **live read** with
`harbor_feature_git_status`: it returns the per-repository role (`[worktree]` vs
`[ref read-only]`), branch, upstream ahead/behind counts, changed/untracked
file counts, diff stats, and nested submodule state.

## Working across repositories

- Run every git command as `git -C <folder> …`, commit and open a pull request
  per repository. The feature folder has no repository of its own.
- Never edit files inside a `[ref read-only]` folder; reference repositories are
  shared symlinks for reading context across repos.
- A new worktree arrives without dependencies. Run the install command the
  managed block lists for that folder before building or testing.
- To work in another writable repository of the feature, start a thread there
  with `harbor_thread_spawn`: pass `prompt`, set `folder` to the member folder
  (or omit `folder` for the feature folder itself), and optionally pass
  `title`, `project`, or `as_child` (`true` by default).

## The requirement and the decisions

The managed block is a digest. When the task depends on the full reasoning, call
`harbor_feature_brief`: it returns the goal, non-goals, acceptance, open questions,
blockers, every reference, and the **whole** decision log with each record's
rationale and rejected alternatives (including drafts).

When a question is settled, call `harbor_feature_meta` with `action: "decide"`,
`title`, `choice`, and optional `rationale`, `alternatives`, `impact`, and
`supersedes` seq. It is saved as a **draft**; it is not an active decision until
the user confirms it in **Feature Hub → Decisions**. Do not describe a draft as
decided.

Use `harbor_feature_meta` with `action: "link"` (`url`, `ref_id`, `title`,
`kind`) to attach a ticket, design document, or link when the user names it; do
not invent an id.

If something is unresolved, say so in the reply. Open questions and blockers are
the user's to file in **Feature Hub → Overview**; there is no tool that writes
them.

## Changing the feature

Tools taking an `environment_id` or `feature_id` want an id from
`harbor_sidebar_map` or `harbor_feature_list`, not a name two projects might share.
Inside a feature folder, omit `feature_id` — the tool finds the feature from
this thread's path. Only mutate feature state when the user asks, and remember
that write tools require **Agent Access** set to **Full control**.

### Bring a repository in

Call `harbor_feature_repos` with `action: "add"`, `repositories` (bb project
names or ids), and `role`:

- `role: "worktree"` *(default)*: checks the branch is free, places the worktree
  beside the others from the default/base branch, copies untracked `.env*` files,
  initialises submodules, and rewrites the managed block. Calling it again for a
  repository already present is harmless. `branch` applies to every repository
  in that call (omit `branch` for the suggested `feat/<slug>`).
- `role: "ref"`: attaches a repository's primary checkout as a read-only symlink
  (`ref`) for inspection without creating a branch or worktree.

Read the result: every repository comes back `created`, `reused` or `blocked`
with a reason. For each `created` worktree folder, run its install command. A
`blocked` repository is one the user decides about — see below.

### Take one out

Call `harbor_feature_repos` with `action: "remove"`, `folder`, and only when
the user asks. Removing a member takes two calls:

1. Call first with `acknowledged: false` (default) to preview the removal. Show
   what will be removed (`folder/`, worktree, and archived threads) to the user.
2. Call again with `acknowledged: true` after explicit confirmation.

Its branch is kept. Removing a dirty worktree refuses unless `force: true` is
explicitly agreed to by the user.

### Create, rename, park, promote, adopt, reopen, delete

Use `harbor_feature_lifecycle` (`action`):

- `create`: `name`, optional `repositories`.
- `rename`: `name` (changes the display name; folder slug and branches stay).
- `park` / `unpark`: park a waiting feature (`reason`, `note`, `wake_at`,
  `wake_on_activity`) without deleting worktrees or archiving threads, or wake it.
- `promote`: turn an existing single-repo workspace into a multi-repo feature
  (`name`, optional `environment_id`, `repositories`, `base_branch`).
- `adopt`: file an outside worktree under `feature_id`, or pass
  `feature_id: null` to release it (a worktree physically inside the feature
  folder belongs to it by path).
- `reopen`: return a finished feature to Active (re-add repositories with
  `harbor_feature_repos` before resuming code work).
- `delete`: takes two calls. Call first with `acknowledged: false` (default) to
  preview what will be removed, show the user, then call again with
  `acknowledged: true`. `delete_branches: true` also removes branches created by
  Harbor; pre-existing branches survive.

## When a call is refused

| Answer | What to do |
| --- | --- |
| Branch checked out at another path | The tool names where. Pick a different `branch`, or ask the user. |
| Folder already exists | Something is left on disk at that path. Ask the user before touching it. |
| Repository on another machine | Its checkout is on a different host than the feature folder; it cannot join. |
| Name matches several projects, or branch name is invalid | Pass the exact id, or a valid branch name. |
| Not inside a feature folder | Use `harbor_feature_list` to find the folder, pass `feature_id`, or ask for a thread inside the feature. |
| Tool unavailable or disabled by tier | Ask the user to set **Harbor Settings → Agent & Features → Agent Access** to **Full control** (for edits) or **Read-only** (for reads). |
