<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
  <img src="assets/logo.svg" width="72" height="72" alt="" />
</picture>

# Harbor

**Stable projects, clear attention, inline agents, and multi-repo features.**

![bb ≥ 0.48](https://img.shields.io/badge/bb-%E2%89%A5%200.48-88C0D0?style=flat-square)
![any platform](https://img.shields.io/badge/platform-any-3FA266?style=flat-square)
![experimental slot](https://img.shields.io/badge/uses-experimental%20SDK%20slot-F1B467?style=flat-square)

</div>

Harbor replaces the scrolling thread list in bb's left sidebar with a
project-first workbench and multi-repository Feature Cockpit designed for
parallel agent work.

Harbor keeps the sidebar's model visible instead of flattening everything into one
thread stream:

```text
group -> project -> worktree -> thread
```

Child threads remain attached to their root family, status rolls up through the
tree, and project/worktree rows stay visible even when there are no active
threads. At the top of the sidebar, **Features | Projects** cleanly separates
multi-repository Features from `Projects → All`. Under each project, active
worktrees stay visible while older idle worktrees fold into a single summary row
(`▸ N inactive worktrees`) with batch cleanup. Rows support **Detailed** and
**Compact** density presets in **Harbor Settings → Sidebar & Layout**.

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
is no "compare against upstream" to follow. The authorship and lineage are
recorded in `package.json` (`euanguo (derived from Harbor and Dockside by Mateo Cerquetella)`),
and the licence chain in `LICENSE` and `THIRD_PARTY_NOTICES.md`. The ADR that
recorded why the sidebar was forked rather than written from scratch lives outside
this repository, in the workspace the fork was extracted from.

Since that baseline, Harbor V3 added the separated **Features | Projects**
top-level scopes, active-first worktree tiering with batch pruning, the
canonical **Feature Hub** and cross-repo **Delivery Matrix**, three-tier **Agent
Access** over a consolidated 10-tool surface, a streamlined 3-section **Harbor
Settings** workbench, and migration onto BB's canonical `@bb-ui/*` shared
primitives.

## Features, two modes, and workspace tabs

At the top of the sidebar, the **Features | Projects** switcher separates
multi-repository Features from project workspaces so Feature folders and
Feature-owned worktrees are never mixed into `Projects → All` or flagged as
project `unseen-worktree` diagnostics.

Selecting a Feature opens its most urgent, remembered, or latest root
conversation in one click (and jumps straight to a feature-root chat screen
if none exists yet), with the active Feature row highlighted in both
**Threads** and **Workspaces** modes. Expanding a Feature reveals its attached
member repositories cleanly without duplicating the root folder as a synthetic
sub-row, while active Features can be pinned to the top and sorted by **Recent
activity**, **Attention**, **Name A→Z**, or **Created order**.

Clicking the **Layers** Hub icon on a Feature row (or **Hub** in the workspace
header, the **Feature Hub** thread tab, or running **Harbor: open Feature Hub**
from `Mod+Shift+P`) opens the canonical **Feature Hub** directly in the
non-blocking right side-panel tab whenever the feature already has a thread
(and falls back to a modal dialog for 0-thread features):

- **Overview**: goal, acceptance criteria, open questions, blockers, external
  references, and **Park & Wake** controls.
- **Changes**: the cross-repo **Delivery Matrix** showing writable vs read-only
  (`ref`) members, dirty/unpushed counts, clean-repo batch push, and handoff into
  BB's native Git changes view.
- **Repos**: add writable git worktrees or read-only `ref` symlinks, create
  saved presets, and remove members.
- **Decisions**: append-only decision log and confirmation of agent-recorded
  drafts.

Under **Projects**, the switch at the bottom of the list chooses how far down
the sidebar draws. Both modes share the same groups, projects, and active
worktrees — only where the conversations are drawn changes:

- **Threads** expands each workspace into the thread families that run there,
  keeping bb's default thread header (no tabs, no breadcrumb, bb's own title)
  and gathering pinned conversations in a **Pinned** section above projects.
- **Workspaces** stops at the workspace. A project lists its checkout and active
  worktrees as one row each, and the conversations of the open workspace are
  drawn as tabs under the thread header.

In the **Workspaces** mode the header reads `project › workspace` (or
`feature › member`), and the last segment switches to other workspaces of the
same project or feature. Double-click it to rename the conversation. The tab
strip under it:

- names the agent running the conversation and marks it with its family's
  state, and counts the child threads behind it;
- fixes the pinned conversations at its left in bb's pin order — they never
  scroll away, and unpinning is what brings the close control back;
- orders the rest most recently used first in the scrolling strip, supporting
  right-click **Pin**/**Unpin**, **Settle conversation**, **Snooze until
  tomorrow**, **Close others**, **Close tabs to the left**, **Close tabs to the
  right**, and **Copy link**;
- scrolls sideways with a vertical wheel and closes a tab by settling it (moving
  it to the Settled shelf after handing off to the neighbouring tab);
- keeps **All (N)** at the end with searchable jump/settle/snooze and idle batch
  settle;
- opens **Feature Hub** (`Hub`, inside a feature), opens BB's Git diff tab
  (`Changes` / `+N -M`), and offers **Archive all conversations**, **Remove
  worktree…**, and **Copy path** from `⋯`.

The tab strip's `+` opens a new conversation page bound to the workspace, with
an Untitled tab and chips that add another conversation's transcript.

## Install

Install directly from this repository with git:

```sh
bb plugin install git:https://github.com/euanguo/euanguo-plugins.git --plugin harbor
```

Or install from a local checkout when developing:

```sh
cd path/to/euanguo-plugins/plugins/harbor
npm install                       # runtime deps + pinned @get-bb/plugin-sdk & Radix shims
bb plugin build .                 # writes dist/{server,app,host}
bb plugin install "path:$PWD" --yes
```

After an edit, `bb plugin build . && bb plugin reload harbor` is the short loop;
`bb plugin dev .` watches instead. `bb plugin remove harbor` uninstalls it,
while a local checkout stays on disk.

## Requirements

- bb ≥ 0.48
- Plugin SDK ≥ 0.6.157
- Nothing else. No accounts, keys, or external services.

## Quick start

Install as shown under [Install](#install), then enable Harbor in **Settings →
Appearance → Sidebar → Harbor**. The detailed tree is in
[docs/USAGE.md](docs/USAGE.md); the architectural invariants are in
[docs/DESIGN.md](docs/DESIGN.md).

## Agent access

Harbor governs agent visibility, context injection, and tool execution through a
single **Agent Access** selector under **Harbor Settings → Agent & Features**
(stored under `agentAccess:v1`, defaulting to **`read-only`**):

- **`off`**: registers 0 Harbor tools, injects 0 skills, and contributes `null`
  system instructions.
- **`read-only`** *(default)*: exposes read-only inspection tools alongside a
  compact sidebar summary strictly capped under 1,000 tokens (3,500 characters).
- **`full`**: unlocks all 10 consolidated Harbor tools. Destructive actions still
  require two-step confirmation (`acknowledged: true` after previewing impact;
  project deletion additionally requires `expected_name`). List ordering is
  never exposed to agents.

The tool table is driven by one canonical specification
(`lib/domain/agent-access.ts`); full usage details live in
[docs/USAGE.md](docs/USAGE.md#what-agents-can-see-and-do).

| Tool | Min tier | Scope | What it does |
| --- | --- | --- | --- |
| `harbor_sidebar_map` | `read-only` | global | Read groups, projects, workspaces, diagnostics, and repository identity IDs. |
| `harbor_feature_list` | `read-only` | global | List features with state, folder paths, and attached members. |
| `harbor_feature_brief` | `read-only` | inside feature | Read requirement (goal/non-goals/acceptance), open questions, blockers, references, and full decision log including drafts. |
| `harbor_feature_git_status` | `read-only` | inside feature | Inspect live multi-repo branch, diff stats, upstream ahead/behind, role (`worktree` vs `ref`), and submodule status. |
| `harbor_feature_meta` | `full` | inside feature | Record draft decisions (`action: "decide"`) for user confirmation in Feature Hub, or attach references (`action: "link"`). |
| `harbor_feature_repos` | `full` | inside feature | Add writable worktrees or read-only `ref` links (`action: "add"`), or remove a member worktree (`action: "remove"`, requires `acknowledged: true`). |
| `harbor_feature_lifecycle` | `full` | global | `create`, `rename`, `park`, `unpark`, `promote`, `adopt`, `reopen`, or `delete` (requires `acknowledged: true`) features. |
| `harbor_sidebar_organize` | `full` | global | Reversible sidebar & thread organization: `project_rename`, `project_set_group`, `group_create`, `group_rename`, `workspace_set_alias`, `thread_settle`, `thread_snooze`, `thread_pin`, `thread_rename`. |
| `harbor_thread_spawn` | `full` | global | Start a thread (child by default) inside the feature folder, a writable member folder, or an explicit environment ID. |
| `harbor_admin_delete` | `full` | global | Permanent `thread_delete`, `project_delete` (with `expected_name`), `group_delete`, or `worktree_remove`, each gated behind `acknowledged: true`. |

Run `bb harbor status` (or `bb harbor status --json`) from the CLI to inspect
the active tier, exposed tools, and indexed counts.

## Configuration summary

Harbor registers zero host `Configuration` setting descriptors. Every display,
feature, and agent preference lives in one streamlined 3-section workbench
inside **Harbor Settings** (`appearance:v2` and `agentAccess:v1`):

| Section | What it configures |
| --- | --- |
| **Sidebar & Layout** | Live row preview, Row Density & Layout (**Row density**: `Compact` / `Detailed`, **Status indicator**: `Color dot` / `Icon`, **Worktree label**: `Alias first` / `Both` / `Branch only`, **Default subthreads**: `Expanded` / `Collapsed`, **Show quick actions**, **Threads per page** 1–100), Sidebar Behavior (`Automatic project icons`, `Group threads by repository`, `Show unregistered worktrees`, **Workspace ownership**: `Filesystem` / `Claimed only`, `Show attention strip in title bar`), **Status Palette** presets (`Default`, `High contrast`, `Colorblind-friendly`), **Project Badge Colors**, and Reset all appearance. |
| **Agent & Features** | Three-tier **Agent Access** (`Off` / `Read-only` / `Full control`), Feature Workspace Defaults (`Default branch template` `feat/{slug}`, `Default base branch`), Feature Workspaces overview/roots, and reusable saved feature presets. |
| **Diagnostics** *(with live badge count)* | Per-host repository report, ownership conflicts, dangling environments, stale worktrees (>14d), unregistered worktrees with one-click activation, and `git worktree prune` command copy helper. |

The view menu and full settings breakdown are in
[docs/USAGE.md](docs/USAGE.md#configuration); the design rationale is in
[docs/DESIGN.md](docs/DESIGN.md#palette-and-settings).

## Native BB UI & theme compatibility

Harbor builds on BB's canonical shared-ui primitives via `@bb-ui/*` rather than
maintaining a divergent custom widget kit:

- Root [`packages/bb-ui`](../../packages/bb-ui) tracks `get-bb/bb`'s registry
  and [plugins/harbor/bb-ui.json](bb-ui.json) declares Harbor's closure
  mirrored into `plugins/harbor/bb-ui/`.
- Thin overlay adapters in `components/ui/` preserve standard host and
  third-party skin selector contracts (`data-radix-*`, `[data-tab-pill]`,
  `ResponsiveDrawerShell` compact-viewport bottom sheets) so skins such as
  `chatgpt-skin` theme Harbor menus, popovers, dialogs, tooltips, hover cards,
  and workspace tabs natively while keeping `overlayCoordinator` mutual
  exclusion and stacked `Z_*` layers intact.

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
including BB's `@bb-ui` primitives / shadcn/ui, Radix UI, Lucide icons, and the
Hugeicons artwork used by the plugin's own icon and logos.

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

`check` runs both type checks (`typecheck` and `typecheck:strict`), Biome linting,
the full test suite, and `bb plugin build`. To run one piece:

```sh
npm run typecheck
npm run typecheck:strict
npm run lint
npm test
npm run build
```

From the repository root, keep `plugins/harbor/bb-ui/` synchronized with
[`packages/bb-ui`](../../packages/bb-ui) using:

```sh
node scripts/sync-bb-ui.mjs          # refresh root registry & plugin mirror
node scripts/sync-bb-ui.mjs --check  # verify 0 drift across root and plugin mirror
```

`plugins/harbor/bb-ui/` is generated from `packages/bb-ui` according to
`plugins/harbor/bb-ui.json`; do not edit mirrored files by hand.

The test script needs Node 22.6+. A few store tests need the `better-sqlite3`
native binding built for this Node; if a fresh `npm install` left it unbuilt they
fail with a bindings error, which says nothing about the plugin — at runtime bb
provides the database through `bb.storage`. Fix it once with:

```sh
npm approve-scripts better-sqlite3 && npm rebuild better-sqlite3
```
