## What you get

Harbor replaces bb's scrolling thread list with a project-first sidebar and a
multi-repository Feature Hub. Your work stays in one place while the threads
underneath it change state.

```text
group -> project -> worktree -> thread
```

A **group** is the coarsest level: work, personal, a side project. A **project**
sits inside it, and a project's own checkout and active worktrees stay visible
while older idle worktrees fold into a single summary row with batch cleanup.
**Features** stay cleanly separated from `Projects → All` and open into the
canonical **Feature Hub** (overview, references, decisions, repositories, and a
cross-repo **Delivery Matrix**). Both **Threads** and **Workspaces** sidebar
modes share the same underlying tree.

Harbor renders its controls and overlays using BB's canonical shared-ui
primitives (`@bb-ui/*`), preserving third-party skin compatibility and
responsive bottom-sheet overlays on narrow viewports.

## Attention, rolled up

Each row reports the worst thing under it. A project whose child agent failed
shows a failure without being open; a group with unread work shows it in the tab
strip. Six states are distinguished: working, needs you, unread, failed,
inactive, and stale. Working threads say what they are doing — runtime,
workflow, agent, command, plan, or goal.

Two email verbs clear the list. **Snooze** a thread until a time you pick, or
**settle** it when the work is done. Both shelves collapse to one counted
header, and settled work reaches back 24 hours.

## Colour & Settings

Harbor Settings uses a streamlined 3-section workbench (**Sidebar & Layout**,
**Agent & Features**, and **Diagnostics** with a live finding count badge).
**Sidebar & Layout** pairs a live row preview (`Compact` or `Detailed` density)
and sidebar behavior toggles with three semantic palette presets — **Default**,
**High contrast**, and **Colorblind-friendly** — alongside per-project badge
colours; **Agent & Features** configures three-tier Agent Access, default feature
branches, and presets.

## Projects and workspaces

A project badge colour is derived from the project's ID, so renaming a project
does not change its identity, and you can override any of them. Harbor reads the
repository each workspace really belongs to from the machine holding it, which
is how it can surface unregistered worktrees in **Diagnostics** with one-click
activation or feature adoption while keeping Feature worktrees strictly isolated
from project diagnostics.

Workspace ownership follows the filesystem by default — a checkout and its
worktrees stay together even when an environment record claims another project —
and can be returned to bb's own assignment at any time without touching stored
data.

## Agents

Harbor governs agent capabilities through a single three-tier **Agent Access**
setting (`agentAccess:v1`) across a consolidated 10-tool surface, defaulting to
**`read-only`**:

- **`off`**: Zero Harbor tools active and zero system prompt context injected.
- **`read-only`** *(default)*: Read-only sidebar & feature inspection
  (`harbor_sidebar_map`, `harbor_feature_list`, and inside features
  `harbor_feature_brief` and `harbor_feature_git_status`) with compact
  context (< 1,000 tokens).
- **`full`**: Unlocks write, spawn, feature lifecycle, and administrative tools
  (`harbor_feature_meta`, `harbor_feature_repos`, `harbor_feature_lifecycle`,
  `harbor_sidebar_organize`, `harbor_thread_spawn`, `harbor_admin_delete`). All
  destructive removals strictly enforce two-step confirmation (`acknowledged: true`).

## Requirements

bb 0.48 or newer and Plugin SDK 0.6.157 or newer. No account, no network
request, no external service. Settings live in bb's own KV and SQLite store
(`agentAccess:v1`, `appearance:v2`); nothing is written outside the plugin's
directory.
