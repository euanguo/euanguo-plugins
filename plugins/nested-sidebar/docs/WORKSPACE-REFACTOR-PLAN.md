# Nest 工作区重构计划

版本 v3，2026-11-13。v3 把 Feature 从组织轴彻底降级为 workspace 容器，删掉独立的 Feature 视图和选择器，并让 Features 项目恢复可见。v1 到 v3 的完整改动见 Appendix F。

把 Conductor 的工作区能力完整迁入 Nest，并把底部开关收敛为线程与工作区两种视图。工作区是 bb environment 的投影，不新增一份持久化记录。计划分 6 个 PR，先升 SDK，再收敛数据池，再做视图与 tab，最后清理 conductor 并接管 agent 上下文。

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. 操作者负责合并，PR1 到 PR6 全部停在 merge-ready，由操作者逐条点击合并。

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `git show origin/main:pstack/skills/swarm/SKILL.md`
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `git show origin/main:pstack/skills/control-ui/SKILL.md`
- [ ] Run the two probes in Appendix A before PR1. Record the branch, the SHA, and the screenshots.
- [ ] Confirm conductor is disabled before any live lane, so exactly one tab strip renders. Record `bb plugin list` output.
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] PR1 is first and branches from `main`.
  - [ ] PR2 after PR1.
  - [ ] PR3 after PR2.
  - [ ] PR4 after PR3.
  - [ ] PR5 after PR4.
  - [ ] PR6 after PR5.
- [ ] Hold the file boundaries. PR1 touches `plugins/nested-sidebar/package.json`, `plugins/nested-sidebar/app.tsx`, `plugins/nested-sidebar/components/inbox/thread-card.tsx`, `plugins/nested-sidebar/components/thread-context/**`, `plugins/nested-sidebar/lib/family-status.ts`, `plugins/nested-sidebar/lib/inbox.ts`, `plugins/nested-sidebar/lib/sidebar-thread-row.ts`, `plugins/nested-sidebar/lib/pull-request-presentation.ts`. PR2 和 PR3 touch `plugins/nested-sidebar/lib/workspace-index.ts`, `plugins/nested-sidebar/lib/tree.ts`, `plugins/nested-sidebar/lib/inbox-view.ts`, `plugins/nested-sidebar/lib/organization.ts`, `plugins/nested-sidebar/components/inbox/organization-switch.tsx`. PR4 and PR5 touch `plugins/nested-sidebar/components/header/**`, `plugins/nested-sidebar/app/new-chat/**`, `plugins/nested-sidebar/app/scripts/**`, `plugins/nested-sidebar/app/fork.ts`. PR6 touches `plugins/nested-sidebar/lib/agent/**`, `plugins/nested-sidebar/server.ts`, `plugins/nested-sidebar/README.md`, `plugins/nested-sidebar/docs/**`.
- [ ] Hold the review gate. PR3, PR4, and PR5 change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `gh pr create --base main`.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on. The check command is `npm run check` inside `plugins/nested-sidebar`.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase or a minor fix gets a single verifier at the new head.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in the regression lane is recorded against trunk and does not block the PR.
- [ ] The operator lands each PR bottom-up. An owner never merges. PR1 and PR2 may be landed by the operator as soon as their verdict is clean. PR3, PR4, and PR5 wait for the operator's click after the review gate.

### Boot recipe, for every live lane

Each live lane runs on its own worktree at the PR head. Drive through `control-ui`.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Run `npm install` in `plugins/nested-sidebar` when the dependency graph changed, then `bb plugin reload nested-sidebar`.
- [ ] Start bb with a fixture project holding at least 3 projects, 6 workspaces, 12 threads, 2 subagent families, and 1 archived thread. Reuse the same fixture for every lane.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## SDK 升级与头部槽位接管 (PR1)

**Depends on.** None.

**Files.**

- [ ] Edit `plugins/nested-sidebar/package.json` and bump `@get-bb/plugin-sdk` to `0.6.141`, with `engines.bbPluginSdk` at `>=0.6.141`.
- [ ] Edit `plugins/nested-sidebar/app.tsx` to register `experimental_threadHeaderRow` and `experimental_threadHeaderTitle` with pass-through components, and `experimental_threadContextSegment` for the chips.
- [ ] Create `plugins/nested-sidebar/components/thread-context/ParentChildrenSegments.tsx` for the parent and children chips.
- [ ] Edit `plugins/nested-sidebar/components/inbox/thread-card.tsx` to drop `experimental_useSidebarThreadPullRequest`.
- [ ] Create `plugins/nested-sidebar/lib/thread-pull-request.ts` for the keyed PR read.
- [ ] Edit `plugins/nested-sidebar/lib/family-status.ts`, `plugins/nested-sidebar/lib/inbox.ts`, and `plugins/nested-sidebar/lib/sidebar-thread-row.ts` to drop `activity.goals`.
- [ ] Edit `plugins/nested-sidebar/lib/pull-request-presentation.ts` to accept the new row shape.

**Build.**

- [ ] Bump the SDK, run `npm run typecheck`, and write every type error into the PR body before fixing it. The known breakages are `experimental_threadHeaderAction`, `experimental_useSidebarThreadPullRequest`, and `PluginSidebarThreadActivity.goals`.
- [ ] Replace the per-thread pull request hook with one keyed read over `bb--github-pr-status` `pullRequests`, following the shape Conductor uses in its `app/sidebar/reads.ts`.
- [ ] Move the parent and children chips into one `experimental_threadContextSegment` registration, which returns invisible content when the thread has neither. This is the slot bb's own parent-thread segment uses, so the chips stay next to the composer. Keep the same actions and accessible labels.
- [ ] Register `experimental_threadHeaderTitle` with a component that renders `ThreadTitle` unchanged. This proves the slot before PR4 replaces it.
- [ ] Register `experimental_threadHeaderRow` with a component that returns null. This proves the slot and keeps the diff behavior-neutral.

**You see.**

- [ ] The app boots with `data-nest-header-row` absent from the DOM, every sidebar row renders, the parent and children chips appear in the context row above the composer and still navigate, and the console shows no duplicate-slot error.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add `test/thread-pull-request.test.ts` covering open, draft, merged, closed, and attention states. Run `npm run check`.
- [ ] Add `test/thread-context-segments.test.ts` proving the chip segment renders nothing for a root thread and renders both chips for a child with children.
- [ ] Keep every existing test green, especially `test/architecture-contract.test.ts` and `test/thread-card-layout.test.ts`. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `tcodex/glm-5.3-flash-ioa` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open the fixture sidebar at trunk and head. Save `pr1-regression.png`. Pass when the row count, order, and titles are identical.
- [ ] Lane 2. Open a thread that has a parent. Save `pr1-parent-chip.png`. Pass when the parent chip is visible in the context row and opens the parent.
- [ ] Lane 3. Open a thread that has children. Save `pr1-children-chip.png`. Pass when the children chip lists every child in the context row and opens one.
- [ ] Lane 4. Open a thread whose branch has an open pull request. Save `pr1-pr-badge.png`. Pass when the badge number and state match trunk.
- [ ] Lane 5. Open a thread that reported a goal on trunk. Save `pr1-goal-absent.png`. Pass when no goal glyph appears and no console error is raised.
- [ ] Lane 6. Open the sidebar with one snoozed thread. Save `pr1-snoozed.png`. Pass when the snooze marker still renders on bb's own row.
- [ ] Lane 7. Resize to phone width and open a child thread. Save `pr1-narrow.png`. Pass when the header chips stay inside the viewport.
- [ ] Lane 8. Archive a thread and open it from the archived shelf. Save `pr1-archived.png`. Pass when the row and its PR badge render.
- [ ] Lane 9. Open the command palette. Save `pr1-palette.png`. Pass when every Nest command still appears.
- [ ] Lane 10. Reload the app twice. Save `pr1-reload.png`. Pass when the console shows no slot registration error and both header slots render nothing.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Sidebar first contentful paint with 500 threads, and thread switch latency, measured at trunk and at the head.
- [ ] Probe. Run the same fixture five times per side, alternating trunk and head, and record the median from the performance timeline.
- [ ] Baseline. Record the trunk median first and write it in the PR body before running the head.
- [ ] Rule. Fail when the head median is more than 10 percent slower than trunk or more than 30 ms slower in absolute terms, whichever is larger.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 3 screenshots into `plugins/nested-sidebar/docs/media/pr1-review-chips.png`.
- [ ] Record a 30 to 60 second video of a child thread opening its parent and listing its children. Save it as `plugins/nested-sidebar/docs/media/pr1-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Operator lands PR1 after the review gate.

## 收敛 WorkspaceIndex (PR2)

**Depends on.** PR1.

**Files.**

- [ ] Create `plugins/nested-sidebar/lib/workspace-index.ts`.
- [ ] Create `plugins/nested-sidebar/test/workspace-index.test.ts`.
- [ ] Edit `plugins/nested-sidebar/lib/tree.ts` to read the index instead of grouping families itself.
- [ ] Edit `plugins/nested-sidebar/lib/feature-view.ts` to read the same index.
- [ ] Edit `plugins/nested-sidebar/hooks/use-inbox-tree-model.ts` to build the index once per render pass.
- [ ] Edit `plugins/nested-sidebar/lib/workspace.ts` to keep only classification and label helpers.
- [ ] Edit `plugins/nested-sidebar/lib/workspace-ownership.ts` so ownership is a field on the identity, not a parallel map.
- [ ] Edit `plugins/nested-sidebar/lib/workspace-order.ts` and `plugins/nested-sidebar/lib/view-state.ts` for the key migration.

**Build.**

- [ ] Define the one identity key. `WorkspaceKey = ws:<hostId>:<normalizedPath>`, with `environment:<id>` only as the fallback when an environment has no path. Project id leaves the key, so a directory stays one workspace when bb moves its claim or when two projects point at it.
- [ ] Define the three layers. `WorkspaceIdentity { key, hostId, path, parentKey, childKeys, repoKey, isGitRepo, isWorktree, isMainCheckout, branch, detached, claimedProjectIds, ownerProjectId, conflict, source }` is the physical fact. `WorkspaceBinding { key, records, canonicalEnvironmentId, launchable }` holds one record per bb environment pointing at that directory. `Workspace { identity, binding, label, alias, chats, threads, primary, rollup, featureId }` is what the views draw.
- [ ] Set the containment rule. `parentKey` is the longest other workspace path that contains this one on the same host, and only when that parent is a feature root. A feature root is a workspace whose path equals a `Feature.rootPath`. Its member worktrees get `parentKey` pointing at it, so the workspace view can draw one cross-project container without a second tree.
- [ ] Set the feature fields. `featureId` comes from `featureForPath` first, then from the adoption label. `label` for a feature root is the feature name, not the directory leaf. No feature record is copied into the index.
- [ ] Set the binding rules. One physical directory is one workspace. Duplicate environment records merge into `records`. `canonicalEnvironmentId` is the first record whose claimed project equals `ownerProjectId`, preferring a non-personal record, then a project checkout, then a worktree, then id order. `launchable` is false only when `records` is empty.
- [ ] Set the thread binding rule. A thread binds by `environment.id` first, then by its environment path, then by its own pseudo workspace `thread:<id>`. Subagents bind to their root's workspace unless they carry their own environment.
- [ ] Fold unseen git worktrees into the same shape with `records: []` and `launchable: false`. Their plus adopts the worktree through the existing spawn path, and no row component branches on the old `UnseenOwnedWorkspace` type.
- [ ] Build `WorkspaceIndex { list, byKey, byEnvironmentId, byProject, byPath, byFeature, roots, childrenOf }` in one pass from `threads`, environment descriptors, project sources, repo facts, and unseen worktrees. `roots` are the workspaces with no parent, and `childrenOf` walks the containment tree.
- [ ] Make `buildTree` consume the index. A family belongs to the workspace of its root, exactly as today.
- [ ] Make `buildFeatureView` consume the index refs instead of calling `workspaceRefOf` per family.
- [ ] Migrate stored keys on read. Map old `workspace:<host>:<project>:<path>` and `environment:<id>` keys to the new `ws:<host>:<path>` key for manual workspace order and for `expandedWorkspaces`.
- [ ] Delete `UnseenOwnedWorkspace`, `unseenWorkspaceRef`, and the duplicate key computation in `WorkspaceRef`. No behavior change is allowed in this PR.

**You see.**

- [ ] The project tree and the feature tree render pixel-identical to trunk, and the DOM carries one `data-workspace-key` per workspace row in the new `ws:` form.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add index tests for duplicate environment records, a worktree with no threads, an unseen worktree, a thread with no environment, a subagent family, an archived thread, and two projects sharing one repository. Run `npm test`.
- [ ] Add identity tests proving a key survives an ownership flip from filesystem to bb claims, that an environment with a null path falls back to `environment:<id>`, and that a member worktree gets the feature root as `parentKey`. Run `npm test`.
- [ ] Add a migration test for old manual-order and expansion keys. Run `npm test`.
- [ ] Add a parity test that builds the old project groups and the new index from the same fixture, then asserts the same workspace keys, the same family roots, and the same order.
- [ ] Run `npm run check` and keep the architecture contract green.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `tcodex/glm-5.3-flash-ioa` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Compare the full sidebar at trunk and head. Save `pr2-regression.png`. Pass when the screenshots are pixel-identical.
- [ ] Lane 2. Open a project whose directory has two environment records. Save `pr2-duplicate-env.png`. Pass when one workspace row is drawn.
- [ ] Lane 3. Open a project with a worktree that has no threads. Save `pr2-empty-worktree.png`. Pass when the row is visible and its plus works.
- [ ] Lane 4. Turn on unregistered worktrees. Save `pr2-unseen.png`. Pass when the unseen row appears with its diagnostic.
- [ ] Lane 5. Open a project with a thread that has no environment. Save `pr2-no-env.png`. Pass when the thread sits under its project as today.
- [ ] Lane 6. Open a project with a subagent family. Save `pr2-subagent.png`. Pass when the family stays nested under one root.
- [ ] Lane 7. Settle the last thread of a worktree. Save `pr2-settled-last.png`. Pass when the workspace row remains.
- [ ] Lane 8. Search for a child title. Save `pr2-search.png`. Pass when the parent stays visible as context.
- [ ] Lane 9. Switch to the feature lens. Save `pr2-feature.png`. Pass when the feature view matches trunk.
- [ ] Lane 10. Reorder two worktrees and reload. Save `pr2-reorder.png`. Pass when the order persists.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `buildWorkspaceIndex` wall time over 2000 threads and 200 environments, and full sidebar first paint on the same fixture.
- [ ] Probe. Run a Node benchmark for the index and the performance timeline for the paint, five alternating runs per side.
- [ ] Baseline. Record the trunk paint median first. The index has no trunk counterpart, so record only the head.
- [ ] Rule. Fail when the index median exceeds 25 ms, or when head first paint is more than 10 percent slower than trunk.

**Review gate.** None. PR2 is a pure refactor with no interaction change.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Operator lands PR2.

## 工作区视图与双态开关 (PR3)

**Depends on.** PR2.

**Files.**

- [ ] Edit `plugins/nested-sidebar/lib/organization.ts` so `ORGANIZATION_MODES` is `["threads", "workspaces"]` and the feature axis is gone.
- [ ] Edit `plugins/nested-sidebar/components/inbox/organization-switch.tsx` to render exactly two tabs.
- [ ] Create `plugins/nested-sidebar/lib/workspace-view.ts` for the physical containment tree.
- [ ] Edit `plugins/nested-sidebar/lib/inbox-view.ts` to return `firstLevel` of `threads` or `workspaces`, and to stop hiding the Features project.
- [ ] Edit `plugins/nested-sidebar/components/inbox/view-menu.tsx` to host the machine lens only.
- [ ] Edit `plugins/nested-sidebar/lib/view-preference-store.ts` and `plugins/nested-sidebar/hooks/use-view-preferences.ts` for the stored mode migration.
- [ ] Edit `plugins/nested-sidebar/components/inbox/thread-inbox.tsx` and `plugins/nested-sidebar/components/inbox/inbox-chrome.tsx` to drop the feature selector.
- [ ] Delete `plugins/nested-sidebar/lib/feature-view.ts`, `plugins/nested-sidebar/components/inbox/feature-node.tsx`, `plugins/nested-sidebar/components/inbox/feature-tree-panel.tsx`, and `plugins/nested-sidebar/components/inbox/feature-selector.tsx`.
- [ ] Add tests under `plugins/nested-sidebar/test/`.

**Build.**

- [ ] Map the stored `project` mode to `threads`, `feature` to `workspaces`, and keep `machine` as a lens selectable from the View menu. A stored lens still applies when its data is available.
- [ ] Keep the feature table, the feature dialogs, the feature meta, and the feature agent tools. Remove only the feature organization mode, the feature view, the feature selector, and the `hiddenFeatureIds` view state.
- [ ] Treat a feature as a workspace container. Its root directory is a workspace whose path equals `Feature.rootPath`, and its member worktrees are workspaces with `parentKey` pointing at it. Their owner project may differ, which is the cross-project grouping the feature view used to draw.
- [ ] Build the workspace view from the PR2 index as a physical tree. Project rows draw only workspaces with a null `parentKey`. A feature root draws its root chats first, then its member workspaces, then their chats. A member workspace is never drawn twice, because it is not a root.
- [ ] Label a feature root with the feature name, not the directory leaf. Show the feature glyph, the member count, and the rollup on that row. Keep the existing row menu actions for rename, repositories, notes, finish, and delete.
- [ ] Show the Features project in both modes. It is a normal project whose source holds feature directories, and its root conversations must stay reachable now that no feature view exists. Mark it so its icon and empty state read as the feature container project.
- [ ] Keep the group tab strip filtering projects in both modes. Keep the machine lens in the View menu.
- [ ] Show the two-mode switch at the bottom. Remove `project`, `feature`, and `machine` entries from it.
- [ ] Migrate the stored mode on read with a version bump. An unknown value falls back to `threads`.

**You see.**

- [ ] The bottom switch shows exactly two options labeled Threads and Workspaces. The Features project is visible, a feature root row reads as the feature name, and expanding it lists member worktrees from more than one project with no duplicate row.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add tests for the two-mode derivation, the stored-mode migration, and the machine lens fallback. Run `npm test`.
- [ ] Add tests for workspace view ordering, empty workspace, no-environment thread, containment parenting, no duplicate member row, and the feature root label. Run `npm test`.
- [ ] Add a test that the Features project is visible and its root conversation is reachable in both modes. Run `npm test`.
- [ ] Update `test/organization.test.ts` and `test/organization-switch-dots.test.ts`, delete `test/feature-view.test.ts`, and keep every feature service test green. Run `npm run check`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `tcodex/glm-5.3-flash-ioa` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Compare Threads mode. Save `pr3-threads.png`. Pass when it matches trunk.
- [ ] Lane 2. Switch to Workspaces. Save `pr3-workspaces.png`. Pass when every workspace is a row under its project.
- [ ] Lane 3. Reload in Workspaces mode. Save `pr3-persist.png`. Pass when the mode is still Workspaces.
- [ ] Lane 4. Open a project with one workspace and no threads. Save `pr3-single.png`. Pass when the workspace row is still drawn.
- [ ] Lane 5. Open a thread from a workspace row. Save `pr3-open.png`. Pass when the row is active and the thread opens.
- [ ] Lane 6. Search in Workspaces mode. Save `pr3-search.png`. Pass when matching workspaces keep their ancestors.
- [ ] Lane 7. Open the Features project in Workspaces mode and expand a feature root. Save `pr3-feature-container.png`. Pass when the root chat and member worktrees from at least two projects sit under the feature row, each exactly once.
- [ ] Lane 8. Use the machine lens with two hosts. Save `pr3-machine-lens.png`. Pass when machine sections render.
- [ ] Lane 9. Filter by a group tab in Threads mode. Save `pr3-group.png`. Pass when only that group's projects remain.
- [ ] Lane 10. Open the sidebar with an empty project. Save `pr3-empty.png`. Pass when the project still has a row.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Mode switch latency from click to painted list, and sidebar first paint in both modes.
- [ ] Probe. Ten switches alternating directions per side, and five reloads per mode, read from the performance timeline.
- [ ] Baseline. Record the trunk Threads mode paint first, and the head Threads mode paint as the pair.
- [ ] Rule. Fail when the workspace mode paint exceeds 120 ms at P95, or when the head Threads mode is more than 10 percent slower than trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 7 screenshots into `plugins/nested-sidebar/docs/media/pr3-review-workspaces.png`.
- [ ] Record a 30 to 60 second video of switching modes and opening a workspace. Save it as `plugins/nested-sidebar/docs/media/pr3-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Operator lands PR3 after the review gate.

## 线程头部 Tab 栏与面包屑 (PR4)

**Depends on.** PR3.

**Files.**

- [ ] Create `plugins/nested-sidebar/lib/workspace-tabs.ts` for the pure tab selection and close-neighbor rules.
- [ ] Create `plugins/nested-sidebar/components/header/WorkspaceTabs.tsx`.
- [ ] Create `plugins/nested-sidebar/components/header/WorkspaceBreadcrumb.tsx`.
- [ ] Edit `plugins/nested-sidebar/app.tsx` to register both header components.
- [ ] Reuse the PR2 `WorkspaceRow` for the strip's source of chats.
- [ ] Add `plugins/nested-sidebar/test/workspace-tabs.test.ts`.

**Build.**

- [ ] Select tabs from the workspace table. Visible top-level chats oldest first, plus the current thread when it is a subagent or a hidden side chat.
- [ ] Render the strip with a status glyph, an active underline, a close button that archives, and a plus that opens the new chat panel from PR5. PR4 may leave the plus wired to a placeholder route.
- [ ] Port the pending-close behavior. Closing the active tab navigates to the right neighbor, else the left, and archives only after the next thread is active. The pending record expires after 5 seconds.
- [ ] Render the breadcrumb as project then workspace label. Use the same label rules as the workspace row, including alias over branch.
- [ ] Add the Changes button when the Git plugin's diff tab exists, showing the workspace insertion and deletion counts.
- [ ] Return null when the thread has no environment or the workspace has no chats.

**You see.**

- [ ] Every thread page in an environment shows one tab strip under the header. The header title reads project then workspace instead of the raw thread title.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add tests for tab ordering, current-thread inclusion, close-neighbor selection, and the pending-close expiry. Run `npm test`.
- [ ] Add a test that a thread without an environment renders no strip. Run `npm test`.
- [ ] Run `npm run check`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `tcodex/glm-5.3-flash-ioa` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against Conductor. Open the same workspace at Conductor and at the head. Save `pr4-regression.png`. Pass when the tab order and labels match.
- [ ] Lane 2. Open a workspace with one chat. Save `pr4-single.png`. Pass when one tab renders and no close button is shown.
- [ ] Lane 3. Open a workspace with three chats. Save `pr4-three.png`. Pass when the order is oldest first.
- [ ] Lane 4. Close the active first tab. Save `pr4-close-active.png`. Pass when the second tab becomes active before the first is archived.
- [ ] Lane 5. Close the last tab. Save `pr4-close-last.png`. Pass when the left neighbor becomes active.
- [ ] Lane 6. Open a subagent thread. Save `pr4-subagent.png`. Pass when its own tab appears.
- [ ] Lane 7. Open a hidden side chat. Save `pr4-side-chat.png`. Pass when its tab appears.
- [ ] Lane 8. Open a thread with no environment. Save `pr4-no-env.png`. Pass when no strip renders.
- [ ] Lane 9. Inspect the header title. Save `pr4-breadcrumb.png`. Pass when it reads project then workspace label.
- [ ] Lane 10. Narrow the pane to 320 px with eight tabs. Save `pr4-narrow.png`. Pass when the strip scrolls horizontally and the header does not wrap.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Tab strip mount time and thread switch latency with ten chats in one workspace.
- [ ] Probe. Ten switches between tabs, and ten thread opens from the sidebar, read from the performance timeline.
- [ ] Baseline. Record the Conductor strip at the same fixture first, then the head.
- [ ] Rule. Fail when the head switch P95 exceeds the Conductor baseline by more than 10 percent or by more than 50 ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 3 and lane 4 screenshots into `plugins/nested-sidebar/docs/media/pr4-review-tabs.png`.
- [ ] Record a 30 to 60 second video of opening, switching, and closing tabs. Save it as `plugins/nested-sidebar/docs/media/pr4-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Operator lands PR4 after the review gate.

## 新建会话、Run、Fork 与归档 (PR5)

**Depends on.** PR4.

**Files.**

- [ ] Create `plugins/nested-sidebar/app/new-chat/NewChatPage.tsx` and `plugins/nested-sidebar/app/new-chat/route.ts`.
- [ ] Create `plugins/nested-sidebar/app/scripts/run.ts` and `plugins/nested-sidebar/app/scripts/settings.ts`.
- [ ] Create `plugins/nested-sidebar/app/fork.ts`.
- [ ] Create `plugins/nested-sidebar/components/header/RunButton.tsx`.
- [ ] Edit `plugins/nested-sidebar/components/header/WorkspaceTabs.tsx` to wire the plus, Changes, and Run.
- [ ] Edit `plugins/nested-sidebar/app.tsx` to register the nav panel, the message action, and the command.
- [ ] Add tests under `plugins/nested-sidebar/test/`.

**Build.**

- [ ] Port Conductor's hidden nav panel for a workspace. The composer reuses the environment, and transcript chips insert a thread mention into the draft.
- [ ] Port the run script reader for `.conductor/settings.toml` and `conductor.json`. Keep only the `run` key, because bb owns setup.
- [ ] Run the script in a thread-scoped terminal titled Run, and stop the previous Run terminal unless the mode is `concurrent`.
- [ ] Register the Run command with Mod+R and the same availability rule as Conductor, a thread id that is not null.
- [ ] Port Fork to new workspace as a message action. It forks through the `git-worktree` environment provider on the same host.
- [ ] Add Archive workspace, which archives every thread in the environment through bb's own undo toast.
- [ ] Register every new surface so that no slot is registered twice, and keep the header row additive.

**You see.**

- [ ] The plus opens a new chat page bound to the same workspace, Run opens a terminal, Fork creates a new worktree thread, and Archive workspace empties the row with one undo toast.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add settings parser tests for TOML, JSON, a missing file, and an unknown mode. Run `npm test`.
- [ ] Add run mode tests for concurrent and nonconcurrent. Run `npm test`.
- [ ] Add a route test proving the workspace id survives a reload. Run `npm test`, then `npm run check`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `tcodex/glm-5.3-flash-ioa` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against Conductor. Open the new chat page at both and compare. Save `pr5-new-chat.png`. Pass when the workspace label and composer placement match.
- [ ] Lane 2. Click plus in a workspace with two chats. Save `pr5-plus.png`. Pass when the page names the same workspace.
- [ ] Lane 3. Send a message from the new chat page. Save `pr5-send.png`. Pass when the new thread opens in the same environment and appears as a tab.
- [ ] Lane 4. Click a transcript chip. Save `pr5-chip.png`. Pass when the mention appears in the draft.
- [ ] Lane 5. Click Run with a valid settings file. Save `pr5-run.png`. Pass when a terminal titled Run starts and prints the command.
- [ ] Lane 6. Click Run twice in nonconcurrent mode. Save `pr5-run-nonconcurrent.png`. Pass when only one Run terminal remains.
- [ ] Lane 7. Click Run with no settings file. Save `pr5-run-missing.png`. Pass when the error names `.conductor/settings.toml`.
- [ ] Lane 8. Fork a message to a new workspace. Save `pr5-fork.png`. Pass when a new worktree is created and its thread opens.
- [ ] Lane 9. Archive a workspace with three chats. Save `pr5-archive.png`. Pass when the row empties and one undo toast restores all three.
- [ ] Lane 10. Open the Changes button in a dirty workspace. Save `pr5-changes.png`. Pass when the Git diff tab opens with the plus and minus counts.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. New chat page open time, run start time from click to first terminal output, and fork completion time.
- [ ] Probe. Five runs per action per side, alternating Conductor and head, read from the terminal timeline and the performance timeline.
- [ ] Baseline. Record the Conductor values first for new chat and run. Fork has no Conductor counterpart beyond the same SDK call.
- [ ] Rule. Fail when new chat open exceeds 150 ms, run first output exceeds 1 s, or fork exceeds the Conductor median by more than 15 percent.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, lane 5, and lane 9 screenshots into `plugins/nested-sidebar/docs/media/pr5-review-actions.png`.
- [ ] Record a 30 to 60 second video covering new chat, Run, Fork, and archive. Save it as `plugins/nested-sidebar/docs/media/pr5-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Operator lands PR5 after the review gate.

## 清理、Agent 上下文与默认模式 (PR6)

**Depends on.** PR5.

**Files.**

- [ ] Edit `plugins/nested-sidebar/lib/agent/wire.ts` and `plugins/nested-sidebar/lib/agent/instructions.ts` to read the workspace index.
- [ ] Edit `plugins/nested-sidebar/lib/agent/settings.ts` to remove the `showFeatures` UI setting and keep the feature agent flag.
- [ ] Delete any remaining feature view leftover, including `lib/feature-view.ts`, the feature selector hook, and their tests.
- [ ] Edit `plugins/nested-sidebar/server.ts` where the agent index is primed.
- [ ] Delete `plugins/nested-sidebar/lib/project-order.ts` and its last read path.
- [ ] Delete every Conductor-only dependency and document the uninstall step.
- [ ] Edit `plugins/nested-sidebar/package.json` and bump the plugin version from `0.5.0` to `0.6.0`, because the stored mode vocabulary and the workspace identity key both change.
- [ ] Edit `plugins/nested-sidebar/README.md` and `plugins/nested-sidebar/docs/FEATURE-WORKSPACES-REDESIGN.md` for the two-mode world.
- [ ] Add `plugins/nested-sidebar/test/workspace-context.test.ts`.

**Build.**

- [ ] Make the agent context a function of the workspace index. A thread with an environment gets one short paragraph naming the project, the workspace label, the branch, and the workspace's other chats. A thread without an environment gets nothing.
- [ ] Keep the feature tools and the feature skill exactly as they are. The workspace paragraph is additive and does not replace `featureInstructions`.
- [ ] Remove the `showFeatures` UI setting. Feature rows are part of the workspace tree now, so there is no view to switch off. The agent-side feature flag stays independent.
- [ ] Add a startup guard. When another plugin has registered a tab strip for the same slot, Nest logs one warning and leaves its own strip registered. Never unregister another plugin's row.
- [ ] Remove the legacy `bb.nest.project-order.v1` key after migrating any remaining rows into `manual_order`.
- [ ] Update the README to state that Conductor is replaced, and that its features now live in Nest. Add the uninstall command.

**You see.**

- [ ] With Conductor disabled, the Nest tab strip and breadcrumb still render. With both enabled, only one strip is visible and one warning is logged. A new thread in a worktree starts with a workspace paragraph in its instructions.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add tests for the workspace paragraph for a member worktree, the feature root, and a thread with no environment. Run `npm test`.
- [ ] Add a test proving the feature skill is still selected inside a feature folder. Run `npm test`.
- [ ] Run `npm run check`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `tcodex/glm-5.3-flash-ioa` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Disable Conductor and compare Threads mode. Save `pr6-regression.png`. Pass when it matches trunk.
- [ ] Lane 2. Enable both plugins. Save `pr6-both-plugins.png`. Pass when exactly one tab strip renders and one warning is logged.
- [ ] Lane 3. Start a thread in a worktree and ask what workspace it is in. Save `pr6-agent-workspace.png`. Pass when the answer names the project, workspace, and branch.
- [ ] Lane 4. Start a thread with no environment and ask the same. Save `pr6-agent-none.png`. Pass when no workspace paragraph is present.
- [ ] Lane 5. Start a thread in a feature folder. Save `pr6-agent-feature.png`. Pass when the feature skill and tools are still present.
- [ ] Lane 6. Measure thread start latency with the new paragraph. Save `pr6-start-latency.png`. Pass when the added time stays under the perf rule.
- [ ] Lane 7. Reload after the legacy key migration. Save `pr6-legacy-key.png`. Pass when the key is gone and the manual order is intact.
- [ ] Lane 8. Follow the README quick start on a clean profile. Save `pr6-readme.png`. Pass when every step works without Conductor.
- [ ] Lane 9. Install Nest fresh and open a thread. Save `pr6-fresh-install.png`. Pass when both header slots render.
- [ ] Lane 10. Uninstall Conductor and reload. Save `pr6-uninstall.png`. Pass when no error appears and the strip remains.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Thread start latency added by `agents.configure`, and extension bundle size.
- [ ] Probe. Twenty thread starts with Conductor disabled, alternating trunk and head, plus the built bundle size from `npm run build`.
- [ ] Baseline. Record the trunk added latency and bundle size first.
- [ ] Rule. Fail when configure adds more than 20 ms at P95, or when the app bundle grows by more than 2 percent.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 3 screenshots into `plugins/nested-sidebar/docs/media/pr6-review-agent.png`.
- [ ] Record a 30 to 60 second video of a new thread receiving the workspace paragraph. Save it as `plugins/nested-sidebar/docs/media/pr6-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Operator lands PR6 after the review gate.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.
- [ ] Post the final comparison against the predicate. Two modes exist, Conductor is removable, and every workspace surface reads from the same table.

## Appendix A. Prototype evidence

No prototype branch has run yet. Two probes gate PR1 and PR3, and their results go here before the program starts.

- [ ] Probe 1. SDK slot smoke test. Branch `probe/sdk-slots`, a copy of Nest with only the dependency bump and two null header registrations. Artifact is a boot log and one screenshot. The question it answers is whether `0.6.141` changes any `experimental_threadList` or `PluginSidebarThread` shape that Nest cannot adapt in one PR.
- [ ] Probe 2. Workspace-first layout sketch. Branch `probe/workspace-layout`, a static page built from the fixture data. Artifacts are three screenshots at 320 px, 768 px, and 1440 px. The question it answers is whether a flat chat list under a workspace row is readable without the family tree.

Each question that stays unproven is listed here with the reason.

## Appendix B. Alternatives rejected

- Sharing the header slot with Conductor and letting both plugins register. Rejected because `experimental_threadHeaderTitle` lets only the first plugin win, so the breadcrumb owner becomes install-order dependent, and two strips stack in one pane.
- Persisting a workspace table in SQLite. Rejected because bb already owns the environment record, and a second table would drift the moment a thread is created outside Nest.
- Adding a fourth organization axis. Rejected because the operator asked for two modes, and a fourth axis repeats the workspace semantics in a second place.
- Moving features onto the workspace table. Rejected because a feature is a directory that groups several worktrees, which is a different question from which environment a thread runs in. The accepted design keeps the Feature record and makes its directory a workspace container, so neither question is lost.
- Keeping Feature as a lens in the View menu. Rejected because a lens still owns a first-level tree, a selector, and a hidden-id list, which is exactly what keeps it a first-class citizen.
- Removing the Feature table and deriving everything from directories. Rejected because a feature shell needs a name, a slug, a state, and an empty directory before any worktree exists, and those are user decisions.
- Keeping the Features project hidden. Rejected because the root conversations run there, and with no feature view left they would be unreachable.

## Appendix C. Risks

- SDK upgrade risk. `0.6.141` removes two APIs Nest uses and changes the thread activity shape. PR1 confines the breakage, and the probe measures the rest.
- Double strip risk. If Conductor stays enabled, two header rows appear. PR6 adds the guard and the README states the uninstall step.
- Feature regression risk. The separate feature view disappears. PR3 keeps the feature table, dialogs, metadata, and agent tools, and it proves a feature root row expands into member worktrees from more than one project.
- Path identity risk. Two environments can point at one directory. PR2 keeps the existing merge rule and tests the duplicate-record case.
- Agent latency risk. `configure` runs synchronously on thread start. PR6 budgets 20 ms and measures it.

## Appendix D. Links and reading list

- Conductor source, `app/tabs/model.ts` and `app/tabs/WorkspaceTabs.tsx` for tab selection and close behavior.
- Conductor source, `app/sidebar/model.ts` for the environment-keyed workspace derivation.
- Conductor source, `app/sidebar/reads.ts` for the Git and pull request keyed reads.
- Conductor source, `app/new-chat/NewChatPage.tsx` and `app/scripts/run.ts` for the new chat and run script.
- Nest source, `lib/workspace.ts`, `lib/workspace-ownership.ts`, and `lib/tree.ts` for the current workspace identity.
- Nest source, `lib/inbox-view.ts` and `lib/organization.ts` for the mode seam.
- Nest docs, `docs/FEATURE-WORKSPACES-REDESIGN.md` for the path-derived feature model.
- PRs that get `pstack/skills/how/SKILL.md` and `pstack/skills/interrogate/SKILL.md` are PR2 and PR3. The rest get the investigation only after their design is settled.
- The decision trail follows `pstack/skills/show-me-your-work/SKILL.md`.

## Appendix E. Open decisions

- D1. Tab strip visibility in Threads mode. Recommendation is visible in both modes, because the strip belongs to the thread header, not to the sidebar axis. The operator confirms before PR4.
- D2. Where the machine lens lives. Recommendation is the View menu. The feature is no longer a lens at all, because it becomes a workspace container. The operator confirms before PR3.
- D3. Whether a workspace row can be archived from the sidebar in Threads mode. Recommendation is yes, through the same action as Conductor. The operator confirms before PR5.
- D4. Whether the Features project is visible in both modes. Recommendation is yes, because its root conversations have no other entrance once the feature view is gone. The operator confirms before PR3.

## Appendix F. Revision history

- v3, 2026-11-13. Feature leaves the organization axis completely. A feature root becomes a workspace container, member worktrees become its `parentKey` children, the feature view, selector, and hidden-id list are deleted, and the Features project becomes visible so root conversations stay reachable.
- v2, 2026-11-13. Adds the before and after wireframes, replaces the single `WorkspaceRef` table with the three-layer `WorkspaceIndex`, moves the parent and children chips to `experimental_threadContextSegment`, bumps the plugin to `0.6.0`, and records the open decisions D1 to D3.
- v1, 2026-11-13. First six-PR plan after the three read-only surveys of the Nest view pipeline, domain model, and data pool.

## Appendix G. WorkspaceIndex data structure

This appendix records the recommendation and the reasoning. PR2 implements it.

### G1. What is wrong with the current shape

- Four key shapes describe one workspace. `WorkspaceRef.key` is `workspace:<host>:<project>:<path>`. A thread with a missing descriptor gets `environment:<id>`. An unseen worktree gets `unseen:<project>:<host>:<path>`. `WorkspaceOwnership.workspaceKey` gets `physicalWorkspaceKey(host, path)`. Only exact string equality merges rows, so one directory can split into several.
- Project id is inside the identity key. Flipping the `workspaceOwnership` preference from filesystem to bb claims changes `ownerProjectId`, which changes the key, which orphans the stored worktree order and the stored expansion.
- Three parallel derivations exist. `buildTree` scans families, all environments, and unseen worktrees per project. `buildFeatureView` calls `workspaceRefOf` per family. The tab strip would be a third.
- Ownership is a parallel map with its own key, so the row, the ownership diagnostic, and the order all speak different identity languages.
- Unseen worktrees are a separate type. Every row component has to branch on the absence of an environment.
- The client snapshot of `WorkspacePaths` is persisted, so one view can read a stale path while another reads the live one.

### G2. The proposed layers

```ts
type WorkspaceKey = `ws:${string}:${string}` | `environment:${string}`;

interface WorkspaceIdentity {
  key: WorkspaceKey;
  hostId: string;
  path: string | null;
  parentKey: WorkspaceKey | null;
  childKeys: readonly WorkspaceKey[];
  repoKey: string | null;
  isGitRepo: boolean;
  isWorktree: boolean;
  isMainCheckout: boolean;
  branch: string | null;
  detached: boolean;
  claimedProjectIds: readonly string[];
  ownerProjectId: string;
  conflict: boolean;
  source: "environment" | "git-worktree" | "directory";
}

interface WorkspaceRecord {
  environmentId: string;
  projectId: string;
  providerId: string | null;
  name: string | null;
  branchName: string | null;
  isWorktree: boolean;
}

interface WorkspaceBinding {
  key: WorkspaceKey;
  records: readonly WorkspaceRecord[];
  canonicalEnvironmentId: string | null;
  launchable: boolean;
}

interface Workspace {
  identity: WorkspaceIdentity;
  binding: WorkspaceBinding;
  label: string;
  alias: string | null;
  chats: readonly ThreadFamily[];
  threads: readonly PluginSidebarThread[];
  primary: PluginSidebarThread | null;
  rollup: StatusRollup;
  featureId: string | null;
}

interface WorkspaceIndex {
  list: readonly Workspace[];
  roots: readonly Workspace[];
  byKey: ReadonlyMap<WorkspaceKey, Workspace>;
  byEnvironmentId: ReadonlyMap<string, WorkspaceKey>;
  byProject: ReadonlyMap<string, readonly Workspace[]>;
  byPath: ReadonlyMap<string, Workspace>;
  byFeature: ReadonlyMap<string, readonly Workspace[]>;
  childrenOf: (key: WorkspaceKey) => readonly Workspace[];
}
```

### G3. The rules

- One physical directory is one workspace. `key` is host plus normalized path. Project is ownership metadata, not identity.
- Every bb environment pointing at that directory becomes a `WorkspaceRecord` inside `binding.records`. No record wins by being first in an array.
- `canonicalEnvironmentId` is the record bb will accept for the derived owner. It prefers a record whose claimed project equals `ownerProjectId`, then a non-personal provider, then `project-checkout`, then `git-worktree`, then id order.
- `launchable` is false only when `records` is empty. An unseen git worktree is launchable through adoption, which is a separate action.
- A thread binds by environment id first, then by its environment path, then to its own `thread:<id>` pseudo workspace. A subagent binds to its root's workspace unless it carries its own environment.
- `featureId` is derived by path containment, then by adoption. It is a field on the workspace, not a separate pass.
- `parentKey` is the longest other workspace path that contains this one on the same host, and only when that parent is a feature root. A feature root is the workspace whose path equals `Feature.rootPath`. A member worktree points at it, and a feature root label is the feature name.
- A workspace with a `parentKey` is drawn under its parent in workspace mode and is not repeated under its owner project. This is what makes a cross-project feature one visible container without a second tree.
- The index is built once per render pass from live threads, environment descriptors, project sources, repo facts, and unseen worktrees.

### G4. Storage impact

- `manual_order` workspace keys and `view_state.expandedWorkspaces` need a one-time migration from the old shapes to `ws:<host>:<path>`. The migration is a pure function over the old key, the environment descriptor, and the workspace record.
- `feature_workspace_labels` keeps `environment_id` and gains `workspace_key`. Reads prefer `workspace_key` and fall back to `environment_id`. Path containment still wins over any label.
- `WorkspacePaths` stays as a cold-start cache only. The index builder is its only reader, and a stale cache can never change identity because the key comes from the path in the descriptor.

### G5. What stays stored

Only decisions bb cannot answer. The feature rows, feature adoptions, feature branch records, feature briefs and decisions, groups and assignments, manual order, view preferences and view state, lifecycle rows, appearance, colors, icons, and agent tool flags. Everything else becomes derived.

### G6. Edge cases and tradeoffs

- An environment with a null path has no physical identity. It keeps `environment:<id>` and is marked `source: "environment"`. It cannot merge with a path row.
- A renamed directory changes the key. The environment id survives, so the index can keep a session map from environment id to the previous key and the order migration can carry the row forward. A permanent rename is rare and this is the cost of physical identity.
- Symlinks and case differences can produce two paths for one directory. Normalization handles separators and trailing slashes only. A realpath pass would need a host read and is deliberately out of scope.
- Two hosts with the same path stay two workspaces because the host is in the key.
- A personal workspace is not a workspace row. It maps to `NO_WORKSPACE`, exactly as today.

### G7. Why the path key and not the environment id

Conductor keys by environment id because it does not need to merge duplicate records and does not draw worktrees that bb does not know. Nest needs both. The path is the only fact that both a bb record and a raw `git worktree add` agree on, and the codebase already derives `physicalWorkspaceKey` from it. Making that the one key removes the project from identity, so an ownership flip stops breaking stored order.
