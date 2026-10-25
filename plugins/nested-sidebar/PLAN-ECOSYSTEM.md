# Plan: absorb ecosystem sidebar capabilities

Status: in progress. Gates live in `GATES-ECOSYSTEM.md`.

## Goal

Nest is one of seven sidebar replacements in the BB Community marketplace, and the
only one whose ancestry runs back through the official example. The rest of the
ecosystem — plus bb's own built-in sidebar — has capabilities Nest lacks. This plan
brings in the ones that are worth their weight, in an order where each lands green.

The research behind it is a read of bb `main` (`apps/app/src/components/sidebar/`,
60 files) and of every sidebar-replacing marketplace plugin. Clones kept read-only
under `../.scratch/` (`bb-src/`, `plugins/`); `.scratch/` is gitignored.

## What is deliberately NOT in scope

Verified already present, so not repeated: the snooze preset set (`hour`/`evening`/
`tomorrow`/`next-week`) and its conditional "This evening", `MAX_TIMEOUT_MS` 32-bit
clamping, `draft`/`working-draft` indicators, `activity.backgroundAgents` in status
and park decisions, scrollbar-gutter reservation, hover actions that reserve no
width, and status rollups.

Not reachable from a plugin, so not attempted: the top reserve row, the resize
handle, the footer, the nav rows, drag-to-reorder-into-sections (host-internal, see
bb `docs/plugin-sidebar-thread-list.md` §1/§6/§10), per-row draft awareness (the
host's array-wide view cannot report it), and shell-level sidebar collapse.

## Items

Each item is independent and lands on its own, with tests, a green suite, and a
clean typecheck. IDs are stable for the todo list and the gates file.

### P0

| ID | Item | Source of the idea |
| --- | --- | --- |
| A1 | `commandPaletteAction` for Nest's verbs (settle / snooze / toggle filter) | `gtd-sidebar` app.tsx |
| A2 | Error-state retry, and treat a transient read failure as stale-not-broken | bb `useConnectionAwareQueryState`, `isTransientReadError` |
| A3 | Compose the host split drag with Nest's own reorder drag on one row | `tinted-threads` app.tsx `onPointerDown` chain |
| A4 | Gate split affordances on `useSidebarThreadSplit().isAvailable` | SDK contract, `plugin-sidebar-thread-list.md` §6 |
| A5 | `pendingOpenId` must call `onNavigate` (mobile drawer stays open) | SDK `PluginThreadListProps.onNavigate` |

### P1

| ID | Item | Source of the idea |
| --- | --- | --- |
| B1 | Cross-project Pinned section that follows bb's own pinned order | bb `PinnedThreadTree.tsx`; `gtd-sidebar` |
| B2 | Organization mode: `By project` / `By machine`, and environment grouping as a toggle rather than a forced level | bb `SidebarHeaderControls.tsx`, `sidebarGroupThreadsByEnvironmentAtom` |
| B3 | Windowing, with placeholder rows that still carry the shortcut contract | bb `SidebarWindowedItems.tsx` |
| B4 | Child rollup badge with a per-tone breakdown, plus a separate subagent badge | `tinted-threads` `SubthreadBadge` / `SubagentBadge` |
| B5 | Inline row rename instead of a dialog | `tinted-threads` |
| B6 | Debounced, visibility-filtered realtime refresh that keeps the last good value | `tinted-threads` |

### P2

| ID | Item | Source of the idea |
| --- | --- | --- |
| C1 | `experimental_sidebarNavigation` slot, plus `Original` as an escape hatch | bb `examples/plugins/sidebar-navigation` |
| C2 | `contentScripts` mount, as the additive alternative to replacing the list | `thread-organizer` app.tsx |
| C3 | Config revision + "changed elsewhere" for server-stored order | `thread-organizer` `baseRevision` |
| C4 | `pendingInteraction` slot | `thread-organizer` `ConfirmWorkflowChange` |
| C5 | Archived threads recoverable under their project | `recent-archives` |

## Design notes worth keeping

- **A3 is the load-bearing trick.** Two drags on one element only coexist because
  they engage on different axes: reorder on vertical travel, split once the pointer
  leaves the sidebar. bb cancels its own dnd-kit sensors when the split drag engages,
  so the two never fight. Skipping reorder while the context menu is `data-state="open"`
  matters because Radix owns that press.
- **B1 must write bb's order, not a private one.** `gtd-sidebar`'s rule: a pin moved
  in the built-in sidebar lands in the same place here. A private pinned order would
  make the two surfaces disagree.
- **B3 must keep the shortcut contract.** bb encodes the navigation entries into the
  placeholder of a non-realized row so `data-sidebar-thread-shortcut-target` still
  resolves. Windowing without that silently breaks the numbered thread jumps.
- **B4 must separate subagents from child threads.** bb's own docs say in-turn
  subagents are `activity.backgroundAgents` on the parent and are *not* child
  threads; the two sets overlap without being equal.

## Verification

Per item: `npm test`, `npx tsc --noEmit`, and `npm run build`. Then the full
`GATES-ECOSYSTEM.md` sweep, and a live check in the running app for the items whose
gates ask for one.