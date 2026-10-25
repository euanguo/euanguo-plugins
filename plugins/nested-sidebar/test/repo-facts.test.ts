import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRepoFactsCache } from "../lib/repo-facts.ts";
import type { WorkspaceFacts } from "../lib/repo-identity.ts";

function fact(hostId: string, path: string): WorkspaceFacts {
  return {
    hostId,
    path,
    realPath: path,
    isDirectory: true,
    isMainWorktree: false,
    isLinkedWorktree: false,
    isNestedRepository: false,
    repositoryRoot: path,
    commonDir: null,
    remoteUrl: null,
    worktrees: [],
  };
}

/** A probe that counts calls and can be told to fail. */
function spyProbe() {
  const calls: { hostId: string; paths: readonly string[] }[] = [];
  let failing = false;
  return {
    calls,
    fail(value: boolean) {
      failing = value;
    },
    probe: async (hostId: string, paths: readonly string[]) => {
      calls.push({ hostId, paths });
      if (failing) throw new Error("machine unreachable");
      return paths.map((path) => fact(hostId, path));
    },
  };
}

describe("holding what a machine said about its directories", () => {
  it("probes once for the paths it does not hold", async () => {
    const spy = spyProbe();
    let clock = 0;
    const cache = createRepoFactsCache({
      probe: spy.probe,
      now: () => clock,
      ttlMs: 100,
    });

    const targets = [
      { hostId: "host_1", path: "/a" },
      { hostId: "host_1", path: "/b" },
      { hostId: "host_2", path: "/a" },
    ];

    const first = await cache.read(targets);
    assert.equal(first.facts.length, 3);
    assert.deepEqual(
      spy.calls.map((call) => [call.hostId, call.paths.length]),
      [["host_1", 2], ["host_2", 1]],
    );

    // Inside the window nothing is asked again, and the answer is the same.
    clock = 99;
    const second = await cache.read(targets);
    assert.equal(spy.calls.length, 2);
    assert.equal(second.facts.length, 3);

    // Past it, only the paths that went stale are re-probed.
    clock = 100;
    await cache.read(targets);
    assert.equal(spy.calls.length, 4);
    assert.deepEqual(spy.calls[2].paths, ["/a", "/b"]);
  });

  it("asks only for the path that was not already held", async () => {
    const spy = spyProbe();
    const cache = createRepoFactsCache({ probe: spy.probe, now: () => 0 });

    await cache.read([{ hostId: "host_1", path: "/a" }]);
    await cache.read([
      { hostId: "host_1", path: "/a" },
      { hostId: "host_1", path: "/b" },
    ]);

    assert.equal(spy.calls.length, 2);
    assert.deepEqual(spy.calls[1].paths, ["/b"]);
  });

  it("keeps the last good answer when a machine stops answering", async () => {
    const spy = spyProbe();
    let clock = 0;
    const cache = createRepoFactsCache({
      probe: spy.probe,
      now: () => clock,
      ttlMs: 100,
    });

    await cache.read([{ hostId: "host_1", path: "/a" }]);
    spy.fail(true);
    clock = 200;

    const result = await cache.read([{ hostId: "host_1", path: "/a" }]);
    assert.deepEqual(result.unavailableHostIds, ["host_1"]);
    // The stale fact is better than no fact: the row keeps its repository.
    assert.equal(result.facts.length, 1);
    assert.equal(result.facts[0].path, "/a");
  });

  it("reports a machine that never answered, and holds nothing for it", async () => {
    const spy = spyProbe();
    spy.fail(true);
    const cache = createRepoFactsCache({ probe: spy.probe, now: () => 0 });

    const result = await cache.read([{ hostId: "host_1", path: "/a" }]);
    assert.deepEqual(result.unavailableHostIds, ["host_1"]);
    assert.deepEqual(result.facts, []);
  });

  it("forgets everything on demand, for a change it made itself", async () => {
    const spy = spyProbe();
    const cache = createRepoFactsCache({ probe: spy.probe, now: () => 0 });

    await cache.read([{ hostId: "host_1", path: "/a" }]);
    cache.invalidate();
    await cache.read([{ hostId: "host_1", path: "/a" }]);

    assert.equal(spy.calls.length, 2);
  });

  it("asks about nothing when there is nothing to ask about", async () => {
    const spy = spyProbe();
    const cache = createRepoFactsCache({ probe: spy.probe, now: () => 0 });

    const result = await cache.read([]);
    assert.deepEqual(spy.calls, []);
    assert.deepEqual(result.facts, []);
  });
});
