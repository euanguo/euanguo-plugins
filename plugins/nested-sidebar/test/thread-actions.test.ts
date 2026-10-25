import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const hook = await readFile(
  new URL("../hooks/use-thread-actions.ts", import.meta.url),
  "utf8",
);
const menu = await readFile(
  new URL("../components/inbox/thread-menu-items.tsx", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as {
  engines: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("current bb thread actions", () => {
  it("adapts navigation and mutations over the current browser SDK", () => {
    assert.match(hook, /useBbNavigate/);
    assert.match(hook, /useSdk/);
    assert.match(hook, /navigate\.toThread/);
    assert.match(hook, /navigate\.toCompose/);
    assert.match(hook, /sdk\.threads\.pin/);
    assert.match(hook, /sdk\.threads\.unpin/);
    assert.match(hook, /sdk\.threads\.markRead/);
    assert.match(hook, /sdk\.threads\.markUnread/);
    assert.match(hook, /sdk\.threads\.update/);
    assert.match(hook, /sdk\.threads\.archive/);
  });

  it("does not import a sidebar action hook the host no longer exports", () => {
    assert.doesNotMatch(hook, /experimental_useSidebarThreadActions/);
    assert.doesNotMatch(menu, /experimental_useSidebarThreadActions/);
  });

  it("confirms destructive deletion before calling the thread API", () => {
    assert.match(menu, /function DeleteThreadDialog/);
    assert.match(menu, /childThreadsConfirmed: true/);
    assert.match(menu, /sdk\.threads\.delete/);
  });

  it("pins the lowest SDK surface the compatibility adapter supports", () => {
    assert.equal(packageJson.devDependencies["@get-bb/plugin-sdk"], "0.5.8");
    assert.equal(packageJson.engines.bbPluginSdk, ">=0.5.8");
    assert.equal(packageJson.engines.bb, ">=0.36");
  });
});
