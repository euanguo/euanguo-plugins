# Repository Ownership Feasibility

Status: implemented.

Question: can Nest make the filesystem, rather than bb's mutable
`projectId` records, decide which project owns a workspace and its worktrees?

## Verdict

Yes, for the sidebar's presentation and actions. This can be implemented inside
the plugin without changing bb core or rewriting bb's database.

No, for persistently repairing bb's own environment and thread records. The
installed plugin SDK exposes no operation that moves an existing environment or
thread to another project. A plugin-only implementation must therefore derive a
virtual owner for display while preserving the original ids and records.

The recommended shape is:

```text
group -> canonical project anchor -> physically owned workspace -> thread family
```

where the canonical project anchor is the project's source path, and physical
ownership comes from the host's `.git` facts. The original claimed
`environment.projectId` and `thread.projectId` remain available as diagnostics
and fallback.

Confidence:

- Virtual filesystem ownership in Nest: high.
- Preventing malformed workspaces from Nest's own new-thread flow: high.
- Preventing malformed workspaces from every bb surface without a core change:
  not currently possible.
- Persisting reassignment through public SDK calls: not possible today.

Implementation outcome:

- Filesystem ownership is the default, with `bb claims` as a reversible setting.
- The tree, title attention, pinned families, ordering, archived shelf, new
  thread seeds, project deletion safety, agent map, and project instructions
  consume one shared ownership result.
- Unregistered repository worktrees stay in diagnostics by default and are
  drawn as adoptable project rows only when **Show unregistered worktrees** is
  enabled.
- Host facts distinguish linked worktrees, submodules, containing repositories,
  and unobserved paths.
- bb's environment and thread records remain untouched; ownership conflicts
  remain visible as diagnostics.
- The plugin compiles against the minimum supported Plugin SDK, 0.5.8.

## Reproduction

The highlighted rows are inside the expanded `tea-app-im` project. They are not
worktrees of `tea-app-im`.

| Visible row | Environment | Path | Actual repository | Claimed project |
| --- | --- | --- | --- | --- |
| `main` | `env_aptd94nmxs` | `/Users/wyatt/Documents/my-code/warren` | `warren` | `tea-app-im` |
| `feature/voiceai-usage-statistics` | `env_tt6fryg95g` | `/Users/wyatt/Documents/Code/tea-sdk-chat-submodules` | `tea-sdk-chat-submodules` | `tea-app-im` |

The same project also owns one more physically unrelated row:

| Visible row | Environment | Path | Actual repository | Claimed project |
| --- | --- | --- | --- | --- |
| `code/livekit-resolution` | `env_sitqfeb88n` | `/Users/wyatt/Documents/Code/worktrees/tea-app-im-buy/code-livekit-resolution` | `tea-app-im-buy` | `tea-app-im` |

The two highlighted environments have:

```text
environmentProviderId = null
isWorktree = false
```

They are ordinary Git main checkouts recorded under the wrong project. One has
an archived thread under the wrong project; the other has no thread at all.
The `IM` tab is a Nest group, and `tea-app-im` is manually assigned to it.

## Current Architecture

The existing tree is internally consistent, but it uses two different sources
of truth for two different questions.

### Claimed ownership

bb owns these fields:

- `thread.projectId`
- `environment.projectId`
- `environment.path`
- project sources

Nest groups threads and idle environments by the claimed
`environment.projectId` in `projectWorkspaceRefs()`:

```text
lib/tree.ts
  projectWorkspaceRefs(projectId, ...)
    for each environment:
      if environment.projectId !== projectId: continue
```

`buildProjectGroups()` similarly buckets threads by `thread.projectId`.
Everything above those rows inherits the claimed project's group, color,
position, and project actions.

### Physical facts

The host entry already reads:

- the canonical path through `realpath`
- whether `.git` is a directory or file
- the shared `commonDir`
- the remote URL
- every worktree recorded by Git

`inferRepos()` groups those facts by repository key and reports:

- duplicate physical paths
- workspaces in another repository
- one repository spread across several projects
- one project touching several repositories
- worktrees unknown to bb

This proves the required information is already available. The missing piece is
that these facts only produce diagnostics; they do not alter tree ownership.

### Why the current repository mode does not fix it

`groupByRepository` is off by default. Turning it on only merges projects whose
project-level `repoKeyByProject` values match. That map is lossy:

- it is derived from environments that claim the project, not from the
  project's source anchor
- a project spanning several repositories receives only the first result
- merging operates on whole projects, not on each physical workspace
- it never moves an individual malformed environment to the project whose
  source owns its repository

Therefore the current setting cannot be relied on as the final ownership model.

## SDK Constraints

Checked against the minimum supported `@get-bb/plugin-sdk` 0.5.8 declarations.

`environments.update()` accepts only:

- `name`
- `mergeBaseBranch`

It cannot change `projectId`, `path`, `hostId`, or provider ownership.

`threads.update()` accepts only:

- `title`
- `sectionId`
- `parentThreadId`
- `model`
- `reasoningLevel`
- `visibility`

It cannot change `projectId` or `environmentId`.

`threads.spawn()` accepts `projectId` and a reused environment separately. The
public type does not enforce that the reused environment belongs to that project.
The malformed records in this installation demonstrate that the split is real:
the environment path can belong to one repository while the record claims
another project.

Direct writes to bb's core database are not an acceptable migration. They bypass
services, foreign-key behavior, project caches, thread routes, sections, and
plugin metadata. Deleting and recreating environments plus threads would also
change ids and lose history.

## Ownership Model

The model should be a deep, pure module with one small result:

```ts
interface WorkspaceOwnership {
  readonly environmentId: string;
  readonly claimedProjectId: string;
  readonly ownerProjectId: string | null;
  readonly workspaceKey: string;
  readonly repoKey: string | null;
  readonly kind:
    | "project-checkout"
    | "git-worktree"
    | "external-checkout"
    | "external-directory"
    | "unresolved";
  readonly confidence: "high" | "medium" | "fallback" | "unknown";
  readonly conflict: boolean;
}
```

The module should accept only:

- environment descriptors
- project source descriptors
- host workspace facts

It should return:

- `byEnvironmentId`
- canonical physical workspace rows
- `sourceRepoKeyByProject`
- diagnostics

All matching complexity stays behind this interface. The tree, title bar, agent
map, and settings panel consume the same result instead of reimplementing the
policy.

## Matching Order

Ownership should be decided in this order.

### 1. Exact source path

If `realPath` equals the project source's real path on the same host, that
project owns the workspace.

This is the strongest signal and classifies the row as `project-checkout`.

### 2. Same local Git repository

If the workspace and a project source share the same host and `commonDir`, the
project owns the workspace.

A path that is a linked worktree is classified as `git-worktree`. The source
path itself remains the project checkout.

### 3. Same remote across hosts

If the workspace and source normalize to the same remote, they may represent the
same repository on different machines. This is medium-confidence ownership and
should remain enabled because bb worktrees and machines are allowed to span the
same repository.

### 4. Directory containment

For a workspace without its own Git identity, choose the longest project source
path on the same host that contains it. This covers a thread started in a
subdirectory of a checkout or a plain directory project.

Containment must use path segments, not string prefixes.

### 5. Claimed project fallback

If no physical owner is known, keep the environment under its claimed project.
Mark the ownership confidence as fallback and retain the existing diagnostic.
Never hide a reachable row merely because a machine was asleep or a probe
failed.

### 6. Ambiguity

If several projects resolve to the same repository:

- prefer the project whose source is the repository's main working tree
- if one of them is the claimed project, prefer it
- otherwise choose a stable id order and emit an ambiguity diagnostic

Do not merge separate projects automatically merely because they share a
remote. The existing optional repository merge remains a presentation choice.

## Canonical Workspace Identity

The current workspace identity includes the claimed `projectId`. Once ownership
is derived, identity should be based on:

```text
hostId + canonical realPath + ownerProjectId
```

This lets two environment records for the same directory converge on one row
even when they were claimed by different projects.

Representative environment selection should prefer, in order:

1. a provider-backed ready environment
2. an environment whose branch matches the worktree record
3. the newest record
4. stable environment id

The row keeps all environment ids so expansion state, aliases, copy actions, and
removal still work.

## Tree Integration

The tree should not clone or rewrite `PluginSidebarThread`. Cloning the thread
and replacing `projectId` would make routing and mutations look correct while
quietly changing bb facts.

Instead:

- `buildProjectGroups()` accepts an owner resolver
- a family is bucketed by the owner of its root environment
- workspace rows are bucketed by the same resolver
- `group.project.id` is the display project's real bb id
- each family still carries its real threads and ids
- opening a thread continues to use the host's normal thread action
- starting a thread from a relocated workspace uses the display project's id
  plus the reused environment id

Parent-child attachment should also use the derived owner. A child can remain
in its root family even if its stored `projectId` disagrees, as long as both
resolve to the same physical owner.

## Secondary Surfaces

A correct tree alone is insufficient. These surfaces also key on project ids.

| Surface | Required adjustment |
| --- | --- |
| Project counts and tabs | Count derived owners, not raw thread project ids |
| Title-bar attention | Use derived owner for project name, group, and color |
| Pinned rows | Attach the display project's derived ownership |
| Manual family order | Store under the display project id |
| Workspace order | Store under the display project id |
| Bulk delete | Selection remains by thread id; preview still operates on real threads |
| New thread | Seed the derived owner plus the selected environment |
| Agent map/instructions | Print the derived project and its real environment ids |
| Repository settings | Show claimed vs derived owner and the evidence |
| Archived shelf | Must read by physical ownership, not only claimed project id |
| Project delete | Must warn when the display project visually contains records owned by another real project |
| Remove worktree | Continues to use the real environment; ownership display must not alter the survey |

The archived shelf is the largest secondary boundary. It currently asks bb for
archived threads by one claimed `projectId`. A virtually rehomed archived
thread will not appear under its display project until this read is extended.

Two viable choices:

1. Add a server-side owned-workspace read that gathers archived rows by the
   display owner and filters them by environment ownership.
2. Keep the archived shelf claim-based and label it as showing bb's original
   project archive. This is less consistent and should only be temporary.

## Submodules And Nested Repositories

The current host fact reader assumes a `.git` file always means a linked
worktree. That is not true for a Git submodule.

Verified against:

```text
/Users/wyatt/Documents/Code/tea-app-im/src/submodules/trtc-im-submodule
```

Git reports:

```text
git rev-parse --show-toplevel
  .../tea-app-im/src/submodules/trtc-im-submodule

git rev-parse --git-common-dir
  .../tea-app-im/.git/modules/src/submodules/trtc-im-submodule

git rev-parse --show-superproject-working-tree
  .../tea-app-im
```

There is no `commondir` file in the submodule gitdir. The current fallback
therefore derives the wrong repository identity:

```text
isLinkedWorktree = true
commonDir = .../tea-app-im/.git/modules/src
remoteUrl = null
```

Before filesystem ownership can be the default, `workspace-facts.ts` must
distinguish:

- a true linked worktree, which has a valid `commondir`
- a submodule or embedded repository, whose gitdir owns its own config
- a directory below a repository root but without its own `.git`

The safest implementation is:

- if `commondir` exists, resolve it
- if it does not, use the gitdir itself and read its own config
- if the exact directory has no `.git`, walk parents until the filesystem root
  or a configured depth cap, stopping at the first repository
- classify the result as a nested checkout rather than silently calling it a
  worktree

This requires focused host tests using a real temporary submodule layout.

## Live-Data Acceptance Case

The current installation gives a good acceptance fixture.

Expected after ownership is enabled:

- `env_uy6zatvr8b` remains `tea-app-im` project checkout.
- every `tea-app-im` managed and external worktree whose `commonDir` is
  `tea-app-im/.git` remains under `tea-app-im`.
- `env_sitqfeb88n` moves under `tea-app-im-buy`.
- `env_aptd94nmxs` merges into the existing Warren workspace and appears under
  `warren`.
- `env_tt6fryg95g` merges into the existing tea-sdk workspace and appears under
  `tea-sdk-chat-submodules`.
- duplicate physical paths produce one visible workspace row.
- the three cross-project diagnostic findings remain visible until bb's own
  records are cleaned.

No bb data is modified by this acceptance case.

## Failure And Edge Cases

The implementation must explicitly cover:

| Case | Required behavior |
| --- | --- |
| Host offline | Keep claimed owner, mark unverified |
| Path missing | Keep claimed owner, do not infer a repository |
| Symlink or `/private/var` spelling | Deduplicate by real path |
| Two records for one directory | One visible workspace, all environment ids retained |
| Same remote, two forks | Different normalized owner, as remote normalization already does |
| Same remote, two projects | Ambiguous; do not merge without a main-worktree or claimed-project tiebreak |
| Project has several sources | Compare all configured sources, but use the default source as the display anchor |
| Personal workspace | Exclude from filesystem ownership |
| Thread has no environment | Keep its claimed project and current no-workspace behavior |
| Child in a different claimed project | Attach by derived owner when both resolve to one workspace owner |
| Source path itself malformed | Fall back to claimed ownership |
| Worktree exists on disk but no environment exists | Continue reporting it; do not invent a removable row |
| Repository has no remote | Use host plus `commonDir`; never merge across hosts by path |
| New worktree appears after load | Re-read on environment changes and focus; TTL remains bounded |
| Archived thread in a moved workspace | Show under the derived owner or explicitly document the temporary shelf limitation |
| Project delete from a virtual row | Refuse or warn if it would visually remove another real project's rows |

## Implementation Options

| Option | Plugin-only | Data safety | Preserves ids/history | Verdict |
| --- | --- | --- | --- | --- |
| Derive a virtual owner for rendering and actions | Yes | High | Yes | Recommended |
| Directly update bb database rows | Technically possible | Low | Yes, but unsupported | Reject |
| Delete and recreate environments/threads | Yes | Medium | No | Reject |
| Add core `environment.projectId` and `thread.projectId` move APIs | No | High if designed correctly | Yes | Long-term upstream path |
| Ensure all new threads are created under the owner project | Partly | High | Yes | Do alongside virtual ownership |

## Staged Plan

### Phase 0: Fact hardening

- Add submodule/embedded-repository detection.
- Walk to an ancestor repository when the exact path has no `.git`.
- Add source real paths and source repository keys to the facts result.
- Add deterministic representative-environment selection.
- Keep diagnostics unchanged for raw bb disagreements.

Gate: host fact tests include main checkout, linked worktree, submodule,
subdirectory, symlink, missing path, and offline host.

### Phase 1: Ownership shadow

- Add the pure ownership module.
- Compute ownership alongside the existing repository facts.
- Expose it through `RepoFacts`, but do not change rendering yet.
- Render the claimed and derived owner in the settings panel.
- Bump the sidebar-index cache version.

Gate: live settings show the expected owners for the three malformed rows and
no workspace disappears.

### Phase 2: Tree adoption

- Group families by derived owner.
- Group idle workspaces by derived owner.
- Deduplicate by canonical physical workspace.
- Seed new threads with the derived project id.
- Preserve claimed ids for routes and mutations.

Gate: the live acceptance case moves the three rows without changing bb's
database; opening existing threads still works.

### Phase 3: Secondary-surface alignment

- Title attention and group counts.
- Pinned rows and manual ordering.
- Archived shelf.
- Agent map and instructions.
- Project deletion warnings.

Gate: no surface names one project while drawing the row under another without
an explicit diagnostic.

### Phase 4: Prevention and adoption

- Reject or correct mismatched `projectId` plus `environmentId` in Nest's own
  spawn RPC.
- Gate `+` rows for unseen worktrees behind **Show unregistered worktrees**;
  when enabled, spawning creates a new environment at the real path under the
  derived owner.
- Propose the same invariant upstream for every bb composer and CLI.

Gate: new work starts in the correct project without requiring virtual repair,
and an unregistered worktree can be adopted without creating a second project.

## Test Matrix

Add focused tests for:

1. Project checkout owns exactly its source path.
2. A linked worktree with the same `commonDir` moves to that project.
3. A main checkout of another repository moves out of the claiming project.
4. Two environment records for one real path merge under one owner.
5. A submodule is not classified as its parent's linked worktree.
6. A subdirectory without `.git` belongs to its nearest source repository.
7. An offline path falls back to the claimed project.
8. Two projects sharing one remote do not merge without a tiebreak.
9. A project with several sources still has one deterministic display anchor.
10. Cross-project root and child families remain together under derived
    ownership.
11. Derived workspace ids remain stable across branch changes.
12. New-thread submission uses the owner project and the selected environment.
13. Title attention and group counts use the same owner as the tree.
14. Archived rows in a rehomed workspace resolve under the display project.
15. Deleting a display project cannot silently delete rows visibly belonging to
    another real project.

The current live shapes should be encoded as fixtures, not only described in
prose.

## Effort And Risk

This is a medium-sized plugin change, not a small tree tweak. The core ownership
module is moderate; aligning every project-keyed surface and archives is the
main cost.

Primary risks:

- a visual owner that differs from bb's stored project can mislead destructive
  project actions
- archived-thread lookup can become inconsistent if left claim-based
- submodule detection is currently wrong and must be fixed before strict mode
- an unavailable machine can make ownership flicker if fallback is not stable
- ownership changes caused by disk changes can move user-visible rows

Mitigations:

- keep claimed and derived ownership side by side
- use high-confidence rules for automatic movement
- fall back rather than hiding
- show the evidence in diagnostics
- make destructive project actions aware of mixed ownership
- keep a setting to restore bb's claimed grouping

## Recommendation

Implement the virtual ownership model. It directly expresses the original ideal,
uses facts Nest already gathers, preserves bb ids and history, and is reversible.

Start behind a `workspaceOwnership` preference with two values:

```text
claimed   - current bb behavior
filesystem - canonical source plus repository/worktree ownership
```

After the live acceptance case, submodule tests, and archived-shelf behavior
pass, filesystem ownership can become the default. Persisted reassignment should
remain out of scope until bb exposes a first-party move operation.

## Verification Baseline

Before this investigation, the repository had:

```text
938 tests passing
TypeScript typecheck passing
```

The feasibility conclusion relies on the current source, the installed plugin
SDK declarations, the live bb environment/project records, and real Git
metadata for `tea-app-im` and its submodule.

## Source Map

Primary implementation sources:

- [`lib/inbox.ts`](../lib/inbox.ts) — threads are grouped by claimed
  `thread.projectId`.
- [`lib/tree.ts`](../lib/tree.ts) — idle environments are selected by claimed
  `environment.projectId`; repository merging is project-level.
- [`lib/workspace.ts`](../lib/workspace.ts) — workspace identity and
  classification currently consume the claimed project.
- [`lib/repo-identity.ts`](../lib/repo-identity.ts) — physical repository
  inference, worktree discovery, and diagnostics.
- [`host/workspace-facts.ts`](../host/workspace-facts.ts) — `.git`, `commondir`,
  remote, real-path, and worktree bookkeeping reads.
- [`server.ts`](../server.ts) — workspace descriptors, repository facts,
  indexing, spawn forwarding, and archived-project reads.
- [`hooks/use-repo-facts.ts`](../hooks/use-repo-facts.ts) — client read and
  refresh policy.
- [`components/settings/repo-facts-panel.tsx`](../components/settings/repo-facts-panel.tsx)
  — current report-only presentation.

Minimum SDK contract, `@get-bb/plugin-sdk` 0.5.8:

- `EnvironmentsArea.update` and `updateEnvironmentRequestSchema`
- `updateThreadRequestSchema`
- `createThreadRequestSchema` and `ThreadSpawnArgs`
- `PluginSidebarThread` and `PluginSidebarProject`
- `experimental_useThreadActions`

Live-data evidence came from:

```text
bb project show proj_4tdqxymyc8 --json
bb environment list --project proj_4tdqxymyc8 --json
nest_sidebar_map
bb.db environments/projects/project_sources/threads tables
git worktree list --porcelain
git rev-parse --show-toplevel --git-common-dir --show-superproject-working-tree
```
