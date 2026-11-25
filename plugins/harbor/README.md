<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
  <img src="assets/logo.svg" width="72" height="72" alt="" />
</picture>

# Harbor

**Stable projects, clear attention, inline agents.**

![bb ≥ 0.36](https://img.shields.io/badge/bb-%E2%89%A5%200.36-88C0D0?style=flat-square)
![any platform](https://img.shields.io/badge/platform-any-3FA266?style=flat-square)
![experimental slot](https://img.shields.io/badge/uses-experimental%20SDK%20slot-F1B467?style=flat-square)

</div>

Harbor replaces the scrolling thread list in bb's left sidebar with a
compact project-first inbox designed for parallel agent work.

Harbor keeps the sidebar's model visible instead of flattening everything into one
thread stream:

\`\`\`text
group -> project -> worktree -> thread
\`\`\`

Child threads remain attached to their root family, status rolls up through the
tree, and project/worktree rows stay visible even when there are no active
threads. Harbor uses a fixed Compact row layout; the settings decide which
metadata is visible and where it lives.

The project list is bb's project list. Every project gets a row whether or not it
has a thread yet, so a project you just created is on the sidebar the moment it
exists rather than the moment you start something in it; a project with nothing in
it yet shows a placeholder where its threads will go. Under a project, its
workspaces — the checkout and each worktree — become rows of their own once there
is more than one to tell apart, and while the project has no threads yet, so a
worktree you just created is on screen before anything runs in it. A workspace
outlives the conversations in it: settle the last thread in a worktree and its row
stays, because the worktree is still there to start the next one in.

Projects and complete root/child families stay where you put them. Drag the
existing project header or a family's semantic status icon to sort, or use
Alt+Up/Alt+Down from the same focus targets. The order is kept on the server, so
it follows you across clients, and it survives reloads; children remain attached,
and pinned roots retain their leading partition. Sorting pauses during search,
filtering, or bulk selection so hidden rows never move implicitly.

Every family has an explicit **Failed**, **Needs you**, **Working**, **Unread**,
**Inactive**, or seven-day **Stale** state. Labels, distinct shapes, animation,
accessible help, and customizable semantic colors keep color from carrying the
meaning alone. Inactive and stale work recedes instead of using a bright unused
state, and Harbor never invents Done for ordinary idle work.

When a root has child threads, the family expands inline as an agent stack with
provider marks for Codex, Claude, and other BB providers. Pull-request metadata
stays on the parent only, including semantic ready, merged, and blocked/error
states.

You clear the list with two email verbs: **snooze** a thread until a wake time, or
**settle** it when you are done. Both shelves collapse to one counted header.

## Fork and origin

Harbor is a fork, and this repository is the third copy in a short line of them:

| | |
|---|---|
| [`get-bb/bb` → `examples/plugins/t3sidebar`](https://github.com/get-bb/bb/tree/main/examples/plugins/t3sidebar) | the example sidebar every one of these starts from (MIT, Copyright (c) 2026 Michael Yong) |
| [`MateoCerquetella/bb-plugins` → `plugins/dockside`](https://github.com/MateoCerquetella/bb-plugins/tree/main/plugins/dockside) | Dockside, the fork of that sidebar this line descends from (MIT, Copyright (c) 2026 Mateo Cerquetella) |
| the **unpublished Nest fork by verger** | groups, the worktree tree, status rollups, and the row-seeded new-thread dialog — the sidebar this repository started as. It has no public URL: it was installed from a local path source, and its README is the one this one grew out of |
| **this repository**, [`euanguo/euanguo-plugins`](https://github.com/euanguo/euanguo-plugins) | what the sections below describe |

This repository is **not** a GitHub fork: it has no upstream parent on GitHub and
no fork banner, because it was created from a copy of the unpublished fork rather
than through GitHub's fork button. Nothing here tracks an upstream tag, and there
is no "compare against upstream" to follow. The authorship the copy carried over
is recorded in `package.json` (`verger (fork of Dockside by Mateo Cerquetella)`),
and the licence chain in `LICENSE` and `THIRD_PARTY_NOTICES.md`. The ADR that
recorded why the sidebar was forked rather than written from scratch lives outside
this repository, in the workspace the fork was extracted from.

What this repository has added since it was copied is its commit history: the
worktree row carrying its alias and branch, the project's own checkout as a row
of its own that leads its project, removing a worktree, the copy actions on the
workspace and project rows, and the strip's own All and Ungrouped tabs taking an
icon.

## Two modes and workspace tabs

The switch at the bottom of the list chooses how far down the sidebar draws.
Both modes hold the same tree — Features, then groups and their projects, then
Personal and the shelves, with Pinned above them in the Threads mode — and
nothing moves between owners when you switch. Only where the conversations are
drawn changes.

- **Threads** is Harbor as it always was. Each workspace expands into the thread
  families that run there, and the thread header belongs to bb: no tabs, no
  breadcrumb, bb's own title. Pinned conversations gather in a Pinned section.
- **Workspaces** stops at the workspace. A project lists its checkout and
  worktrees as one row each, and the conversations of the open workspace are
  tabs under the thread header. There is no Pinned section: a pin never moves a
  workspace row.

A workspace row in the Workspaces mode leads with the family state that most
needs you (Failed, Needs you, Working, Unread), then the pull request state,
then what kind of workspace it is. Its trailing side carries the conversation
count when there is more than one, the lines changed, and an unread dot. On
hover, `+` opens a new conversation bound to the workspace and `⋯` opens the
worktree menu. Clicking the row opens the conversation that needs you if there
is one, otherwise the one you last read there, otherwise its oldest
conversation, otherwise a new one.
Conversations with no workspace — most of the personal project's — stay as
compact rows under their project.

In the Workspaces mode the header reads `project › workspace`, or `feature ›
member` inside a feature, and the last segment switches to the other workspaces
of the same project or feature. Double-click it to rename the conversation. The
tab strip under it:

- names the agent running the conversation and marks it with its family's
  state, and counts the child threads behind it;
- fixes the pinned conversations at its left in bb's pin order — they never
  scroll away, and they carry no close: the pin is the promise the tab stays,
  so unpinning is what brings the close back;
- orders the rest most recently used first in the scrolling part, and pins and
  unpins from the tab, its right-click menu, or the **All (N)** list;
- opens a right-click menu on any tab with **Pin**/**Unpin**, **Settle
  conversation**, **Snooze until tomorrow**, **Close others**, **Close tabs to
  the left**, **Close tabs to the right** and **Copy link**. The three bulk
  closes settle a run at once and skip the pinned tabs, which is why a side
  with nothing but pins shows the item disabled;
- scrolls sideways, and a plain vertical wheel drives it, so a workspace with
  forty conversations is reachable without a trackpad;
- **closes a tab by settling it**: the conversation moves to the Settled shelf,
  where it can be brought back, and the pane opens the tab beside it first;
- keeps **All (N)** at the end, a list of every conversation in the workspace
  with a search field past eight, where each one can be opened, settled, or
  snoozed until tomorrow;
- opens the Git diff tab, runs the workspace script, and offers **Archive all
  conversations**, **Remove worktree…**, and **Copy path** from `⋯`.

The tab strip's `+` opens a new conversation page bound to the workspace, with
an Untitled tab and chips that add another conversation's transcript.

## Install

The plugin is **not published to a marketplace** — it is installed from this
repository as a local path source, which is also the loop to develop it in.

```sh
cd path/to/euanguo-plugins/plugins/harbor
npm install                       # runtime deps + the pinned @get-bb/plugin-sdk
bb plugin build .                 # writes dist/{server,app,host}
bb plugin install "path:$PWD" --yes
```

After an edit, `bb plugin build .` then `bb plugin reload harbor` is the
short loop; `bb plugin dev .` watches instead. `bb plugin remove harbor`
uninstalls it, and the local path source stays on disk.

## Requirements

- bb ≥ 0.48
- Plugin SDK ≥ 0.6.157
- Nothing else. No accounts, keys, or external services.

## Quick start

Install as shown under [Install](#install), then enable Harbor in **Settings →
Appearance → Sidebar → Harbor**. The detailed tree is in
[docs/USAGE.md](docs/USAGE.md); the rationale behind its shape is in
[docs/DESIGN.md](docs/DESIGN.md).

## Agent switches

Every switch in this build starts on, so an agent gets the whole surface
without being configured first. What keeps that safe is not the default but the
shape of each tool: the reversible ones act one row at a time, and the
destructive ones refuse until a second call passes `acknowledged` — and the
irreversible ones ask for a name too. Reading is on for the reason above: the
failure mode of reading is that an agent knows less than it could.

The tool behavior beyond this table is in
[docs/USAGE.md](docs/USAGE.md#what-agents-can-see-and-do).

| Setting | Default | What it lets an agent do |
| --- | --- | --- |
| **Agents · Harbor tools** | on | The master switch. Off contributes nothing to any thread. |
| **Agents · Read the sidebar structure** | on | The summary, and `harbor_sidebar_map`. |
| **Agents · File projects into groups** | on | Move a project into a group, or out to Ungrouped. |
| **Agents · Create and rename groups** | on | Add a group, rename one. |
| **Agents · Rename workspaces** | on | Set or clear a worktree's display alias. |
| **Agents · Rename projects** | on | Change a project's display name. The folder, repository and threads stay put. |
| **Agents · Tidy threads** | on | Settle, snooze, pin and retitle threads — `harbor_thread_settle`, `harbor_thread_snooze`, `harbor_thread_pin`, `harbor_thread_rename`. Each is reversible from the sidebar, and the first three take a batch of up to 20. |
| **Agents · Start threads** | on | Start a new thread with a first prompt, in a feature folder, a repository worktree, or an environment it names (`harbor_thread_spawn`). Parented to the calling thread by default. |
| **Agents · Delete and remove** | on | Delete threads, projects, groups and features, and remove worktrees — `harbor_thread_delete`, `harbor_project_delete`, `harbor_group_delete`, `harbor_worktree_remove`, `harbor_feature_delete`. Every one needs `acknowledged: true` on a second call, after showing what would go. |
| **Agents · Work in features** | on | Inside a feature folder: read the feature (`harbor_feature_context`), read its requirement and whole decision log (`harbor_feature_brief`), record a decision as a draft (`harbor_feature_decide`), attach a ticket or document link (`harbor_feature_link`), bring repositories in (`harbor_feature_add_repos`), rename it (`harbor_feature_rename`) or file an outside worktree under it (`harbor_feature_adopt`). Anywhere: list features, create one, reopen a finished one. |

## Configuration summary

Harbor Settings is one page of four tabs, drawn by the plugin:

| Tab | What it decides |
| --- | --- |
| **Thread list** | Row layout, details, worktree label, status marker, child expansion, rows per page, and the five "show in the row" switches — with a live mock of one row at the top. |
| **Palette** | The preset, and the eighteen semantic colours. |
| **Projects** | Icon detection, workspace ownership, unregistered worktrees, repository grouping, and the per-project badge colours. |
| **Diagnostics** | What each machine reported about its repositories. A report, not a repair. |

The ten **agent switches** stay in the host's own `Configuration` block above
it, because the server reads them when it decides which tools to register. Every
other setting lives in the plugin's own store: nothing on the server reads a row
layout or a colour, and a setting the plugin owns is one it can draw properly.

The full view menu and settings are in
[docs/USAGE.md](docs/USAGE.md#configuration); the palette's design notes are in
[docs/DESIGN.md](docs/DESIGN.md#palette).

## Switching from t3sidebar

Harbor is a new plugin identity, not an in-place release of t3sidebar. It
uses a separate bb database and separate `harbor:v1:*` browser keys, so it
starts with an empty Snoozed and Settled state. It does **not** migrate or
delete the old plugin's parked threads.

Keep t3sidebar installed but disabled until you no longer need its snoozed or
settled rows. You can re-enable it temporarily to inspect that state. Removing
the old plugin may remove its private database; Harbor never performs that
removal for you.

Sidebar selection is per client. Choose **Harbor** on each desktop,
browser, or remote client where you want to use it.

## Troubleshooting

**My sidebar looks the same after installing.** Choose Harbor in Settings →
Appearance → Sidebar. Installing alone changes nothing.

**The tree says it could not refresh.** That is the retained state, not an
error: the rows below are the last ones bb reported, and the line goes away the
moment bb answers again. If the tree is empty instead and offers **Try again**,
that reads the threads from bb's own table rather than from the view that
failed, so it can succeed where a plain refresh would not.

**A thread I settled is not on the Settled shelf.** The shelf only reaches back 24
hours. Older work is still settled and still archived — look for it in bb's archived
view.

**A snoozed thread came back early.** That is the design: a snoozed thread wakes when
it starts working or asks you a question.

**Un-settling did not bring the thread back.** Archive and unarchive run on the
thread's host, which can be offline. When an unarchive fails, bb keeps the thread
archived and the thread leaves the sidebar — and Harbor asks rather than going
quiet: a prompt names the failure, shows what bb said, and offers **Try again**.
Leave it and the thread stays in bb's archived view, which is where it always
was.

**Uninstalling left data behind.** The shelves live in the plugin's own database,
which bb removes with the plugin — but a copy of them is cached in the browser's
`localStorage` under `harbor:v1:*` (thread ids, park timestamps, and legacy
provider metadata), alongside `bb.harbor.*` (the view state and the working-since
clock). bb's uninstall does not clear web storage. Clear site data
if that matters to you. The separate `t3sidebar:v1:*` keys belong to the old
plugin and are not claimed by Harbor.

## Credits

The full lineage is under [Fork and origin](#fork-and-origin): bb's example
sidebar (MIT, Copyright (c) 2026 Michael Yong), Dockside by Mateo Cerquetella
(MIT), and the unpublished fork this repository started from. `LICENSE` carries
the terms; `THIRD_PARTY_NOTICES.md` lists everything bundled on top of that,
including shadcn/ui and the Hugeicons artwork used by the plugin's own icon and
logos.

The motion, the settled shelf's **Load more**, and the working duration are
ported from [BB Sidebar](https://github.com/yusuf8834/bb-sidebar) (MIT, Copyright
(c) 2026 Michael Yong and Yusuf Akbulut), and the transitions run on
[@formkit/auto-animate](https://github.com/formkit/auto-animate) (MIT). Both are
recorded in `THIRD_PARTY_NOTICES.md`.

The provider brand marks are vendored SVG geometry from `get-bb/bb` and depict
third-party brands. A host-served logo always wins over them, rendered as a muted
silhouette rather than in brand color — by design.

## Develop from source

Install as shown under [Install](#install), then check a change with:

```sh
npm run check
```

`check` runs both type checks, the test suite, and `bb plugin build`. To run one
piece:

```sh
npm run typecheck
npm run typecheck:strict
npm test
npm run build
```

The test script needs Node 22.6+. A few store tests need the `better-sqlite3`
native binding built for this Node; if a fresh `npm install` left it unbuilt they
fail with a bindings error, which says nothing about the plugin — at runtime bb
provides the database through `bb.storage`. Fix it once with:

```sh
npm approve-scripts better-sqlite3 && npm rebuild better-sqlite3
```
