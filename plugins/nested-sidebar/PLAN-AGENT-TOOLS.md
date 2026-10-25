# Plan: Nest's organization layer, exposed to agents

Status: implemented and verified.

| Gate | State |
| --- | --- |
| A1 read | done — `nest_sidebar_map`, asserted by test |
| A2 hide | done — `configure` selects, `execute` gates |
| A3 no lost arrangement | done — no tool reaches the order store, asserted by test |
| A4 nothing destructive | done — five names, asserted by test |
| A5 visible without reload | done — the shared actions publish |
| A6 instruction budget | done — dropped by rank, asserted against a 200-project fixture |
| A7 switches | done — five booleans, read-only by default |
| A8 intact | done — 892 tests, typecheck and build clean, and a live agent session observed with all five tools, the injected summary verbatim, a full map, and a reversible alias round-trip that left no residue. |

## The problem

An agent creates most of what the sidebar organizes — projects, worktrees,
threads — and it knows nothing about the layer that files them. Groups, a
project's group, a workspace's alias: all of it lives in this plugin's SQLite and
none of it is reachable from a thread. So the AI builds the structure and the
human labels it by hand, which is why the labels drift and why an agent asked to
"set up a project" makes a second project for a worktree instead of an
environment in the one that already owns it.

The repository axis added in `79e9544` already *finds* those mistakes. This turns
the finding into something the agent can read and, when the user says so, act on.

## Acceptance gates

| ID | Outcome | Evidence |
| --- | --- | --- |
| A1 | Every organization fact an agent needs is readable in one call, with stable ids. | `nest_sidebar_map` returns groups, projects, repositories, workspaces (path, branch, alias, environment id), unseen worktrees and diagnostics; a test asserts every id it hands out is one a write tool accepts. |
| A2 | Disabled tools are absent from the model's tool list, not merely refused. | `configure` returns only enabled tools; a test asserts a disabled tool is absent from the selection and that `execute` still refuses it. |
| A3 | Nothing an agent does can lose a user's arrangement. | No tool writes the manual order; a test asserts the order store's revision is unchanged by every write tool. |
| A4 | Nothing destructive is reachable. | No tool removes a worktree, a project or a non-empty group; a test asserts the tool name set equals the four documented names. |
| A5 | A write is visible in the sidebar without a reload. | Each write publishes its channel; a test asserts the publish per tool. |
| A6 | The injected summary fits the 4096-character budget for a real sidebar. | A test builds the summary from the live 12-project fixture and asserts length, plus the degradation order when it does not fit. |
| A7 | Every tool can be turned off from Settings, and off means off. | Five booleans; a test asserts each maps to its tool set and that the default is read-only. |
| A8 | Existing behavior is intact. | Full `npm test`, `npm run typecheck`, `npm run build`, and a live `bb plugin rpc call` against the running plugin. |

## Work breakdown

1. `lib/agent/toolkit.ts` — the registrar: register once, gate at execute time,
   truncate output, catch and report rather than throw.
2. `lib/agent/settings.ts` — the five booleans and the live flag object they
   feed, seeded from defaults and kept current by `onChange`.
3. `lib/agent/index-cache.ts` — the sidebar index, materialized into the
   plugin's own SQLite so the two synchronous agent callbacks can read it, and
   refreshed by every async read the server already performs.
4. `lib/agent/instructions.ts` — the injected summary, with its degradation
   order and its 4096-character budget.
5. `lib/agent/tools-read.ts` — `nest_sidebar_map`.
6. `lib/agent/tools-write.ts` — the three write tools.
7. `lib/agent/wire.ts` — one entry the server calls: define settings, prime the
   index, register tools, contribute instructions.
8. `server.ts` — extract the four write actions the RPC handlers and the tools
   now share, call the wiring, and add the `bb nest status` CLI command.
9. README + settings preview.

## The tools

Five tools, five settings, one tool per setting except the group pair.

| Setting | Default | Tools | Why that default |
| --- | --- | --- | --- |
| `agentToolsEnabled` | on | — | Master gate. Off contributes no instructions and registers nothing, so the context cost is zero. |
| `agentToolsRead` | **on** | `nest_sidebar_map` | Reading is safe and it is the half that stops the mistakes. |
| `agentToolsGrouping` | **off** | `nest_project_set_group` | Moves a project the user filed. Reversible, but it is the user's filing. |
| `agentToolsGroups` | **off** | `nest_group_create`, `nest_group_rename` | Changes the names the user reads. |
| `agentToolsAliases` | **off** | `nest_workspace_set_alias` | Changes a label the user wrote for a worktree. |

Read on by default is deliberate: the failure mode of reading is "the agent knows
less", and the failure mode of *not* reading is what this whole line of work
exists to fix. Every write is off until asked for.

## Decisions, and what was rejected

**Both gates, not one.** `configure` hides a disabled tool from the model's tool
list but only applies at the next session start; `execute` gating is live but
leaves the tool visible, so a model calls it and burns a turn learning it is off.
Both are needed and neither is redundant.

**Ids, never names.** Two projects can share a name and a repository's name is
derived from its remote, so a name is not an identifier. The map returns every
id, and every write takes one.

**No order writes, so no revision.** `order-store.ts` guards its writes with
`baseRevision` because two clients dragging one list can silently discard each
other's work. The three writes exposed here are single-row upserts with nothing
to lose, so they need no guard. This is the reason `reorder*` is deliberately
absent: exposing it would make `expected_revision` mandatory on every call and
turn a simple tool into a retry protocol.

**Writes are not scoped to the calling thread's project.** The obvious use is
cross-project — "file chaoshangtong under Work" from a thread somewhere else —
so scoping by `ctx.projectId` would break the case the feature exists for. The
safety is the user's opt-in, the tools being non-destructive, and each call
being visible in the timeline.

**Rejected: per-tool settings.** Six booleans in an already-long settings list,
for tools that are already grouped by feature. Five feature toggles read better
and cover the same ground.

**Rejected: a tool for the diagnostics alone.** The map already carries them, and
a second read is a second thing to keep in sync.

**Rejected: the CLI as the primary surface.** A plugin can contribute `bb nest`,
and an agent with a shell can run it, but a native tool is a first-class call in
the timeline, is validated, and needs no shell. The CLI is added for the human,
to inspect what is on and off.

## The injected summary

`contributeInstructions` runs on the thread-start path and must be synchronous,
so it reads the materialized index rather than bb. Its shape:

```text
Nest sidebar: a project organization layer bb does not know about.
Groups: grp_a Work (4 projects) | grp_b Side (2) | 6 ungrouped
This thread's project: chaoshangtong (proj_x) · group Work
  repo chaoshangtong (github.com/verger-guo/chaoshangtong)
  workspaces: main [main] · bb/thr_zhuy7b6wzp [bb/thr_zhuy7b6wzp] "the alias"
  4 worktrees in this repo that bb has no environment for
Other projects: bb-plugins (proj_y) Work · warren (proj_z) Ungrouped · ...
Tools: nest_sidebar_map (read). Grouping, group and alias tools are off.
Only change grouping or names when the user asks for it.
```

Degradation order when it does not fit, in this order and no other: drop the
"other projects" index, then drop the per-workspace lines for projects other than
this thread's, then truncate. The project this thread is in is the last thing
dropped, because it is the one the agent is working in.

## Non-goals

- No worktree, project or thread creation, and no removal of anything.
- No writes to the manual order.
- No `nest_*` tool that touches a machine; the repository facts are read, cached
  and served as they are today.
- No change to the sidebar's own RPC surface, its tree, or its preferences.
