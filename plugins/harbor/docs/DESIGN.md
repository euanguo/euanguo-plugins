# Harbor design

This document records the invariants behind Harbor V3. It describes why the
sidebar, Feature Hub, Settings, and agent surface are shaped this way; the
operational details live in [PLUGIN_OVERVIEW.md](../PLUGIN_OVERVIEW.md) and
[docs/USAGE.md](USAGE.md).

## Why groups first

The sidebar's model is `group -> project -> worktree -> thread`. A group is a
named bucket above projects, and a project belongs to at most one group; the
project list is bb's project list, so every project gets a row even before it
has a thread. This keeps ownership legible before conversations are drawn and
lets a project or worktree outlive the work currently running in it.

**All** and **Ungrouped** are scopes, not groups: they cannot be named,
reordered, removed, or filled with projects. Ungrouped appears only when groups
exist and it has a project, so it is never a second All or an empty destination.

**Features** is a strictly separate top-level scope for multi-repository work.
Feature folders and Feature-owned worktrees are never mixed into `Projects → All`
and are never flagged as external `unseen-worktree` diagnostics under projects.

## Stable order and worktree tiering

Projects and complete root/child families stay where the user puts them. Drag
uses existing row affordances, keyboard reordering uses the same focus targets,
and the arrangement is kept on the server so it follows clients and reloads.
Children remain attached to their root families, and pinned roots retain their
leading partition.

Worktrees use active-first two-tier disclosure (`classifyWorktreeTier`): active,
named, open-PR, or recently created worktrees remain primary rows, while older
idle worktrees with zero active threads collapse into a single summary row
(`▸ N inactive worktrees`) with batch survey and cleanup. Time- and name-based
sorts are lenses over the stored manual order, so switching back restores that
order untouched.

## Derived ownership

A project record is bookkeeping and can be wrong; a repository is a fact on
disk. Workspace ownership therefore defaults to **Filesystem**: the project
checkout anchors same-repository worktrees, a directory inside the anchor
belongs to the nearest project source, and ambiguous or unreadable claims are
reported rather than guessed. `bb claims` restores bb's stored ownership when it
was deliberate.

## Two modes and Feature Hub

**Threads** and **Workspaces** hold the same tree and never move rows between
owners. The mode changes only where conversations are drawn: Threads expands a
workspace into thread families and keeps Pinned above the tree; Workspaces stops
at the workspace and draws its conversations as tabs under the thread header.

**Feature Hub** is the single multi-repo workspace cockpit with four tabs:
**Overview** (brief, external references, park/wake), **Changes** (a
cross-repo **Delivery Matrix** with repo status, clean-repo batch push, and
handoff), **Repos** (writable worktrees and read-only `ref` symlinks), and
**Decisions** (append-only log with draft confirmation). Per-repo staging, diff
inspection, and commits remain on bb's native git surface rather than being
reimplemented inside Harbor.

## Stored and derived

Group membership, workspace aliases, manual order, feature metadata,
`appearance:v2` display settings, and `agentAccess:v1` agent permissions are
stored by Harbor. Repository identity, workspace kind, and tree ownership are
derived from bb records and the filesystem each time they are needed, so a wrong
record can be compensated for in the view without corrupting bb's source of
truth.

Browser-local view state covers the selected tab, filter, open shelves, and
manual expand/collapse choices under `bb.harbor.view-state.v2`. Server-stored
order and sort modes are shared across clients.

## Palette and settings

State is never communicated by colour alone. Every family reports **Failed**,
**Needs you**, **Working**, **Unread**, **Inactive**, or seven-day **Stale**
with a label, a distinct shape, animation or motion cue, accessible help, and a
semantic colour.

Settings live in a single-layer 3-section workbench (**Sidebar & Layout**,
**Agent & Features**, and **Diagnostics**) rather than a host `Configuration`
wall. `appearance:v2` stores the 14 curated display, workspace, and feature
defaults (including opt-in `showTitleAttention: false`) instead of dozens of
per-field toggles, and the palette offers three curated presets — **Default**,
**High contrast**, and **Colorblind-friendly** — instead of eighteen individual
hex inputs.

## Native BB UI and overlay governance

Harbor's interactive primitives come from BB's canonical shared-ui library rather
than a parallel custom UI kit:

- Root `packages/bb-ui` mirrors `get-bb/bb`'s registry via
  `scripts/sync-bb-ui.mjs`, and `plugins/harbor/bb-ui/` holds the declared
  closure (`plugins/harbor/bb-ui.json`, aliased as `@bb-ui/*`). Both the root
  and plugin mirror are drift-checked by `node scripts/sync-bb-ui.mjs --check`
  and `test/bb-ui-sync.test.ts` so git-installed plugins compile standalone while
  preserving host and third-party theme selectors (`data-radix-*`,
  `[data-tab-pill]`, `ResponsiveDrawerShell`).
- Thin Harbor adapters in `components/ui/{modal,popover,menu,hover-card,tooltip}.tsx`
  and `components/inbox/row-context-menu.tsx` connect `@bb-ui/*` overlays to
  `overlayCoordinator` mutual exclusion and strict z-index tiers
  (`overlay-layers.ts`), preventing stacked hover cards, tooltips, context menus,
  dialogs, and nested `<select>` popovers from colliding.

## Security and storage

Harbor stores its own shelves, order, and feature metadata in the plugin's bb
SQLite database and key-value rows (`appearance:v2`, `agentAccess:v1`); the
browser caches view state and working-since clocks under `harbor:v1:*` and
`bb.harbor.*`. bb removes the plugin database on uninstall but does not clear web
storage.

Agent access uses a single three-tier setting stored under `agentAccess:v1` and
defaulting to **`read-only`**:

- **`off`**: registers zero active session tools, injects zero skills, and
  contributes `null` system instructions.
- **`read-only`** *(default)*: exposes only read-only inspection tools
  (`harbor_sidebar_map`, `harbor_feature_list`, plus `harbor_feature_brief` and
  `harbor_feature_git_status` inside feature folders) with compact sidebar
  context kept under 1,000 tokens.
- **`full`**: enables all 10 consolidated Harbor tools, adding
  `harbor_feature_meta`, `harbor_feature_repos`, `harbor_feature_lifecycle`,
  `harbor_sidebar_organize`, `harbor_thread_spawn`, and `harbor_admin_delete`.

A single canonical table (`lib/domain/agent-access.ts`) drives tool visibility
in `bb.agents.configure`, runtime execution gating in `registerTool`, and the
tool list advertised by `contributeInstructions`, preventing prompt/tool drift.
All destructive actions (`harbor_admin_delete`, `harbor_feature_lifecycle`
delete, and `harbor_feature_repos` remove) enforce two-step confirmation
(`acknowledged: true` after preview, plus `expected_name` for project
deletion). List reordering is never exposed to agents.
