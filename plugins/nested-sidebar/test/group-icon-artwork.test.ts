import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GROUP_ICON_OPTIONS,
  MAX_GROUP_ICON_BATCH,
  type GroupIconArtwork,
} from "../lib/group-icons.ts";
import {
  parseGroupIconArtwork,
  selectGroupIconArtwork,
} from "../lib/group-icon-artwork.ts";
import { GROUP_ICON_ARTWORK_JSON } from "../lib/group-icons-data.js";
import {
  loadGroupIcon,
  type GroupIconTransport,
} from "../lib/group-icon-loader.ts";

const ONE_ICON: GroupIconArtwork = [
  ["path", { d: "M0 0", stroke: "currentColor" }],
];

function document(icons: unknown): string {
  return JSON.stringify({ version: 1, icons });
}

describe("group icon artwork file", () => {
  it("indexes a well-formed document by name", () => {
    const icons = parseGroupIconArtwork(document({ AbacusIcon: ONE_ICON }));
    assert.equal(icons.size, 1);
    assert.deepEqual(icons.get("AbacusIcon"), ONE_ICON);
  });

  it("refuses anything this build did not write", () => {
    // Each of these would otherwise reach the RPC boundary as a shape
    // failure, where the message names the wrong thing.
    assert.throws(() => parseGroupIconArtwork("not json"));
    assert.throws(() => parseGroupIconArtwork("[]"));
    assert.throws(() =>
      parseGroupIconArtwork(JSON.stringify({ icons: null })),
    );
    assert.throws(() =>
      parseGroupIconArtwork(document({ AbacusIcon: "nope" })),
    );
    assert.throws(() =>
      parseGroupIconArtwork(document({ AbacusIcon: [[1, { d: "M0 0" }]] })),
    );
    assert.throws(() =>
      parseGroupIconArtwork(document({ AbacusIcon: [["path", { d: 1 }, "x"]] })),
    );
    assert.throws(() =>
      parseGroupIconArtwork(document({ AbacusIcon: [["path", { d: true }]] })),
    );
  });

  it("answers name by name, with null for a name the file does not carry", () => {
    const icons = parseGroupIconArtwork(
      document({ AbacusIcon: ONE_ICON, Add01Icon: ONE_ICON }),
    );
    const selected = selectGroupIconArtwork(icons, [
      "Add01Icon",
      "NotAnIcon",
      "AbacusIcon",
    ]);
    assert.deepEqual(Object.keys(selected), [
      "Add01Icon",
      "NotAnIcon",
      "AbacusIcon",
    ]);
    assert.deepEqual(selected.Add01Icon, ONE_ICON);
    assert.equal(selected.NotAnIcon, null);
    assert.deepEqual(selected.AbacusIcon, ONE_ICON);
  });

  it("ships artwork for every icon the picker offers", async () => {
    // The guard that matters: editing the name list without regenerating the
    // file would leave the picker drawing blank tiles for the new names.
    const icons = parseGroupIconArtwork(GROUP_ICON_ARTWORK_JSON);
    assert.deepEqual(
      GROUP_ICON_OPTIONS.filter((name) => !icons.has(name)),
      [],
    );
    assert.equal(icons.size, GROUP_ICON_OPTIONS.length);
  });

  it("keeps a request below the size of the library", () => {
    assert.ok(MAX_GROUP_ICON_BATCH > 240);
    assert.ok(MAX_GROUP_ICON_BATCH < GROUP_ICON_OPTIONS.length);
  });
});

describe("group icon loader", () => {
  it("answers a page of tiles in one call", async () => {
    const calls: string[][] = [];
    const transport: GroupIconTransport = async (names) => {
      calls.push([...names]);
      return Object.fromEntries(names.map((name) => [name, ONE_ICON]));
    };
    const loaded = await Promise.all(
      ["page-a", "page-b", "page-c"].map((name) =>
        loadGroupIcon(transport, name),
      ),
    );
    assert.deepEqual(calls, [["page-a", "page-b", "page-c"]]);
    assert.deepEqual(loaded, [ONE_ICON, ONE_ICON, ONE_ICON]);
  });

  it("remembers an answer, including one that says there is no such icon", async () => {
    let calls = 0;
    const transport: GroupIconTransport = async () => {
      calls += 1;
      return { "cached-hit": ONE_ICON, "cached-miss": null };
    };
    const [hit, miss] = await Promise.all([
      loadGroupIcon(transport, "cached-hit"),
      loadGroupIcon(transport, "cached-miss"),
    ]);
    assert.deepEqual(hit, ONE_ICON);
    assert.equal(miss, null);
    // Both answers are remembered, the miss included: a row whose name this
    // build does not carry must not ask again on every render.
    assert.deepEqual(await loadGroupIcon(transport, "cached-hit"), ONE_ICON);
    assert.equal(await loadGroupIcon(transport, "cached-miss"), null);
    assert.equal(calls, 1);
  });

  it("forgets a call that failed, so a later mount can ask again", async () => {
    let calls = 0;
    const transport: GroupIconTransport = async () => {
      calls += 1;
      if (calls === 1) throw new Error("transport is down");
      return { "retried-icon": ONE_ICON };
    };
    assert.equal(await loadGroupIcon(transport, "retried-icon"), null);
    assert.deepEqual(await loadGroupIcon(transport, "retried-icon"), ONE_ICON);
    assert.equal(calls, 2);
  });
});
