import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeAgentsFile,
  renderManagedBlock,
  renderManifest,
  userNotesOf,
  type FeatureContext,
} from "../lib/feature-context.ts";

const context = (members: FeatureContext["members"] = []): FeatureContext => ({
  id: "f_1",
  name: "AI 语音",
  slug: "ai-voice",
  suggestedBranch: "feat/ai-voice",
  members,
});

describe("the AGENTS.md a feature folder carries", () => {
  it("starts a new file with Nest's block and an empty notes section", () => {
    const file = mergeAgentsFile(null, renderManagedBlock(context()));
    assert.match(file, /<!-- nest:begin/u);
    assert.match(file, /<!-- nest:end -->/u);
    assert.match(file, /## Notes/u);
    assert.match(file, /feat\/ai-voice/u);
    assert.match(file, /git -C <folder>/u);
  });

  /** The point of the markers: everything the person wrote survives a rewrite. */
  it("replaces only its own block and keeps every line outside it", () => {
    const first = mergeAgentsFile(null, renderManagedBlock(context()));
    const edited = `Intro the user wrote.\n\n${first}\n- decided: use the new billing API\n`;
    const next = mergeAgentsFile(
      edited,
      renderManagedBlock(
        context([{ directory: "tea-app-im", repository: "tea-app-im", branch: "feat/ai-voice", install: "pnpm install" }]),
      ),
    );
    assert.ok(next.startsWith("Intro the user wrote."));
    assert.match(next, /decided: use the new billing API/u);
    assert.match(next, /`tea-app-im\/`/u);
    assert.match(next, /pnpm install/u);
    assert.equal(next.match(/nest:begin/gu)?.length, 1);
  });

  it("puts its block above a file a person wrote without markers", () => {
    const next = mergeAgentsFile("# My plan\n", renderManagedBlock(context()));
    assert.ok(next.indexOf("nest:begin") < next.indexOf("# My plan"));
  });

  it("reads back what the person wrote, without Nest's block or placeholder", () => {
    const fresh = mergeAgentsFile(null, renderManagedBlock(context()));
    assert.equal(userNotesOf(fresh), "");
    assert.equal(userNotesOf(`${fresh}\nship by Friday\n`), "ship by Friday");
  });

  it("writes the same members into the manifest", () => {
    const manifest = JSON.parse(
      renderManifest(context([{ directory: "buy", repository: "tea-app-im-buy", branch: null, install: null }])),
    ) as { slug: string; members: { directory: string; branch: string | null }[] };
    assert.equal(manifest.slug, "ai-voice");
    assert.deepEqual(manifest.members, [{ directory: "buy", repository: "tea-app-im-buy", branch: null }]);
  });
});
