import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../server/rpc/features.ts", import.meta.url),
  "utf8",
);

describe("the feature's root conversation", () => {
  it("runs in the feature directory as an unmanaged host workspace", () => {
    assert.match(source, /environment: \{\s*\n\s*type: "host"/u);
    assert.match(source, /workspace: \{ type: "unmanaged", path: feature\.rootPath \}/u);
  });

  it("refuses before spawning when the feature has no directory", () => {
    const refusal = source.slice(
      source.indexOf("async openFeatureThread"),
      source.indexOf("function featurePrompt"),
    );
    assert.match(refusal, /feature\.rootPath === null/u);
    assert.match(refusal, /先添加一个仓库/u);
  });

  it("names every member and the git rule in the opening prompt", () => {
    const prompt = source.slice(source.indexOf("function featurePrompt"));
    assert.match(prompt, /Read NEST\.md and \.nest-feature\.json/u);
    assert.match(prompt, /git -C <directory>/u);
    assert.match(prompt, /The feature directory itself is not a/u);
  });
});
