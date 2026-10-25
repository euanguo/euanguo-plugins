import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const modal = await readFile(new URL("../components/ui/modal.tsx", import.meta.url), "utf8");
const dialog = await readFile(new URL("../components/ui/dialog.tsx", import.meta.url), "utf8");
const inbox = await readFile(new URL("../components/inbox/thread-inbox.tsx", import.meta.url), "utf8");
const newThreadHook = await readFile(new URL("../hooks/use-new-thread.ts", import.meta.url), "utf8");
const newThread = await readFile(new URL("../components/inbox/new-thread-dialog.tsx", import.meta.url), "utf8");
const menu = await readFile(new URL("../components/ui/menu.tsx", import.meta.url), "utf8");
const hoverCard = await readFile(new URL("../components/ui/hover-card.tsx", import.meta.url), "utf8");
const select = await readFile(new URL("../components/ui/select.tsx", import.meta.url), "utf8");
const groupManager = await readFile(new URL("../components/inbox/group-manager-dialog.tsx", import.meta.url), "utf8");
const portalScope = await readFile(new URL("../lib/portal-scope.ts", import.meta.url), "utf8");

describe("modal and overlay contracts", () => {
  /**
   * One surface for every row. A project row seeds a project, a workspace row
   * seeds the worktree it names, and "New worktree" seeds a fresh one; the
   * sidebar's own `openNewThread` shortcut is gone, because it accepts a project
   * and a focus flag and nothing else — a worktree handed to it is dropped.
   */
  it("routes every row's new-thread action through the seeded dialog", () => {
    assert.match(inbox, /<NewThreadDialog/);
    // The prose still names the shortcut it explains why not to use, so this
    // asserts on the call rather than on the word.
    assert.doesNotMatch(inbox, /sidebarActions\.openNewThread/);
    // The seeds themselves live in the hook; the inbox only routes rows to it.
    assert.match(newThreadHook, /type: "reuse", environmentId: node\.ref\.environmentId/);
    assert.match(newThreadHook, /type: "managed-worktree"/);
    assert.match(newThreadHook, /baseBranch: \{ kind: "default" \}/);
    // A `host` seed with no host resolves to null inside the composer, so the
    // project's source host has to travel with it.
    assert.match(newThreadHook, /sourceHostId/);
    for (const seed of ["seedFromProject", "seedNewWorktree", "seedFromWorkspace"]) {
      assert.match(inbox, new RegExp(`onNewThreadIn\\w*\\{|${seed}`), `${seed} is wired`);
    }
  });

  /**
   * Only a worktree the user named is settled on submit, because only a `reuse`
   * seed can be dropped by the composer — its "reuse an existing environment"
   * list is built from threads, so a worktree whose threads have all been
   * archived is absent from it. A project seed and a new-worktree seed belong to
   * the composer's own pickers.
   */
  it("settles a workspace row's environment on submit, and only that one", () => {
    assert.match(newThread, /seed\.environment\?\.type === "reuse"/);
    assert.match(newThread, /environment: reused/);
  });

  /**
   * `sidebarActions.open` silently ignores an id the host's client store does
   * not hold, and a spawn answers before the sidebar's read catches up — so
   * opening on the spot leaves the user on the composer. The row must wait for
   * the thread to arrive in the sidebar's own live view.
   */
  it("waits for the sidebar to hold a spawned thread before opening it", () => {
    assert.match(newThreadHook, /setPendingOpenId\(threadId\)/);
    assert.doesNotMatch(newThreadHook, /openThread\(threadId\)/);
    assert.match(
      newThreadHook,
      /hostThreads\.some\(\(thread\) => thread\.id === pendingOpenId\)/,
    );
  });

  /**
   * The spawn path was the last route into a thread that skipped `onNavigate`.
   * On a phone that left the drawer open over the thread the user had just
   * created, which is the one moment the sidebar is certainly done with.
   */
  it("closes the mobile drawer on the spawn path too", () => {
    assert.match(
      newThreadHook,
      /openThread\(pendingOpenId\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*onNavigate\(\);/,
    );
  });

  it("uses the official BB dialog instead of a native dialog", () => {
    assert.match(modal, /from "@\/components\/ui\/dialog"/);
    assert.match(modal, /<Dialog[\s\S]*<DialogContent/);
    assert.match(modal, /aria-label="Close"/);
    assert.doesNotMatch(modal, /<dialog/);
    assert.doesNotMatch(modal, /showModal\(\)/);
  });

  /**
   * On a compact viewport the drawer *is* the box: it already fills the
   * viewport and already carries the sheet's chrome. A caller's floating-card
   * sizing used to survive into that branch anyway — the inline
   * `width`/`max-width` of `min(56rem, calc(100vw - 2rem))` beat the branch's
   * own `max-w-none`, so the content rendered 2rem narrower than the sheet it
   * sat in. Measured on the running app, a 390px viewport gave a 358px content
   * box inside a 390px drawer, with the drawer's own background showing as a
   * strip down the right edge; the card chrome (radius, popover fill, shadow,
   * height cap) came with it, drawing a smaller card floating inside the sheet.
   * The inline size has to be removed rather than overridden, because an inline
   * style outranks a class.
   */
  it("gives the drawer the box on a compact viewport", () => {
    assert.match(dialog, /stripInlineSize/);
    assert.match(
      dialog,
      /w-full max-w-none max-h-none rounded-none border-0 bg-transparent shadow-none/,
    );
    // …and the business wrapper stops describing a box it does not own.
    assert.match(modal, /useIsCompactViewport/);
    assert.match(modal, /isFloating/);
  });

  it("keeps floating surfaces in the official portal path", () => {
    assert.match(groupManager, /from "@\/components\/ui\/popover"/);
    assert.doesNotMatch(groupManager, /@radix-ui\/react-popover/);
    assert.doesNotMatch(groupManager, /useOverlayPortalContainer/);
    assert.doesNotMatch(groupManager, /Popover\.Portal/);
    assert.match(menu, /container=\{container\}/);
    assert.match(hoverCard, /container=\{container\}/);
    assert.match(select, /container=\{useOverlayPortalContainer\(\)\}/);
    assert.match(portalScope, /data-bb-portaled-overlay/);
  });
});
