import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk";
import {
  EMPTY_THREAD_VIEW,
  resolveThreadView,
  threadViewNotice,
  type ThreadViewSnapshot,
} from "../lib/thread-snapshot.ts";

function thread(id: string): PluginSidebarThread {
  return {
    id,
    projectId: "p1",
    title: id,
    titleFallback: null,
    displayTitle: id,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/p1/threads/${id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: null,
    latestAttentionAt: 1,
  };
}

const project: PluginSidebarProject = {
  id: "p1",
  name: "Alpha",
  isPersonal: false,
  href: "/projects/p1",
  settingsHref: "/projects/p1/settings",
};

function snapshot(ids: readonly string[]): ThreadViewSnapshot {
  return { threads: ids.map(thread), projects: [project] };
}

const idsOf = (view: { threads: readonly PluginSidebarThread[] }) =>
  view.threads.map((entry) => entry.id);

describe("resolveThreadView", () => {
  it("draws the host's own answer while it is ready", () => {
    const view = resolveThreadView({
      status: "ready",
      host: snapshot(["a"]),
      lastGoodHost: snapshot(["stale"]),
      recovered: snapshot(["recovered"]),
    });
    assert.equal(view.source, "host");
    assert.deepEqual(idsOf(view), ["a"]);
    assert.deepEqual(view.projects, [project]);
  });

  /**
   * The case this module exists for. A refresh that fails is not an empty
   * sidebar: throwing the tree away costs the user their place, their scroll,
   * and every row they were reading, over a hiccup that fixes itself.
   */
  it("keeps the last good answer when the host fails", () => {
    const view = resolveThreadView({
      status: "error",
      host: snapshot([]),
      lastGoodHost: snapshot(["kept"]),
      recovered: null,
    });
    assert.equal(view.source, "stale");
    assert.deepEqual(idsOf(view), ["kept"]);
  });

  // A host that went back to `loading` is refetching, not empty. Blanking the
  // list here is the flicker the retained answer exists to stop.
  it("keeps the last good answer while the host reloads", () => {
    const view = resolveThreadView({
      status: "loading",
      host: snapshot([]),
      lastGoodHost: snapshot(["kept"]),
      recovered: null,
    });
    assert.equal(view.source, "stale");
    assert.deepEqual(idsOf(view), ["kept"]);
  });

  /**
   * A last-known-good host answer outranks a recovery, because it came from the
   * source that owns the question. The recovery is only there to fill the gap a
   * cold failure leaves.
   */
  it("prefers the last host answer over a recovery", () => {
    const view = resolveThreadView({
      status: "error",
      host: snapshot([]),
      lastGoodHost: snapshot(["kept"]),
      recovered: snapshot(["recovered"]),
    });
    assert.equal(view.source, "stale");
    assert.deepEqual(idsOf(view), ["kept"]);
  });

  it("falls back to a recovery when there is no last answer", () => {
    const view = resolveThreadView({
      status: "error",
      host: snapshot([]),
      lastGoodHost: null,
      recovered: snapshot(["recovered"]),
    });
    assert.equal(view.source, "recovered");
    assert.deepEqual(idsOf(view), ["recovered"]);
  });

  it("draws nothing on a first load", () => {
    const view = resolveThreadView({
      status: "loading",
      host: snapshot([]),
      lastGoodHost: null,
      recovered: null,
    });
    assert.equal(view, EMPTY_THREAD_VIEW);
  });

  /**
   * A cold failure with a recovery in hand but no rows in it still draws
   * nothing. The recovery is only consulted on `error`, so a `loading` host
   * must not adopt rows from a previous outage.
   */
  it("does not adopt a recovery while the host is merely loading", () => {
    const view = resolveThreadView({
      status: "loading",
      host: snapshot([]),
      lastGoodHost: null,
      recovered: snapshot(["recovered"]),
    });
    assert.equal(view.source, "none");
  });
});

describe("threadViewNotice", () => {
  it("says nothing when the view is live", () => {
    assert.equal(threadViewNotice("host"), null);
    assert.equal(threadViewNotice("none"), null);
  });

  it("admits a stale tree rather than hiding it", () => {
    assert.match(String(threadViewNotice("stale")), /last known state/);
  });

  it("names the source when the rows were recovered", () => {
    assert.match(String(threadViewNotice("recovered")), /read from bb directly/);
  });
});
