---
name: feature-workspaces
description: Work inside a Nest feature folder, where one piece of work spans several repositories as sibling git worktrees, each on its own branch. Use when this thread runs in a feature (its AGENTS.md carries a nest:begin block), or when the user asks to change which repositories a feature holds, restart a finished one, or open work in another of its repositories.
---

# Feature workspaces

One Nest feature is one folder for one piece of work. Each subfolder is a git
worktree of a different repository, on its own branch. The folder itself is
**not** a git repository. This skill is offered only to a thread running inside
that folder; a thread elsewhere gets the feature-wide tools (`nest_feature_list`,
`_create`, `_reopen`, `_delete`) but not the ones that act on the folder it is
in.

## Read first

`AGENTS.md` in the feature folder is the source of truth. Its **managed block** —
between `<!-- nest:begin -->` and `<!-- nest:end -->` — lists every repository
folder, its branch, its install command and the working rules; Nest rewrites it
whenever the members change. Everything outside the block belongs to the user:
the requirement, decisions, acceptance notes and progress. Read it, and add to
it what the next session needs. Leave the managed block to Nest.

`.nest-feature.json` is the same member list as JSON, with the feature id, slug
and suggested branch. Use it when a call needs those values.

The managed block can be a few minutes behind another agent's change. Before
touching a repository you have not looked at, make the **live read** with
`nest_feature_context`: it returns the folder, whether this thread sits in the
root or in a member, and every worktree with its current branch.

## Working across repositories

- Run every git command as `git -C <folder> …`, commit and open a pull request
  per repository. The feature folder has no repository of its own.
- A new worktree arrives without dependencies. Run the install command the
  managed block lists for that folder before building or testing.
- To work in another repository of the feature, start a thread there with
  `nest_thread_spawn`: pass its folder as `folder`, or omit it for the feature
  folder itself. The new thread is a child of this one by default.

## Changing the feature

Tools taking an `environment_id` or `feature_id` want an id from
`nest_sidebar_map` or `nest_feature_list`, not a name two projects might share.
Inside a feature folder, omit `feature_id` — the tool finds the feature from
this thread's path. Call a tool only for the change the user asked for.

### Bring a repository in

`nest_feature_add_repos` with the bb project names or ids. The tool checks the
branch is free, puts the worktree beside the others, starts it from the remote
default branch, copies untracked `.env*` files, initialises submodules and
rewrites the managed block. Calling it again for a repository already present
is harmless.

`branch` applies to every repository in that one call. Each repository may keep
its own name or an existing branch, so call once per convention; omit `branch`
for the feature's suggested `feat/<slug>`. Read the result: every repository
comes back `created`, `reused` or `blocked` with a reason. For each `created`
folder, run its install command. A `blocked` repository is one the user decides
about — see below.

### Take one out

`nest_feature_remove_repo` with the folder name, only when the user asks. It
removes the worktree, archives its threads and keeps the branch. It refuses
while uncommitted or untracked files are present; `force` discards them and
needs the user's explicit agreement.

### Rename, adopt, reopen

- `nest_feature_rename` changes the name people read. The folder slug and every
  repository's branch stay as they are.
- `nest_feature_adopt` files a worktree that lives outside the feature folder
  under this feature, or releases it with `feature_id: null`. A worktree already
  inside the folder belongs to the feature by its path and cannot be re-filed.
- `nest_feature_reopen` returns a finished feature to the active list. Finishing
  archived its threads and took its worktrees back, so add the repositories
  again with `nest_feature_add_repos` before work resumes.

### Delete

`nest_feature_delete` takes two calls. The first, without `acknowledged`,
states what it would remove and refuses to act. Show that to the user, get
their confirmation, then call again with `acknowledged: true`.
`delete_branches: true` also removes the branches Nest created for the feature;
branches the user brought in survive.

`nest_feature_create` starts a different feature, only when the user asks for
one. `nest_feature_list` shows where each feature lives when a thread is not in
the one the user means.

## When a call is refused

| Answer | What to do |
| --- | --- |
| Branch checked out at another path | The tool names where. Pick a different `branch`, or ask the user. |
| Folder already exists | Something is left on disk at that path. Ask the user before touching it. |
| Repository on another machine | Its checkout is on a different host than the feature folder; it cannot join. |
| Name matches several projects, or branch name is invalid | Pass the exact id, or a valid branch name. |
| Not inside a feature folder | Use `nest_feature_list` to find the folder and ask for a thread there. |
| Tool says its feature is turned off | Ask the user to enable `Agents · Work in features` in the plugin's settings. |
