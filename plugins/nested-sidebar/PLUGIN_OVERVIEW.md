## What you get

Nest replaces bb's scrolling thread list with a project-first sidebar. Your work
stays in one place while the threads underneath it change state.

```text
group -> project -> worktree -> thread
```

A **group** is the coarsest level: work, personal, a side project. A **project**
sits inside it, and a project's own checkout and every worktree of it are rows
of their own. A thread family — the root thread and the agents it spawned —
sits under the workspace it runs in, and expands inline. Activity never
reorders what you are looking at, so a thread starting work does not move the
row you were about to click.

## Attention, rolled up

Each row reports the worst thing under it. A project whose child agent failed
shows a failure without being open; a group with unread work shows it in the tab
strip. Six states are distinguished: working, needs you, unread, failed,
inactive, and stale. Working threads say what they are doing — runtime,
workflow, agent, command, plan, or goal.

Two email verbs clear the list. **Snooze** a thread until a time you pick, or
**settle** it when the work is done. Both shelves collapse to one counted
header, and settled work reaches back 24 hours.

## Colour

Eighteen semantic colours cover thread state, activity, and pull-request state.
Three presets are ready — Default follows your theme, plus High contrast and
Colorblind-friendly — and Custom lets you set each colour. Every colour is drawn
as the thing it colours: click a swatch to open the picker, or type the hex.

## Projects and workspaces

A project badge colour is derived from the project's ID, so renaming a project
does not change its identity, and you can override any of them. Nest reads the
repository each workspace really belongs to from the machine holding it, which
is how it can tell you about a worktree another tool created and bb has no
environment for, or a project filed against the wrong repository. That report
is read-only: bb cannot move a worktree between projects.

Workspace ownership follows the filesystem by default — a checkout and its
worktrees stay together even when an environment record claims another project —
and can be returned to bb's own assignment at any time without touching stored
data.

## Agents

Nest can tell an agent what your sidebar actually looks like, so it does not
build a second project for a worktree that already has one. Reading is on by
default. Writes are off: letting an agent file a project into a group, create or
rename a group, or set a workspace alias each has its own switch, and every one
of them changes only the filing.

## Requirements

bb 0.36 or newer. No account, no network request, no external service. Nest uses
bb's experimental thread-list slot, so a bb release can change the surface it
draws into. Settings live in bb's own store; nothing is written outside the
plugin's directory.
