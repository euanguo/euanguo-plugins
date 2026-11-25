# Harbor design

This document records the invariants behind the manual in
[docs/USAGE.md](USAGE.md). It describes why the sidebar is shaped this way; the
operational instructions remain in the usage manual and README.

## Why groups first

The sidebar's model is `group -> project -> worktree -> thread`. A group is a
named bucket above projects, and a project belongs to at most one group; the
project list is bb's project list, so every project gets a row even before it
has a thread. This keeps ownership legible before conversations are drawn and
lets a project or worktree outlive the work currently running in it.

**All** and **Ungrouped** are scopes, not groups: they cannot be named,
reordered, removed, or filled with projects. Ungrouped appears only when groups
exist and it has a project, so it is never a second All or an empty destination.

## Stable order

Projects and complete root/child families stay where the user puts them. Drag
uses existing row affordances, keyboard reordering uses the same focus targets,
and the arrangement is kept on the server so it follows clients and reloads.
Children remain attached to their root families, and pinned roots retain their
leading partition.

Sorting pauses during search, filtering, or bulk selection, so hidden rows are
never moved implicitly. Worktree order is stored without a sort lens over it;
new or unseen worktrees land after the known ones by label rather than at the
top. Time- and name-based sorts are lenses over the stored manual order, so
switching back restores that order untouched.

## Derived ownership

A project record is bookkeeping and can be wrong; a repository is a fact on
disk. Workspace ownership therefore defaults to **Filesystem**: the project
checkout anchors same-repository worktrees, a directory inside the anchor
belongs to the nearest project source, and ambiguous or unreadable claims are
reported rather than guessed. `bb claims` restores bb's stored ownership when it
was deliberate.

When repository grouping is on, projects whose workspaces resolve to the same
repository are drawn as one row. Nothing is written back to bb: the original
records and ids remain intact, so turning the switch off restores bb's answer
exactly. This is a virtual repair, not a database rewrite.

## Two modes

**Threads** and **Workspaces** hold the same tree and never move rows between
owners. The mode changes only where conversations are drawn: Threads expands a
workspace into thread families and keeps Pinned above the tree; Workspaces stops
at the workspace and draws its conversations as tabs under the thread header.
In Workspaces mode a pin leads the workspace's tab strip instead of moving the
workspace row.

## Stored and derived

Group membership, workspace aliases, manual order, feature metadata, and
palette choices are stored by Harbor. Repository identity, workspace kind, and
tree ownership are derived from bb records and the filesystem each time they
are needed, so a wrong record can be compensated for in the view without
corrupting bb's source of truth.

Browser-local view state covers the selected tab, filter, open shelves, and
manual expand/collapse choices. Server-stored order and sort modes are shared
across clients. This split prevents one client's navigation from becoming
another client's data.

## Palette

State is never communicated by colour alone. Every family reports **Failed**,
**Needs you**, **Working**, **Unread**, **Inactive**, or seven-day **Stale**
with a label, a distinct shape, animation or motion cue, accessible help, and a
customizable semantic colour.

The palette exposes eighteen semantic roles for thread state, activity, and
pull-request state. Presets provide Default, High contrast, and
Colorblind-friendly choices; Custom is the only mode that reads individual
colours, and changing one switches to Custom rather than storing a value a
preset would override.

## Security and storage

Harbor stores its own shelves and feature metadata in the plugin's bb database;
the browser caches view state and working-since clocks under
`harbor:v1:*` and `bb.harbor.*`. bb removes the plugin database on uninstall but
does not clear web storage.

Agent tools default on, but their safety comes from shape as well as defaults:
reads cannot change state, reversible writes act one row at a time, destructive
writes require a second acknowledged call, and irreversible deletes also require
a name. Reordering is not exposed to agents because concurrent list edits would
need a revision protocol. Turning a tool off removes it from new sessions and
refuses it in already-running sessions, so both gates hold.

Removing a worktree separates the reversible archive-and-release step from the
irreversible directory deletion. The disk deletion starts off, requires an
acknowledgement beside an exact loss list, and is based on the server's fresh
reading rather than the dialog's cached numbers.
