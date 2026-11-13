# Gates: ecosystem absorption

OWNS: lib/**, hooks/**, components/inbox/**, server.ts, test/**, README.md, PLAN-ECOSYSTEM.md, GATES-ECOSYSTEM.md

Scope: bring the capabilities Nest lacks — from bb's own sidebar and from the other sidebar-replacing plugins in the BB Community marketplace — into this plugin, one item at a time, each landing green and leaving no dead path behind.

Baseline before this work: 467 tests / 113 suites passing, `npx tsc --noEmit` clean, `npm run build` writing `dist/{server,app,host}`.

The research this rests on is a read of bb `main` (`apps/app/src/components/sidebar/`, 60 files) and of every sidebar-replacing marketplace plugin. The clones are kept read-only under `../.scratch/` and are gitignored.

---

## A4: gate split affordances on `isAvailable`

- [x] A4.1: every open-in-split affordance is gated on `isAvailable`, never on `layout`
  CHECK: `node --test --experimental-strip-types test/split-contract.test.ts`
  EXPECT: split availability verified
  EVIDENCE: 5 tests. `splitAvailable={isAvailable}` appears 4 times (root context menu, root menu, child context menu, child menu); `splitAvailable={layout` appears 0 times; both `isAvailable` and `layout` are destructured at each of the 2 call sites; `...splitProps` still spreads twice. `test/split-contract.test.ts`.

- [x] A4.2: the pane tint still reads `layout`, which is a different question
  CHECK: `rg -n 'layout !== null' components/inbox/thread-card.tsx`
  EXPECT: the two tints remain
  EVIDENCE: `!familyIsActive && layout !== null` (root family) and `!isActive && layout !== null` (child row) both kept. The distinction is documented at the root destructure site: `isAvailable` is the permission, `layout` is the state.

## A5: the spawn path must close the mobile drawer

- [x] A5.1: `pendingOpenId` calls `onNavigate` after opening
  CHECK: `node --test --experimental-strip-types --test-name-pattern='spawn path' test/modal-contract.test.ts`
  EXPECT: spawn path closes the drawer
  EVIDENCE: `sidebarActions.open(pendingOpenId)` is followed by `onNavigate()`, with `onNavigate` added to the effect's deps. The effect sets `pendingOpenId` to null before opening, so a re-run from a changed `onNavigate` identity is a no-op. `test/modal-contract.test.ts`.

## A2: error-state retry and transient-read tolerance

- [x] A2.1: a failed refresh keeps the tree standing instead of blanking it
  CHECK: `node --test --experimental-strip-types test/thread-snapshot.test.ts`
  EXPECT: stale-not-broken verified
  EVIDENCE: 10 tests. `error` with a retained answer resolves to `stale` and keeps the rows; `loading` with a retained answer also resolves to `stale`, because a host that went back to loading is refetching rather than empty; a retained host answer outranks a recovery; a recovery is not adopted while the host is merely loading.

- [x] A2.2: the retry is a real read of bb's thread table, not a re-render
  CHECK: `node --test --experimental-strip-types test/recovery-wiring.test.ts`
  EXPECT: recovery is backed by a read
  EVIDENCE: 8 tests. `experimental_useSidebarThreads` exposes no refetch, so the retry goes through the plugin's own `listThreadsForRecovery`, which pages `bb.sdk.threads.list({ archived: false })` and resolves host names from `bb.sdk.hosts.list()`. The wiring test pins the call, the handler, and the SDK read.

- [x] A2.3: hidden threads stay out of the recovery read
  CHECK: `rg -n 'visibility === "visible"' server.ts`
  EXPECT: hidden threads excluded
  EVIDENCE: `listVisibleThreadRows` does not pass `includeHidden` and filters on `visibility === "visible"` anyway; the wiring test asserts both. The host's sidebar view draws visible threads, so a recovery that resurrected hidden ones would show rows bb keeps out on purpose.

- [x] A2.4: a degraded view says so, and a failed retry says why
  CHECK: `rg -n 'threadViewNotice|recoveryError' lib/thread-snapshot.ts components/inbox/thread-view-status.tsx`
  EXPECT: both surfaces present
  EVIDENCE: `threadViewNotice` returns the copy for `stale` and `recovered` and null otherwise, tested for all four sources. `ThreadViewNotice` renders above the tree; `ThreadLoadFailure` owns the scroll area only when there is nothing to draw, and renders the retry's own failure reason.

- [x] A2.5: the shared row→thread vocabulary is in one place, and no forwarding wrapper survives
  CHECK: `rg -n 'settledIndicator|thread-indicator' lib components hooks test server.ts`
  EXPECT: no matches
  EVIDENCE: `lib/sidebar-thread-row.ts` owns `deriveIndicator`, `isUnread`, `originKindFor`, and `workspaceDisplayKindFor`; `lib/settled-threads.ts` and `lib/recovery-threads.ts` both build on it. The first draft added a pass-through `settledIndicator` wrapper; it was collapsed into the shared name and `test/settled-threads.test.ts` re-pointed, so one thing has one name.

- [x] A2.6: the plugin typechecks, builds, and the whole suite passes
  CHECK: `npm test && npx tsc --noEmit && npm run build`
  EXPECT: A2 build passed
  EVIDENCE: 501 tests / 119 suites, 0 failures; typecheck clean; build wrote `dist/{app.js,app.css,app.meta.json,host.js,host.js.map,host.meta.json}`.

---

## A1: `commandPaletteAction` for Nest's verbs

- [x] A1.1: four palette rows, each gated on the mounted inbox
  CHECK: `node --test --experimental-strip-types test/palette-bridge.test.ts`
  EXPECT: palette bridge verified
  EVIDENCE: 11 tests across 2 suites. Rows: `settle-thread`, `snooze-thread`, `wake-thread`, `show-needs-you`. The settle and snooze rows are gated on `canPark`, the wake row on `isParked` (opposite questions, so neither offers an action the thread cannot take), and the view row on the inbox merely existing.

- [x] A1.2: the bridge survives a remount, and reads as empty when no inbox is mounted
  CHECK: `rg -n 'forgetNestActions' lib/palette-bridge.ts`
  EXPECT: identity guard present
  EVIDENCE: `forgetNestActions` clears the slot only when the caller is still the current publisher, because a remount publishes before the old cleanup runs. Every reader returns null or false rather than throwing, so a user with bb's own list pinned sees no rows instead of rows that do nothing.

- [x] A1.3: the dispatcher is published once, so the slot cannot blink to null
  CHECK: `rg -n 'publishNestActions' components/inbox/thread-inbox.tsx`
  EXPECT: published once with a latest-value ref
  EVIDENCE: The effect has an empty dep array and every verb reads the latest `lifecycle`/`threads`/`patchViewState` through `paletteRef`, written during render. Republishing per render would run a cleanup first, and the palette's `isAvailable` runs while the palette is open — exactly when a blink would hide a row.

---

## A3: one row, two drags

- [x] A3.1: the split gesture and the reorder drag coexist without either yielding
  CHECK: `node --test --experimental-strip-types test/split-contract.test.ts`
  EXPECT: both drags verified
  EVIDENCE: 9 tests across 2 suites. Nest solves the conflict by *separation* rather than by axis-gating: the full-bleed anchor carries `{...splitProps}` and the row's content is `pointer-events-none`, so a press on the title reaches the anchor and starts bb's gesture; the reorder handle is the status icon, `draggable={reorderEnabled}` and `relative z-10` above the anchor, so a press on it is a press on the icon. The new tests pin all four facts, and that `splitProps` is never spread onto the handle — making the whole row draggable reads like a simplification and would silently break the split gesture.

- [x] A3.2: a parked row is a split source too
  EVIDENCE: `SlimRow` now calls `useSidebarThreadSplit`, spreads `splitProps` on its anchor, and tints a thread open in another pane. The shelves were the one place a row opened on modifier-click but could not be dragged out.

## B6: coalesce a burst of realtime publishes

- [x] B6.1: the window has both edges, so coalescing never delays the user's own action
  CHECK: `node --test --experimental-strip-types test/realtime-coalesce.test.ts`
  EXPECT: coalescing policy verified
  EVIDENCE: 10 tests across 2 suites. `coalesceDecision` reads at once for the first publish of a burst and for the first after a quiet window, schedules exactly one trailing read for the rest, swallows every further publish while one is armed, and never schedules a zero-or-negative delay. The leading edge is load-bearing: `settle`/`snooze`/`unsettle` are **not** optimistic — the write publishes and the subscription is what moves the row — so a trailing-only window would put the coalescing delay in front of the user's own click.

- [x] B6.2: every realtime subscription in the plugin coalesces
  CHECK: `rg -n 'useRealtime\(' hooks`
  EXPECT: only the wrapper
  EVIDENCE: All seven call sites now use `useCoalescedRealtime`: `lifecycle` (twice — the lifecycle store and the settled shelf, which is the busiest channel the sidebar reads), `project-icons`, `project-colors`, `ORDER_CHANNEL`, `GROUP_CHANNEL`, `VIEW_PREFERENCE_CHANNEL`. The test walks the whole `hooks/` directory rather than naming files, so a hook added later cannot subscribe without it; `useRealtimeConnectionState(` does not match the bare-name pattern.

- [x] B6.3: a trailing read cannot fire after unmount
  CHECK: `rg -n 'clearTimeout\(trailing' hooks/use-coalesced-realtime.ts`
  EXPECT: cleared on unmount
  EVIDENCE: The wrapper clears the pending timer in its cleanup, and `refresh` is read through a ref so a caller whose `refresh` changes identity per render (every `useRetryingRead` result) does not rebuild the subscription per render.

## B5: rename in the row

- [x] B5.1: one shared field, four levels, and no dialog left
  CHECK: `node --test --experimental-strip-types test/rename-contract.test.ts`
  EXPECT: inline rename verified
  EVIDENCE: 7 tests. `components/inbox/rename-field.tsx` is used by the thread card (root and child), the parked row, and the worktree alias; `WorkspaceNameField` and `thread-rename-dialog.tsx` are gone, and the test walks `components/inbox/` to prove the dialog file no longer exists. The menu now hands the request back (`onSelect: onRename`, `return { items }`) instead of owning a dialog, because the field has to replace the title it renames and a menu cannot draw inside the row it was opened from.

- [x] B5.2: the field's rules are the ones every inline editor has, plus the two this one needs
  EVIDENCE: Enter commits, Escape cancels, blur commits (leaving the field is not a way to lose what was typed), and `done` latches so the blur of an unmounting input cannot commit a second time. The empty-draft rule is deferred to the caller's `renameIntent`, so clearing the field cannot rename a thread to nothing. The field opts back into pointer events — a thread row's title sits in a `pointer-events-none` container so the full-bleed anchor receives the press — and stops them reaching that anchor.

- [x] B5.3: a refused rename is announced rather than swallowed
  EVIDENCE: The row announces through the sidebar's live region. The event was named for copying (`nest:copy-announcement`, `announceCopy`); it is now `nest:announcement` / `announceToSidebar`, because a rename the host refuses has the same problem and the same answer — the field is gone by then and the title on screen is the one the store still holds, so the row is already telling the truth.

---

## B1: a cross-project Pinned section

- [x] B1.1: pinned roots leave their projects and gather above the tree
  CHECK: `node --test --experimental-strip-types test/pinned.test.ts`
  EXPECT: pinned section verified
  EVIDENCE: 24 tests across 5 suites. `splitPinnedFamilies` takes every project's pinned roots out of the tree (a project left with nothing is dropped, and a child stays with its pinned parent), and `PinnedSection` draws above `treeNodes`. The split runs **after** search and the filter, so a pinned row obeys both, and **before** the group scope, which it deliberately ignores — a pin that vanishes because the user is looking at another group is the failure the section exists to fix. Bulk selection is unaffected: a pinned thread was never bulk-eligible.

- [x] B1.2: the order is bb's own, read from bb's own sort key
  EVIDENCE: `listPinnedOrder` pages `bb.sdk.threads.list`, filters on `pinnedAt`, and sorts by `pinSortKey` compared **by codepoint** — bb's own comparison, which is why the key is a string. `localeCompare` is explicitly not used: a locale-aware compare would order the keys differently on a machine whose locale disagrees with the host's. A row pinned before the key existed falls back to the pin time.

- [x] B1.3: reordering writes bb's order, not a private one
  EVIDENCE: `reorderPinned` routes to `bb.sdk.threads.reorderPinned` — the same mutation the built-in sidebar drags by — so a pin moved here is in the same place there. `pinnedNeighbours` computes the pair bb's API wants (the ids either side of the drop, read from the list *without* the row being moved) and refuses an unknown or same id rather than guessing: a reorder that moves the wrong row is worse than one that does nothing.

- [x] B1.4: a read that has not caught up never hides a row
  EVIDENCE: `orderPinnedFamilies` appends anything the order does not name, newest first, so a pin made on another client shows up rather than disappearing until the next read. The read is keyed on the **set** of pinned roots rather than their order, because a reorder writes and then re-reads and a key that changed on every reorder would leave those two reads racing. The hook also re-reads when the window regains focus, which is how another client's pure reorder converges.

- [x] B1.5: one row component, two reorder targets
  EVIDENCE: the section draws `FamilyRow`, so a pinned thread keeps its status, children, menu, split gesture, and rename. Only the reorder differs: a pinned row's drag carries `application/x-nest-pinned`, its own type, and the drop belongs to the list rather than the row — a drop lands *between* two rows, and only the list knows which two. Alt+Up/Down moves one position, placing before the row above and after the row below.

---

## B2: the machine axis, and the workspace level as a choice

- [x] B2.1: the tree's first level can be the machines the projects live on
  CHECK: `node --test --experimental-strip-types test/organization.test.ts`
  EXPECT: organization modes verified
  EVIDENCE: 20 tests across 6 suites. No second tree builder: the first level is "a bucket keyed by an id with a name and an icon", so `buildTree` takes the organization's `assignment` and `sections` and nothing below it changed. A project is filed by the machine its **checkout** lives on, because that is the answer a user means by "where does this project live"; its worktrees elsewhere stay under it, since splitting a project across machines would draw one project twice.

- [x] B2.2: a machine bb does not know gets a named bucket, not a guess
  EVIDENCE: A project with no source host lands in `Unknown machine`, and that section sorts last. A host no thread names falls back to its id — opaque, but true. Names come from `PluginSidebarThread.host.name`, which is the only place a host name is resolved for a plugin; the first name wins so a section's title cannot flip on array order.

- [x] B2.3: the scope strip follows the organization
  EVIDENCE: The strip is built from `organization.sections` and the scope filter and tab counts read the same assignment, so a tab cannot count rows its own filter then hides. A stored scope resolves against the **organization's** ids, which is what makes a mode change safe: a group id is not a machine id, so a scope left on a group degrades to All the moment the tree stops drawing groups. `Ungrouped` stays a group-mode destination.

- [x] B2.4: the project arrangement buckets by the same section the tree draws
  EVIDENCE: `orderProjectGroups` takes the organization's assignment, so in machine mode a project sorts inside its machine rather than inside a group the tree is not drawing. Found while wiring: the ordering was still bucketing by group, which would have made the arrangement and the drawn tree disagree.

- [x] B2.5: the mode is a standing choice, stored and reset
  EVIDENCE: `organizationMode` lives in the view-preference store and its snapshot codec, decoded **strictly** like every other field there — the file's own documented policy is to reject a snapshot from before a field existed rather than guess, and the first draft of this field was lenient until the existing tests showed the inconsistency. `Reset view` now resets it, and resets the worktree lens it had been forgetting.

---

## B3: windowing that keeps the shortcut contract

- [x] B3.1: the arithmetic is pure, and both safety rules are stated in it
  CHECK: `node --test --experimental-strip-types test/windowing.test.ts`
  EXPECT: windowing verified
  EVIDENCE: 21 tests across 6 suites. `rowWindow` walks per-row offsets rather than dividing by a row count, because a collapsed family is one line and an expanded one is a card plus its children. A row that is not realized still occupies its measured height (or an estimate), and still answers its shortcut.

- [x] B3.2: a spacer carries the anchors its rows would have carried
  EVIDENCE: `spacerShortcutIds` splits the unrendered keys into the two spacers **in order**, because bb's numbered jumps query the DOM in visual order and that order is the shortcut order. The spacer renders `data-sidebar-thread-shortcut-target` and `data-sidebar-thread-id` anchors inside a `hidden` span — a programmatic `.click()` reaches a hidden element — so a thread that is not on screen still answers its jump. A row that is merely absent takes its shortcut with it, silently, which is the one failure windowing cannot have.

- [x] B3.3: windowing stands down whenever a spacer would break an interaction
  EVIDENCE: `mayWindow` is `!selectionMode && !reorderEnabled`: a spacer is neither a drop target nor a checkbox, so a drag cannot land between two rows and a bulk selection cannot silently miss one. Below `WINDOWING_THRESHOLD` rows it declines too, because the observer is itself work — so the common case renders exactly the tree it always rendered, and the guard is a condition rather than a hope.

- [x] B3.4: it measures through the attribute a row already carries
  EVIDENCE: Rows are `<li>`s inside the list, so the measurement key is the `data-nest-family` each row already has. There is deliberately no wrapper: a wrapper would be a second box in every list, and an `<li>` inside an `<li>` is not markup this sidebar ships. The list finds its scroll container by walking up to `[data-nest-scroll]` rather than by a prop threaded through four levels.

---

## C4: the one question the sidebar asks outside its own dialogs

- [x] C4.1: a real subject, not a hollow slot
  CHECK: `node --test --experimental-strip-types test/unarchive-retry.test.ts`
  EXPECT: unarchive retry verified
  EVIDENCE: 14 tests across 3 suites. The subject is the failure the README has carried a paragraph about since settling landed: un-settling takes bb's archive off a thread and that runs on the thread's own machine, so an unreachable machine leaves the thread archived and it simply leaves the sidebar. Found while wiring: `unarchiveThreads` **swallowed** that failure — it logged a warning and returned — which is exactly what made it invisible. It now returns the failure, and `unsettle` asks about it.

- [x] C4.2: the retry is a button, raised through the host
  EVIDENCE: The backend calls `bb.ui.requestInput` with `rendererId: "unarchive-retry"`, and `app.slots.pendingInteraction` registers that renderer. One retry, on the user's word; a second failure is logged like the first and the row is cleared as before, because the thread is still in bb's archived view. A prompt that could not be raised does not fail the RPC — the thread is where it was either way.

- [x] C4.3: the payload is parsed rather than trusted, and a timeout is a dismissal
  EVIDENCE: `parseUnarchiveRetryPayload` rejects anything it did not write, and a payload this build cannot read renders "this came from a newer version of Nest" with a single dismiss — never a guessed retry. `unarchiveRetryApproved` is one function for two questions that are really one: a prompt that timed out, a user who closed it, and a submission carrying something else all mean "do not touch bb's archive again". The timeout is ten minutes rather than the host's one-hour cap, because a prompt about a thread the user has moved on from is worse than no prompt.

---

## C3: the arrangement cannot be silently clobbered

- [x] C3.1: every order write carries the revision its arrangement was read at
  CHECK: `node --test --experimental-strip-types test/order-store.test.ts`
  EXPECT: order revision verified
  EVIDENCE: 12 tests across 2 suites. `manual_order_revision` is one row holding a counter that every write bumps, and the three setters take a `baseRevision` and refuse a stale one. Refused rather than merged: the caller can only act on an arrangement it has actually seen, and a merge would invent a third order neither client asked for. Found while wiring: a removal changes the arrangement too, so `removeGroup` and `removeProject` bump as well — the row a stale client is moving may be the one that just went away.

- [x] C3.2: the answer is actionable, not just a refusal
  CHECK: `node --test --experimental-strip-types test/order-revision-wiring.test.ts`
  EXPECT: revision wiring verified
  EVIDENCE: 8 tests. Every write answers with `revision` and `stale`, refusals included, so a refused caller always knows what to reload at. `stale` is its own flag rather than a third reason: it is the one refusal the user can act on, and a client that could not tell it from a malformed id would have nothing to say. A stale refusal does not publish — nothing changed, so a round trip per refused drag would be waste.

- [x] C3.3: the client reads the revision at send time, and tells the user
  EVIDENCE: The revision lives in a ref, not in state: a write reads it at the moment the row is dropped, and a value closed over by the handler would be the revision of the render that created it. A read deliberately does **not** clear the stale state — a read follows a refused write as well as a reload, so clearing there would hide the refusal that had just raised it. The notice names what happened and carries the one button that fixes it.

---

## Live regression in the running app

Run against bb at `http://127.0.0.1:38886` with `nested-sidebar@0.2.0` reloaded from this
working tree, driven through the Chrome DevTools protocol. `ego-browser` is not installed on
this machine, so the available browser surface was used instead.

**Verified working, end to end:**

- **B2** — the View menu's `Organize` row leads, and switching to **By machine** re-draws the
tree's first level as machines: `果园的Mac mini` (a host name resolved from a thread's
`host.name`) with projects and workspaces under it, and `Unknown machine` last. The scope
strip and the menu label both followed.
- **A1** — the palette lists `Nest: show threads that need you`; on a **quiet** thread it also
lists `settle thread` and `snooze thread until tomorrow`; on the **working** thread it lists
only the view row, and `wake thread` is absent while nothing is parked. The `isAvailable`
gating answers real state rather than a blanket yes.
- **B5** — the row's context menu offers `Rename` with **no ellipsis** beside `Delete…` with
one; choosing it mounts an inline field, not a dialog; the title lands in the server and the
sidebar re-reads it (renamed, then restored).
- **B1** — pinning a thread makes the Pinned section appear with a `Pinned`/count header and
exactly that row; unpinning removes it.
- **A4** — the context menu offers `Open in split`, so `splitAvailable` is true where splits are.

**Defects found here and fixed:**

- [x] L1: an inline rename did not take the focus, and then could not stay open
  EVIDENCE: first run — the field rendered with the right label and value and was **not**
  focused, so the user had to click the thing they had just asked for; `autoFocus` loses to
  Radix restoring focus to the menu trigger after the field mounts. Second run, after a
  one-shot focus: the field **vanished** — the restore blurred it a frame later, and
  commit-on-blur unmounted it before anything could be typed. Fixed by insisting on the focus
  for a bounded 200ms window and ignoring a blur that arrives before the field has ever held
  focus. Re-verified: present, focused, whole title selected, Enter commits, restore lands.
- [x] L2: a folded row said its dominant state twice
  EVIDENCE: the rollup jump button read `"Jump to the thread that Working · 1 working"` — the
  title prefixed the dominant label to a summary whose first entry already named it. The
  summary is complete on its own. Re-verified as `"Jump to the thread that 1 working"`.
- [x] L3: the rename field was a form control with no `id` or `name`
  EVIDENCE: the only DevTools issue the run produced was "A form field element should have an
  id or name attribute (count: 3)", and a scan of the page found the offenders were these
  fields and nothing else. `aria-label` names a control for a screen reader, which is not the
  same thing. Now `useId()` + `name`, so several rows can have one mounted at once.

**Not triggered, and why:** the stale/recovery notices (A2) need a host read failure; the
order-changed notice (C3) needs two clients writing the arrangement; the unarchive prompt (C4)
needs an unreachable host; windowing (B3) needs a list past 80 rows. All four are covered by
unit and contract tests rather than by the run.

---

## C1: bb's own list, one click away

**Half of this item was reverted, on the operator's challenge, and the reversal is the
recorded outcome.** It had been framed as "the `experimental_sidebarNavigation` slot,
plus `Original` as an escape hatch", and the first version replaced the host's navigation
region with an icon-sized arrangement of the same destinations. That is gone. What is
left is the half that solves an observed problem.

- [x] C1.1: bb's own thread list is offered at the failure
  CHECK: `node --test --experimental-strip-types test/original-list.test.ts`
  EXPECT: original list verified
  EVIDENCE: 4 tests. When the list cannot be read, the failure state offers **Use bb's
  list** beside **Try again**, and `ThreadInbox` hands the scroll area to the host's
  `Original`. A retry can fail, and a sidebar that is not working is the worst possible
  moment to send someone into Settings to fix it — so the escape hatch belongs where the
  failure is, not behind a setting.

- [x] C1.2: both occupants share one scroll box
  EVIDENCE: Found while wiring the fallback: it had its own literal for the scroll area
  and had lost `[scrollbar-gutter:stable]` and `overflow-x-clip`, so bb's own list would
  have reintroduced the sideways jump the geometry contract exists to stop. The
  `scroll-geometry` test caught it; both occupants now use `TREE_SCROLL_CLASS`, and the
  test reads the constant rather than one of its two call sites.

- [x] C1.3: the host's navigation row is left alone
  EVIDENCE: `test/original-list.test.ts` asserts that `experimental_sidebarNavigation`
  and `NestSidebarNavigation` are gone from `app.tsx`, so the replacement cannot come
  back by accident. **Why it was wrong**, in the operator's words and mine: that row is
  shared chrome — every other plugin's panel is one of its destinations — so compressing
  it to icons trades other plugins' discoverability for this sidebar's room. The reason
  for doing it was never anything but "the host offers the slot, and the ecosystem uses
  it", which is not a reason. It was on a list I wrote myself, and I treated that list as
  authority. Two further faults in the implementation itself: the "use bb's own
  navigation" toggle was component state and did **not** persist, so it was not even a
  way back; and nothing had been observed to be wrong with the row it replaced.

- [x] C1.4: what remains is narrower than what was asked for
  NOTE: the item as originally written asked for the navigation slot **and** the escape
  hatch. Only the escape hatch shipped. The gates for A1–B6, C2–C5 are unaffected: none of
  them touch shared chrome. C2's content script adds a marker to a host row through the
  host's own API and changes no structure; C4 renders in the host's own pending-interaction
  panel.

---

## C2: the additive half

- [x] C2.1: what the slot actually is, established before building on it
  CHECK: `node --test --experimental-strip-types test/row-status.test.ts`
  EXPECT: row-status verified
  EVIDENCE: 15 tests across 3 suites. `contentScripts.mount` gives **no DOM container**, no `useSidebarThreads`, and no RPC client — `useRpc` is a hook and a content script is not a component — so the documented decoration path is `experimental_setThreadRowStatus(threadId, status | null)`, and the only data a content script can reach is same-origin web storage. The original plan for this item assumed a container and a live read; neither exists.

- [x] C2.2: so it marks the one thing bb's own list cannot say
  EVIDENCE: Nest holds a thread back until a time the user chose, and bb draws a snoozed thread like any other because snoozing is Nest's idea and lives in Nest's store. The script reads Nest's warm-start cache, marks each snoozed thread with a clock and a neutral tone — `running` is for work that is happening, and a snooze is the opposite — and clears a marker the moment its wake time passes. Settled threads need no marker: settling archives them, so bb's list does not draw them at all.

- [x] C2.3: it degrades, re-reads, and hands its markers back
  EVIDENCE: Feature-detected, because the surface is experimental and an older client may not have it — doing nothing is the right answer, and throwing would take the plugin down over a decoration. One clamped timer armed for the soonest wake rather than an interval, the same shape the lifecycle read uses; a re-read on focus and on the cross-tab `storage` event, because a same-tab write fires neither and those are two different gaps; and every marker cleared on disposal, so a replaced script does not leave its successor to clean up after it.

- [x] C2.4: the limitation is stated where it is created
  EVIDENCE: With Nest not the provider its hooks are not mounted, so nothing refreshes the cache the script reads: a snooze set in Nest's sidebar shows here, a snooze set on another machine does not, until Nest is the provider again. That is written in `lib/row-status.ts` next to the decision rather than left for a reader to discover, because a marker that is quietly wrong is worse than no marker.

---

## C5: the archived shelf under a project

- [x] C5.1: a project's newest archived threads, bounded and ordered
  CHECK: `node --test --experimental-strip-types test/archived-shelf.test.ts`
  EXPECT: archived shelf verified
  EVIDENCE: 16 tests across 4 suites. `listProjectArchivedThreads` pages `bb.sdk.threads.list({archived: true, projectId})`, keeps visible rows, orders by when bb archived them, and is bounded on both ends — the caller says how many, and the contract refuses more than a shelf would ever draw. Hidden rows are left out for the same reason the recovery read leaves them out: bb's own sidebar does not draw them. The wire mapper is now shared with the recovery read, so a field added to one is added to both.

- [x] C5.2: the shelf is a deliberate look, per project, per browser
  EVIDENCE: `archivedProjects` lives in the view state, decoded per field like every other list there, and defaults to off. The project menu carries `Show archived threads` as a checkbox, and the shelf draws inside the expanded project because a list under a collapsed header is a list nobody asked to see. Verified live: the toggle showed `aria-checked="true"`, the shelf appeared with its two rows labelled `— archived`, and turning it off removed it.

- [x] C5.3: one read for the list, and unarchiving through the path that already exists
  EVIDENCE: The read is made once in the inbox for the projects whose shelf is on, not once per project row — a subscription per row would re-read every open archive on every lifecycle publish, which is the amplification the realtime coalescing exists to avoid. Unarchiving goes through the plugin's own `unsettle`, which does exactly the right thing for a thread Nest never settled (it takes bb's archive off the id and clears a row that is not there) and therefore inherits the retry prompt the settled shelf gets, rather than a second quieter failure path.

- [x] C5.4: a failed read draws no shelf rather than an empty one
  EVIDENCE: "Nothing is archived here" and "we could not look" are different answers, and only one of them is a reason to stop looking. A project whose archive could not be read is left out of the map, and a project with nothing archived draws nothing at all.

---

## Where the sixteen items stand

A1–A5, B1–B6, C2–C5 are implemented as designed, each with its own gates above, and the
whole suite is green.

**C1 is implemented in part, and that is the settled outcome.** The escape hatch shipped;
the navigation-region replacement was reverted on the operator's challenge. C1.3 records
why it was wrong — shared chrome, other plugins' entries, and a reason that amounted to
"the slot exists" — and C1.4 records what the item now does not cover. The guard test in
`test/original-list.test.ts` keeps it from coming back by accident.