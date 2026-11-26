## Usage

Installing does not change your sidebar by itself. Open **Settings → Appearance → Sidebar → Harbor** to enable it.

bb's own list stays the default, and comes back the moment you switch away or
disable the plugin.

### Groups

A **group** is a named bucket above projects, and it is the first level of the
tree: `group -> project -> worktree -> thread`. A project belongs to at most one
group; a project in no group lands in **Ungrouped**. Pick a group from the
horizontal strip above the tree (`All | Group A | Group B | Ungrouped`), or open
the folder button there to create, rename, reorder, and delete groups. Deleting a
group only releases its projects back to Ungrouped -- it never removes a project
or a thread.

The folder button opens the manager; a group's own row menu carries the same
decisions for the row you are looking at -- **Rename…**, **Copy group ID**,
**Move up** / **Move down**, and **Remove group**.

The strip is a **scope selector, not a second tree**: choosing a group narrows
what the tree below draws, and projects are still the first level inside it.
**Ungrouped** earns its tab: it appears only once groups exist, and only while it
holds a project, so it is never a second copy of **All** and never a destination
to an empty list. A project filed out of its last group brings it back, and a
selection left on it falls back to **All** rather than scoping the tree to
nothing.

**All** and **Ungrouped** are not groups -- they take no name, cannot be
reordered or removed, and hold no projects -- but they do take an icon, chosen
from the same picker in the group manager. The icon is what the compact strip
draws when it is too narrow for labels, which is the only place any tab's icon
shows; the Ungrouped icon also titles the Ungrouped section in the tree.

An icon is **one emoji**. The picker offers a short grid of them and takes a
typed one for anything not on it, because a group is a row in a sidebar and a
row needs a glyph, not an icon library: the 6,025-name catalogue this used to
draw from cost a 6.9 MB artwork file served over its own RPC, a batching loader
in the frontend, and a round trip per icon. A row written by an older build
keeps its meaning — the Hugeicons name it stored is mapped onto the emoji that
says the same thing.

### Workspaces and worktrees

The workspace level appears **only when a project's threads occupy more than one
physical workspace**. A project whose threads all sit in one checkout stays flat,
exactly like bb's own sidebar. Harbor identifies a workspace by host, physical
owner, and normalized real path. Environment IDs are records that point at a
workspace; they are not the workspace's identity, so duplicate bb records for
one directory are folded into one row.

**Projects · Workspace ownership** defaults to **Filesystem**. Each project's
configured source path is its anchor: the exact source is the project checkout,
same-repository worktrees stay under that project, and a directory inside the
anchor belongs to the nearest project source. A repository without a remote
falls back to its shared `.git` directory; a plain directory falls back to its
physical path. When several projects claim one repository, Harbor keeps the
claiming project unless one source is the repository's main checkout, and
reports the ambiguity instead of guessing.

`bb claims` restores bb's stored `environment.projectId` ownership exactly.
This is the escape hatch for records deliberately filed across projects.

Rows explain what they represent: **Project checkout**, **Git worktree**,
**Nested checkout**, **External checkout**, **External directory**, or
**Unresolved workspace**. The project checkout label is used only when both the
path and host match the project's configured source. A submodule or repository
inside the project anchor is a nested checkout. A directory from another
checkout, a stale record, or incomplete metadata cannot silently become an
unqualified main row; it is shown with its path and a diagnostic instead.
Worktree rows carry the environment's display name — the alias you set from the
row's own rename action — beside or under the branch it was typed against, and
are collapsed by default, because with many worktrees the point is to make them
navigable rather than to show them all at once. A child agent never splits from
its parent: families hang under the workspace of their **root**.

Worktrees use active-first two-tier disclosure (`classifyWorktreeTier`): the
project's main checkout, the active workspace, any worktree holding open thread
families or open pull requests, any worktree with a custom alias or saved manual
order, newly created worktrees (< 24h), and recently active unmanaged worktrees
(< 7d) stay visible in the primary tier. Older idle worktrees with zero open
families collapse into a single summary row (`▸ N inactive worktrees`) under the
project, paired with a **Batch Prune** safety survey dialog (`Clean up…`) to
inspect dirty/unpushed counts and remove idle or dangling worktrees safely.

A workspace row's menu starts a thread there, copies its path, branch and
environment ID, and archives every thread family under it. It offers rename
using workspace wording where the row is not a Git worktree. **Remove
worktree…** is available only for a confirmed Git worktree, so an external
checkout or the project's own checkout cannot accidentally enter the worktree
deletion flow.

The project's own checkout leads the project and cannot be dragged: it is where
the project is, and it is the one row that is always there. The worktrees
beneath it can be: drag a worktree row to sort it, or focus one and press
Alt+Up/Alt+Down. That arrangement is stored on the server like the project and
family ones, and unlike them it has no sort lens over it — what is stored is
always what is drawn — so a drag only waits for the same things they do: no
search, the All filter, and no bulk selection. A worktree the arrangement has
never seen, one just created or created on another machine, lands after the ones
it knows, by label, rather than at the top.

**Remove worktree…** is the one destructive thing the sidebar offers, so the
dialog is built around the fact that a row stands for three things and only one
of them is irreversible. Threads archive and bb's environment is released —
both of which come back — and that half always runs. The directory on disk is a
checkbox that starts off, and it stays off until an acknowledgement is ticked
next to a list of exactly what would be lost: uncommitted files, untracked files,
commits the branch has that its base does not, terminals still open here, and who
else keeps a record of the directory. A box rather than the directory's name
typed out, because a path is long enough to paste without reading. Nothing can be
submitted while that is unmet, and the server takes its own reading of the
workspace before it acts, so the dialog's copy of the numbers is never what the
decision is made on.

The directory itself is removed with `git worktree remove` on the machine that
owns it, so the main repository does not keep a record of a directory that is
gone; only when git refuses — the path was never a worktree of that repository,
or git is not installed — does bb delete it plainly, and the dialog says which
of the two happened. bb does not have to own a directory to remove it, but the
dialog says when one came from somewhere else, because the tool that created it
will go on listing it. The project's own checkout cannot be removed at all: the
menu offers the reversible half there and nothing else.

**Worktree label** in Settings (`Sidebar & Layout`) decides how the row spends its
width: **Alias first** (`alias-over-branch`, the default) stacks the alias above
the branch, **Both** (`alias-and-branch`) keeps both on one line, and **Branch
only** (`branch-only`) shows only the branch. Whichever half a worktree does not
have — an alias cleared, an environment bb never gave a branch — the row draws
the one it does, so no row grows an empty line, and an alias that already reads
as its branch is drawn once.

### The repository axis

A project is a **record**, and a record can be created wrong — by a person in a
hurry, or by an agent asked to "set up a project" that makes one for a worktree
instead of an environment in the project that already owns it. A repository is
not a record: two checkouts of it share one `.git`, and no amount of bad
bookkeeping changes that. So Harbor reads the second axis off the disk.

**Group threads by repository** (off by default, available in the view menu and
Settings) draws one repository as one row. When it is on, projects whose
workspaces resolve to the same repository are merged into the single row the
first of them already occupied: the first project's name, group, colour, icon
and position, with the others' families and workspaces on it. Nothing is written
back. The merged projects keep their own records, so turning the switch off
restores bb's own answer exactly, and un-merging costs nothing.

A repository is identified by its **remote** where it has one, because that is
the only identity two machines agree on — the same repository cloned on a laptop
and a server shares a remote and nothing else, and keying on the local `.git`
path would draw one repository twice. Without a remote it falls back to the
directory, which is honest: that names one place on one machine. Every spelling
of one remote lands on one key — `https://`, the `git@host:owner/repo` form, a
port, credentials, a trailing slash, the `.git` suffix — and two forks of one
repository stay apart.

Every workspace is resolved to the directory it *really* is, not the string bb
recorded. `/var` and `/private/var` are one directory on macOS, a symlinked
worktree is the directory it points at, and two environment records for one path
are one row. Only the machine that owns a path can answer that, so the read is a
single call per machine covering every workspace at once. It does not run `git`:
the answers are already written in `.git`, which means a machine without git
still gets an answer and one call covers a whole sidebar instead of one process
per repository.

Because the repository's own record is read, Harbor can see **worktrees bb does
not know about** — a worktree another tool created, or one whose environment was
removed while the directory stayed. They remain visible in **Harbor Settings →
Diagnostics** (never mixed with Feature-owned worktrees), and the tree hides
them by default. Turn on **Show unregistered worktrees** to draw them under
their owning project with a `+`. Starting a thread there creates bb's environment
at the real path under the owning project; it does not require a second project.

**Diagnostics** in Harbor Settings (carrying a live badge when findings exist)
lists what each machine reported: every repository, how many workspaces it holds,
dangling/missing worktree records, stale worktrees (>14 days), one-click
unseen-worktree activation, a `git worktree prune` copy helper, and the
ownership disagreements Harbor detected:

| What it found | What it means |
| --- | --- |
| One repository, several projects | bb filed one repository under more than one project. With repository grouping on they are drawn together. |
| One project, several repositories | One project has workspaces in two repositories — usually a thread started in a subdirectory of a checkout. |
| Workspace in another repository | A workspace is not in the repository its project points at. |
| Worktree bb does not know | The repository records a worktree no environment points at (and outside any Feature folder). |
| Two records for one directory | Two environment records resolve to one path. They are drawn as one row. |
| Path could not be read | The machine did not answer, or the directory is gone. The row is drawn from its path alone, unverified. |
| Path spelled differently | bb's path and the filesystem's disagree. The resolved one is used. |

This is a **virtual repair**, not a database rewrite. Current bb offers no public
operation that changes an environment's or thread's project, so Harbor preserves
the original ids and claims while drawing each workspace under its derived
owner. The conflict remains visible in the panel. A machine that never answers
costs derived ownership for its rows and nothing else: those rows fall back to
bb's claimed project and are marked unverified.

### Features: the requirement and the decisions

A **feature** is one piece of work across repositories, living in one folder
whose subfolders are writable worktrees or read-only `ref` symlinks. Switch the
top **Features | Projects** bar to **Features** to browse Active, Parked, and
Finished features; clicking a feature or opening **Feature Hub** opens the single
canonical four-tab cockpit (**Overview**, **Changes**, **Repos**, and
**Decisions**):

- **Overview**: requirement (goal, non-goals, acceptance), open questions,
  blockers, external references (tickets, docs, links), and **Park & Wake**.
- **Changes**: cross-repo **Delivery Matrix** with writable vs `ref` roles,
  dirty/unpushed indicators, batch push for clean ahead repos, and direct handoff
  into BB's native Git diff/commit panel.
- **Repos**: attach writable repository worktrees or read-only `ref` symlinks,
  apply/save feature presets, or remove members.
- **Decisions**: append-only decision log and confirmation of agent-recorded
  drafts.

The decision log is append-only. A confirmed decision is never edited; changing
your mind records a new decision that supersedes the old one, and the old one
stays with its reasoning. A record an agent makes arrives as a **draft** and
waits for your Confirm in **Feature Hub → Decisions**. The goal, acceptance,
open questions, references, and active decisions are written into the folder's
`AGENTS.md` managed block on every change, so every conversation in the feature
starts knowing them.

### What agents can see and do

An agent creates most of what the sidebar organizes — projects, worktrees,
threads — and until Harbor it knew nothing about the layer that files them.
Groups, a project's group, a workspace's alias: all of it lives in Harbor's
database and was invisible from a thread.

Two mechanisms bridge that cleanly without overwhelming the context window:

**Every enabled thread gets a compact structure summary.** When Agent Access is
`read-only` or `full`, Harbor appends a short summary of the groups, the project
the thread is running in, its repository, its workspaces with branches and
aliases, and any unregistered worktrees — strictly capped at 3,500 characters
(< 1,000 tokens). When truncated, it drops other projects first, then
unregistered worktrees, keeping the current project context last. When Agent
Access is `off`, Harbor contributes `null` instructions and zero skills.

**A consolidated 10-tool surface handles the rest.** Rather than exposing 10
per-feature toggles and dozens of granular endpoints, Harbor exposes a single
three-tier **Agent Access** selector under **Harbor Settings → Agent & Features**
(stored as `agentAccess:v1`, defaulting to **`read-only`**). See
[Agent access](../README.md#agent-access) for the complete 10-tool table.

- In **`read-only`** *(default)*, agents can inspect global structure and
  feature lists (`harbor_sidebar_map`, `harbor_feature_list`), plus live feature
  briefs and multi-repo git status inside features (`harbor_feature_brief`,
  `harbor_feature_git_status`). Zero mutating tools are registered or callable.
- In **`full`**, agents additionally receive the 6 mutation and lifecycle tools
  (`harbor_feature_meta`, `harbor_feature_repos`, `harbor_feature_lifecycle`,
  `harbor_sidebar_organize`, `harbor_thread_spawn`, `harbor_admin_delete`).

Every destructive action in `full` mode stays guarded:

- `harbor_feature_meta` (`action: "decide"`) always records a **draft**; only
  the human can confirm it inside **Feature Hub → Decisions**.
- `harbor_admin_delete`, `harbor_feature_lifecycle` (`action: "delete"`), and
  `harbor_feature_repos` (`action: "remove"`) refuse on the first call,
  previewing exact affected items, and act only when a follow-up call passes
  `acknowledged: true` (`project_delete` also requires exact `expected_name`).
- Manual list ordering is never exposed to agents, so ordering requires no
  conflict-resolution protocol.

Turning Agent Access down removes disallowed tools from `configure()`, rejects
in-flight sessions at runtime in `registerTool`, and keeps instructions 100%
synchronized from one canonical table (`lib/domain/agent-access.ts`).

`bb harbor status` (and `bb harbor status --json`) reports the live tier, exposed
tools, and indexed counts:

```text
access: read-only
tools (4): harbor_sidebar_map, harbor_feature_list, harbor_feature_brief, harbor_feature_git_status
index: 11 projects, 2 groups, 9 repositories, 2 findings
```

### Status that bubbles up

Every folded row -- group, project, or worktree -- reports what is underneath it
with one dot and a count: `2 needs you / 1 working`. The order is deliberately
`failed > needs you > working > unread > inactive > stale`, so **needs you**
outranks **working**: a folded row is skimmed, not read, and a blocked thread is
the one that must not hide. The badge is also a **jump button** -- click it to go
straight to the thread that produced the state, instead of expanding the branch
and hunting for it.

### New threads start from a row

Every project row and every worktree row opens a modal seeded
from that row: the project is filled in, and a worktree row additionally seeds
that exact environment. The seed is a seed, not a lock -- the project picker stays
editable, and the environment picker can still be aimed at another worktree or at
a **newly created** one from inside the dialog. Submitting spawns the thread
through the plugin, so it is attributed to Harbor on the thread itself.

### Project row actions

The project row keeps **one** trailing control. At rest it is the disclosure
chevron; on hover or focus it becomes a three-dot menu, so the row costs no extra
icon and the chevron is never a second, redundant affordance. The menu holds
everything you can do to a project:

- New thread
- Collapse / Expand
- Rename…
- **Move to group** -- a second-level menu, since membership is a rarer decision
  than acting on the project itself
- Project settings
- Copy project ID
- Remove project… (asks you to type the name; deletion is recursive)

### Row density and compact markers

The sidebar is the scarcest surface in bb, so rows avoid redundant framing and
follow four focused display controls under **Harbor Settings → Sidebar & Layout**:

- **Row density** — *Detailed* (default) gives each family a branch, relative
  age, PR state, and child-count metadata line below the title; *Compact* keeps
  each row on a single line with title, status, and quick actions, leaving rich
  branch/time details to the hover card.
- **Status indicator** — *Color dot* (default) draws a compact animated dot,
  while *Icon* renders distinct per-state shapes. The state's name always lives
  in the tooltip and screen-reader label.
- **Default subthreads** — *Expanded* (default) or *Collapsed* sets initial
  disclosure for inline child agents (search still reveals matching children).
- **Show quick actions** — toggles hover pin, snooze, and settle buttons on
  rows while keeping every action in the row context menu.

Rollups on folded rows follow the same rule: a coloured dot plus the count
(`● 2  ● 1`) instead of `2 needs you · 1 working`, most urgent first. The
wording is still in the tooltip and the accessible label. A family's own
collapsed row draws the same breakdown, so a folded branch says how much of what
is under it rather than only that something is.

A row also carries a **subagent** count when the agent is running helpers inside
its turn, as a badge separate from the child-thread disclosure. They are
different things — a fork is a thread under this one, a subagent is activity on
it — and one merged number would say a thread has four children when it has one
child and three helpers.

### Pinned

Pinned threads gather in a **Pinned** section above the tree, from every project,
and leave their own project's list so nothing is drawn twice. The order is bb's
own: a pin moved in bb's built-in sidebar is in the same place here, and dragging
a pinned row writes that same order back. Alt+Up/Alt+Down moves one position from
the row's status icon.

The section obeys search and the filter and **ignores the group tab**, which is
deliberate: a pin that vanishes because you are looking at another group is the
one thing a pin is for.

The way back out is the row itself: the pin on a pinned row is its own unpin, and
pressing it drops the thread back into its project at the place bb's order says.

The Pinned section exists only in the Threads mode. The Workspaces mode draws no
conversation rows to lift out of a project, so a pin there does not move any
workspace: the row stays under its project. Pinned conversations instead lead
that workspace's tab strip, in bb's pin order, and the strip's pin is the way to
set and clear one.

### Projects and parked shelves

- **Projects** — drag an existing project header to sort projects, or focus the
  same header and press Alt+Up/Alt+Down. No extra drag icon is added, and the
  project order survives reloads. It is kept **per group**, because the tree is
  `group -> project`: a project sorts inside the group it belongs to, and a
  cross-group drop is refused rather than quietly changing the project's group —
  use **Move to group** for that. Pinned roots remain first inside each project.
  Drag a family's semantic status icon, or focus it and press Alt+Up/Alt+Down, to move
  a complete root/child family inside its pinned or unpinned partition. The
  family order survives reloads. Clear search, choose the All filter, exit bulk
  selection, and pick the **Manual** sort before sorting so hidden rows are never
  moved implicitly.
- **Snoozed** — hidden until the wake time you chose. A snoozed thread comes back early if it starts working or asks you something.
- **Settled** — work you are done with, collapsed to one line and shown for 24 hours. Settling also **archives the thread in bb**, so every other surface agrees, and new attention un-settles and unarchives it. After a day the row stops being drawn but stays archived.

An empty shelf disappears.

### Archived threads under a project

A project's own menu carries **Show archived threads**. Turn it on and that
project's newest ten archived threads appear under its list, dimmed, with the age
that matters — when you last worked on them. Clicking one reads it **without
unarchiving it**, so looking costs nothing; the restore button on the row is what
takes bb's archive off.

It is per project and per browser, off by default, and bounded: a shelf is for
recognising a thread you remember, not for browsing the archive — bb's own
archived view is that. A project with nothing archived draws no shelf at all.

### Long lists

A project's thread list, a worktree's thread list, and the settled shelf each
draw **five rows** and offer **Load more** for the rest, so a project with
twenty-six threads is not a wall of text. Once a list has more than one page
drawn it also offers **Show less**, beside Load more, which puts the whole list
back to its first page in one click rather than one page at a time. **Rows per
page** in Settings sets the page for all three (1–100). The row you have open
keeps its place whatever the page, a list that is `No threads yet` still says so
rather than claiming to be empty because of the page, and **a search draws every
match** — results the list is holding back are the one case where a page works
against you, so both controls step aside while a search is running.

### Motion

Rows move with the order rather than jumping to it: a reorder, an insert, a
remove and a shelf opening or closing all transition over 150ms. **Expand and
collapse are the same animation** — a group, a project, a worktree, a thread's
inline agents, and a parked shelf all open and close by taking their rows out of
their own list and putting them back, so each row enters and leaves exactly the
way a loaded page does. There is one mechanism, not two: the box follows its
rows rather than gliding to meet them, and a closed list is empty rather than
hidden, so its rows are unmounted and stop running their own lookups. A
collapsed list also drops its connector line and padding, because a border on a
zero-height element paints a stub. The settle button lifts, tilts its tick and
throws a five-point sparkle. Every one of those is suppressed under
`prefers-reduced-motion`, which the rest of the sidebar honours too — the
spinner and the shine on a working thread are the only motion left, and they are
what says the work is still alive.

A thread that is working says how long it has been: **Working · 5m**. The host
reports that a thread is working, not since when, so Harbor keeps its own clock —
stamped on the first render that sees the thread work, cleared when it stops, and
carried across a reload. A pause for a question ends the stretch, so the number
answers the question you actually have: how long since you last had to look.

### Cards

Root rows are a **card, not a box**: one rounded tint at `rounded-md px-2.5 py-2`
that moves with hover and with being open, the way bb's own list draws a row. There
is no outline around a family and no second panel inside it. The title leads at
`text-sm` and owns the full width of its line.

Under it, one line carries the branch: the **branch icon and name on the left,
truncating**, and at its right end everything that is not a word — the pin, the age
or the park buttons, the PR number, the children chip, and the provider mark. bb's
card ends its branch line the same way; Harbor used to keep those in a second column
beside the two lines, which spent width on a vertical run of glyphs and squeezed the
title into what was left. Nothing the pointer adds is drawn after something that
stays: the pin leads the cluster, and the two things hover changes — the age
becoming the park buttons, and the pin appearing on a row that is not pinned — both
sit at its head, so the glyphs already on screen never move and only the width the
title has changes. With **Compact** row density (and details moved to the hover
card), there is no branch line and the same cluster ends the title line
instead.

**A thread's pin is a control, not a mark.** A pinned row wears a **solid pin at
rest** — which threads are pinned is worth reading without pointing at a row — and a
row that is not pinned draws the outlined one under the pointer, so pinning is one
press on the row it is about rather than two through the context menu. **The colour
never carries the state**: the pin wears exactly what the park buttons beside it
wear, so the three read as one row of controls, and the fill is what says which
state this one is in. The press carries the toggle, with `aria-pressed` and the
label ("Pin thread" / "Unpin thread") saying both to a screen reader. The solid is
**made from the outlined artwork** rather than drawn a second time — every closed
outline in the glyph takes the fill, the open one stays a stroke — so the two states
are one silhouette, and the pin does not change shape when it is pinned. Its target
is the cluster's own 20px around a 14px glyph, and the padding on the side facing the
next control is handed back, so the glyph sits in the same rhythm as its neighbours
rather than a few pixels out of it.

Under the pointer it behaves like the two park buttons, in its own vocabulary: it
**turns in** — arrives a little off square, is driven in, and *stays* turned, the way
a pin sits once it has been turned into something — while **three `P`s fall into
it**: in over the head's right shoulder on the pin's own line, each starting a little
further back, each smaller than the one before, gone by the time they land. They are
the `z`s the snooze drifts, mirrored — those travel *away* from the clock, because
sleeping is a departure; these come *to* the pin, because pinning is a thread being
caught and kept — and the letter is the same idea either way: `z` says sleep, `P`
says pinned, with no legend needed. A pinned pin does none of this: it is a state the
row reports, and it answers the pointer with colour alone.

**Failed**, **Needs you**, **Working**, **Unread**, **Inactive**, and seven-day
**Stale** states have separate shapes, labels, tooltips, and customizable colors.
Inactive and stale work recede; Harbor never calls ordinary idle work Done. A Working
family keeps the actual activity type visible: runtime, workflow, background agent,
command, plan, and goal each use a different animated shape and customizable color.
PR ticks and other PR icons use their semantic color as a tinted background, so a
ready tick is visibly green. Hovering a quiet root swaps its elapsed time for the
two park buttons without adding a row.

**The two park buttons are one gesture with two outcomes.** Both lift their artwork
and light a tinted ground; then they part. Settling is *over*, so it celebrates in
emerald with five sparkles — the effect ported from BB Sidebar. Snoozing is *later*,
so the clock nods and three marks drift off it, in violet: Harbor's own, since
upstream's snooze control is a select and has nothing to follow. Three marks against
five sparkles is the point — settling is the celebration, snoozing is the quiet act.
Those two hues are the only ones on a row that are written down rather than read
from your palette, because the palette's roles are *states* and postponing is
something you do to a row rather than something it reports.

### A working thread can never be parked

Workflows, background agents, background commands, plan mode, and goals all count as
live work. Any of them blocks parking and wakes a parked thread, so running work is
never hidden.

### Snoozing

The hover button snoozes until **09:00 tomorrow**.

A snoozed thread is still in bb's own list — snoozing is this sidebar's idea, not
bb's — so when bb's list is the one on screen, Harbor marks those rows with a clock
and "Snoozed by Harbor · wakes in …". It is the one thing Harbor adds to a sidebar it
does not own, and it clears itself the moment the wake time passes. The marker
comes from the last state Harbor wrote rather than a live read: with Harbor not the
provider its own reads are not running, so a snooze set on another machine shows
up once Harbor is the provider again.

### Inline agents

A root with child threads gets an agent count and disclosure. The stack opens by
default when the family is selected or a child is working, unread, or waiting for
you. Child rows keep their own provider mark (including Codex and Claude), branch,
age, working state, unread ring, context menu, split drag, and keyboard-readable
status help. Provider names are announced by the child disclosure without adding
nested tab stops.

**The thread header carries both directions of the tree.** A **parent chip** gives
a focused child a route back up. A **children chip** — beside it, not instead of
it — names how many children this thread has, turns to **Needs you** in your
palette's waiting colour when one of them has a hand raised, and opens a list of
them: each with its disc, its title, what kind of thread it is and its status.
Clicking one opens it.

The sidebar's own chip covers a family that is on screen and expanded. The header
chip is for when it is not: another group tab, a filter that excludes this family,
a collapsed project, or a sidebar that simply is not where the eyes are. It draws
nothing at all for a thread with no children.

**A child can have children, and the tree draws them.** A child row with its own
child threads carries a `count + chevron` control of its own, opening a list
indented one more step, and so on to any depth. The nesting is rebuilt from each
thread's real parent rather than from the flat list the order and the rollup run
on, and a filter that hides a middle thread promotes its children rather than
losing them. A row leading to the thread you have open always draws its children,
whatever the setting says, so the open chat is never the row held back.

A child row says its two verdicts **in words**: an uppercase **Needs you** or
**Working** flag, and a waiting row gets a ground of its own so it is findable in
a long tree without reading a label.

### Thread details

**Row density** in **Harbor Settings → Sidebar & Layout** decides how much
detail each row renders inline:

| Mode | On the row |
| --- | --- |
| **Detailed** *(default)* | title, status marker, branch/host, relative age, PR metadata, child disclosure, provider badge, and hover quick actions |
| **Compact** | single-line title, status marker, and hover quick actions; branch, PR, and timing move into the hover card |

**Detailed** shows each thread's workspace branch or host and PR status right in
the tree, while **Compact** keeps tall lists tight and surfaces extra metadata
on hover.

### Folded rows

A group, a project and a worktree each carry the **same chip a thread with
children wears** — the threads worth looking at named by colour, and how many of
them, on a ground tinted by the state the branch is in. One shape for one
question, at every level that has threads beneath it.

The number is **the size of the reason to open the row, not the size of the
branch**: a project with twenty-eight threads of which one is unread and one is
working says **2**, and the discs name those two. Counting all twenty-eight would
be a count of the things that are *not* happening. A branch with nothing running,
nothing waiting, nothing unread and nothing failed draws **no chip at all**.

Clicking it is a shortcut, not a disclosure: it jumps to the thread the state came
from. The arrow beside it, and the row's own name, do the opening — so the chip is
free to be triage, which is the one thing a summary of a hundred folded threads
can do that the list cannot.

### The worktree row

A worktree row is the thread card's shape one level up: **the alias or branch on
its own line, then a branch line** carrying the branch's icon and name on the left
and the row's controls at its right end — the status rollup, the `+` that starts a
thread here, and the arrow. A row with a branch line *is* a worktree, so the
branch icon says so and the kind icon is not repeated above it. With **Both**
(`alias-and-branch`) label mode there is no second line and the controls end the
only one.

The branch icon tells a worktree's branch from a thread on the project's own
branch: a folder that is a branch (`FolderGit`) versus a plain one
(`GitBranch`). The same two icons mark a thread card's branch line.

### The rest

- **bb's own thread list is one click away.** When the list cannot be read, the
  failure state offers **Use bb's list** beside **Try again**, and the tree hands
  the scroll area to bb's own rows. A retry can fail, and a sidebar that is not
  working is the worst possible moment to send someone into Settings to fix it.
- The row above the tree is **bb's own navigation row**, untouched. Its
  destinations — New thread, Search threads, Plugins, Skills, and every installed
  plugin's panel — are shared chrome that other plugins live in, and Harbor does not
  rearrange them.
- bb's quick palette (**Mod+Shift+P**) carries Harbor's verbs: settle, snooze
  until tomorrow, wake, show threads that need you, and **Harbor: open Feature
  Hub**. Thread actions are listed only while applicable (for example, settle is
  omitted when a thread is actively working, and wake is offered only for a
  parked thread).
- **The arrow on a group, project or worktree row says whether it is open**, and
  clicking it toggles the row.
- **Right-click any row for its menu** — a group, a project, a worktree, a thread
  family, a child thread, or a row on a parked shelf. They use BB's native
  `@bb-ui/*` context menus, dropdown menus, dialogs, tooltips, and hover cards,
  with `Shift+F10` and keyboard navigation supported throughout.
- **Responsive overlays and mutual exclusion**: On narrow/mobile viewports,
  menus and dialogs open in `@bb-ui`'s touch-friendly bottom drawer shell; on
  desktop, opening any menu or dialog automatically dismisses active hover cards
  and tooltips (`overlayCoordinator`) so popovers never stack invisibly.
- Drag a card to a split pane, or Cmd/Ctrl-click to open one. A parked row on
  the Snoozed or Settled shelf is a split source too.
- Status-icon reordering is separate from BB's card-to-split drag target and
  adds no extra row icon. The two coexist because they are grabbed in different
  places: the status icon reorders, and everywhere else on the row starts bb's
  split gesture.
- bb's search, its thread shortcuts, and modifier-click split-open all keep working.

### When the thread list cannot be read

bb hands this sidebar its threads through a hook with no way to be retried, so a
failed refresh used to replace the whole tree with one line — losing the user's
place, their scroll, and every row they were reading, over a hiccup that fixes
itself. Three things stand in the way of that now:

- A failed refresh **keeps the last known state** and says so above the tree.
  The rows are real, one refresh behind.
- A first load that fails offers **Try again**, which reads the live view
  straight from bb's own thread table through the plugin's backend. That is the
  one route back a plugin actually has.
- A burst of realtime publishes — a bulk operation, or a settled thread taking
  several turns — collapses into at most two reads: one at once, one after the
  burst. The first read is immediate on purpose, because settling is not
  optimistic here; the subscription is what moves the row.

### It remembers where you were

The tree's shape is persisted per browser, not just the route bb restores:

- The top **Features | Projects** scope, selected group tab, thread/feature
  filter, and whether the Snoozed and Settled shelves are open.
- Which groups, projects, worktrees, thread families, and nested child lists you
  collapsed or expanded by hand. Anything you have not touched still follows its
  default, so a preference change reaches it.

Opening a thread also reopens the path back to it. If the restored route points
at a thread inside a collapsed group, project, worktree, or family — or under a
group tab that excludes it — that branch is revealed, so a reload lands you on
the thread itself rather than on a closed row.

### Features in both modes

Features live in their own dedicated top-level **Features** scope on the
**Features | Projects** switcher, strictly isolated from `Projects → All` and
project group tabs:

- In **Threads** mode, a feature expands into its root conversations and its
  member worktrees.
- In **Workspaces** mode, it expands into one row for the feature folder root
  and one row for each member workspace.
- The **Features** scope carries its own status filter bar (**All**, **Needs
  you**, **Dirty**, **Stale**), `+` to create a new feature, and Active /
  Parked / Finished sections.

A feature's member worktrees are drawn under Features and never duplicated into
project trees or project `unseen-worktree` diagnostics. The owning project keeps
one compact reference indicator (`↗ N in features`) linking back to the feature.
The Features container project is hidden as an ordinary project row.

Clicking a feature (or using **Hub** in the workspace header or `Mod+Shift+P` →
**Harbor: open Feature Hub**) opens the canonical four-tab **Feature Hub**
(**Overview**, **Changes**, **Repos**, **Decisions**), with native support for:

- **Park & Wake**: Park a waiting feature with an optional reason tag, context
  note, scheduled `wake_at` timer, or automatic wake on thread activity,
  without deleting its worktrees or archiving its threads.
- **Cross-Repo Delivery Matrix (`Changes`)**: View writable vs `[ref]`
  read-only roles, dirty/untracked file counts, diff deltas, ahead/behind counts,
  push one clean ahead repository or batch-push all clean ahead repositories, and
  jump straight to each repo's thread/BB native Git view for diffs and commits.
- **Read-only references & presets (`Repos`)**: Attach reference repositories as
  read-only symlinks (`ref`), save reusable multi-repo feature presets,
  export/import `<slug>.code-workspace` manifests, or promote a single-repo
  worktree into a multi-repo feature while preserving conversation history.
- **Native provider**: Spin up multi-repo features directly via BB's
  `harbor-multi-repo` environment provider (`retireGraceMs: null`).

### Replacing Conductor

The workspace header tabs, breadcrumb switcher, workspace-bound new chat page,
**Fork to new workspace** message action, **Feature Hub** trigger (`Hub`), Git
changes shortcut (`Changes`), and workspace menu (**Archive all conversations**,
**Remove worktree…**, **Copy path**) all live in Harbor. Conductor must be
disabled or uninstalled so the two plugins do not register duplicate header rows:

```sh
bb plugin disable conductor
```

## Harbor in the sidebar

Two things are worth knowing before you tune it:

- Rows are denser than bb's own list by design — the tree carries groups and
  worktrees, so everything that is not the title is a dot, a count, or a
  tooltip. Everything visible can be tuned from **Harbor Settings**.
- The scroll area reserves its scrollbar's own lane (`scrollbar-gutter: stable`)
  and keeps only a token gap beside it, so the tree does not shift sideways the
  moment it grows past the viewport. That area also clips horizontally, so a
  decoration poking past a row can never grow a horizontal scrollbar: the
  status, pull-request and provider tooltips are bounded by the row they hang
  off instead.

### Attention in the title bar

When enabled under **Harbor Settings → Sidebar & Layout → Show attention strip
in title bar** (opt-in, off by default), threads that are failed, waiting on
you, working, or unread appear as chips in the empty middle of the desktop
window's title bar. The set is live: a family enters when one of those states
appears and leaves when only the quiet states remain; snoozed and settled
threads stay out. Each chip rolls the family up to one dominant state, keeps its
project colour, and opens the thread that raised that state. This uses bb's
experimental app overlay and the desktop title-bar selector, so it is a
desktop-only surface and should be rechecked after a bb upgrade.

## Configuration

The **view menu** (the sliders icon at the right of the group strip) holds how
the tree is drawn. Every submenu shows its current choice on the trigger, and
the button carries a dot whenever anything is off its default:

- **Filter** — All, Working, Needs you, Unread, Quiet, Quiet 1d+, Quiet 7d+.
- **Sort projects** — Manual *(default)*, Name A→Z / Z→A, Most threads, Recently
  updated, Status.
- **Sort threads** — Manual *(default)*, Newest, Oldest, Recently updated, Least
  recent, Recent attention, Name, Status *(Threads mode)*.
- **Sort worktrees** — Manual *(default)*, Name, Recently updated, Most threads,
  Status.
- **Group by** — By project *(default)*, By machine *(shown when connected to
  more than one host)*.
- **Group tabs** — Fit the width *(default)*, Always show names.
- **Group by repository** & **Show untracked worktrees** toggles.
- **Collapse all** and **Reset view**.

`Manual` reads the order you arranged by dragging; every other mode is a lens
over it, and switching back restores the arrangement untouched. Dragging is only
enabled in `Manual`, because a time or name sort has no place to drop a row.

The arrangement and the sort modes are stored on the server, so they are the
same on every client. The tree's *shape* — the active `Features | Projects`
scope, selected group tab, filter, and manual collapse state — stays per
browser.

Harbor registers zero host `Configuration` setting fields. Every preference
lives in a single-layer 3-section **Harbor Settings** workbench
(`appearance:v2` and `agentAccess:v1`):

| Section | What it configures |
| --- | --- |
| **Sidebar & Layout** | Live row preview, Row Density & Layout (`Row density`, `Status indicator`, `Worktree label`, `Default subthreads`, `Show quick actions`, `Threads per page`), Sidebar Behavior (`Automatic project icons`, `Group threads by repository`, `Show unregistered worktrees`, `Workspace ownership`, `Show attention strip in title bar`), **Status Palette** presets, **Project Badge Colors**, and Reset all appearance. |
| **Agent & Features** | Three-tier **Agent Access** (`Off`, `Read-only`, `Full control`), Feature Workspace Defaults (`Default branch template`, `Default base branch`), Feature Workspaces overview/roots, and reusable saved feature presets. |
| **Diagnostics** *(with badge count)* | Per-machine repositories, ownership conflicts, dangling environments, stale worktrees (>14d), unregistered worktrees with one-click activation, and `git worktree prune` copy helper. |

### Sidebar & Layout

- **Live row preview** updates instantaneously at the top of the panel as you
  adjust density, indicator style, worktree labels, quick actions, and palette
  presets.
- **Row Density & Layout**: choose **Detailed** *(default)* or **Compact**
  density, **Color dot** *(default)* or **Icon** status indicator, **Worktree
  label** (**Alias first**, **Both**, **Branch only**), **Default subthreads**
  (**Expanded** or **Collapsed**), **Show quick actions**, and **Threads per
  page** (1–100, default 5).
- **Sidebar Behavior**: toggle **Automatic project icons** (letter/favicon
  badges; derived stably from project ID with per-project colour overrides
  below), **Group threads by repository**, **Show unregistered worktrees**,
  **Workspace ownership** (**Filesystem** default or **Claimed only** `bb claims`),
  and **Show attention strip in title bar** (off by default).
- **Status Palette**: pick from three curated accessible presets — **Default**
  *(theme-aligned)*, **High contrast**, or **Colorblind-friendly** *(Okabe-Ito)*.
- **Reset all appearance** restores every `appearance:v2` control to its
  default.

### Agent & Features

- **Agent Access** selector (`agentAccess:v1`): switches immediately between
  **Off** (0 tools, 0 skills, `null` instructions), **Read-only** *(default —
  4 inspection tools)*, and **Full control** *(all 10 consolidated tools)*
  without manually toggling individual switches.
- **Feature Workspace Defaults**: configure **Default branch template**
  (supports `{slug}`, defaults to `feat/{slug}`) and **Default base branch**
  (blank auto-detects repository HEAD/default branch).
- **Feature Workspaces & Presets**: inspect managed feature roots on disk,
  counts of active/parked/archived features, and rename or delete saved feature
  repository presets.

### Diagnostics

Reports live facts gathered from each connected host: summary counts of
dangling environments, stale worktrees (>14 days), prunable `.git/worktrees`
entries, and unregistered worktrees; per-host repository and ownership conflict
diagnostics; one-click **Activate** buttons to register an unseen worktree under
its owning project; and a one-click copy button for `git worktree prune`.

### Advanced behavior

- Search reveals every matching row, regardless of pagination.
- An open thread remains visible when it falls beyond the current page.
- Explicit expand/collapse choices override the default until changed.
- The view's ordering and collapse state keep their own persistence scope,
  separate from these settings.

The sidebar footer carries a **Harbor settings** button as the one-click route here.

The snooze presets assume a 09:00 morning, an 18:00 evening, and a week
starting Monday in your local timezone. The settled shelf reaches back 24 hours.
Those timing constants are not configurable.
