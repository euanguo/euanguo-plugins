/**
 * What the new-thread dialog hands to `threads.spawn`.
 *
 * Two rewrites live in `spawnThread` and both exist because of a measured
 * defect: a thread started from this dialog did not become the project's
 * remembered configuration, and the next `+` came back to the product default.
 *
 * Verified against the running app before the fix:
 *   - Nest-created thread, model chosen in the dialog → project defaults stayed
 *     `null`, and the thread ran at `reasoningLevel: "medium"` instead of the
 *     `High` the user picked.
 *   - The same choice through bb's own composer → defaults written, thread ran
 *     at `high`.
 *
 * The two causes are separate and both had to be fixed: the server records
 * defaults only for `origin: "app"`, and it drops any execution field whose
 * provenance is absent from `executionInputSources`.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");

const spawnThread = (() => {
  const start = server.indexOf("async spawnThread({ request })");
  assert.notEqual(start, -1, "spawnThread is where the rewrites live");
  const end = server.indexOf("async listProviders()", start);
  assert.notEqual(end, -1);
  return server.slice(start, end);
})();

describe("spawnThread's execution rewrites", () => {
  it("creates the thread as the app, so bb records the project's defaults", () => {
    // `shouldRememberProjectExecutionDefaults` in bb's server requires this
    // exact value; a plugin origin is silently skipped.
    assert.match(spawnThread, /origin: "app"/);
    // And the plugin attribution is gone with it, on purpose — nothing in this
    // plugin ever read `originPluginId`, and the defaults are the feature the
    // user actually sees.
    assert.doesNotMatch(spawnThread, /originPluginId: "nested-sidebar"/);
  });

  it("marks every execution field the user could have touched as explicit", () => {
    // Without these the server discards the value
    // (`resolveRequestedCreateExecutionValue`) and re-derives it from the
    // project's stored defaults, which is the whole defect.
    for (const field of [
      "providerId",
      "model",
      "reasoningLevel",
      "permissionMode",
    ]) {
      assert.match(
        spawnThread,
        new RegExp(`${field}: "explicit"`),
        `${field} has to carry its provenance`,
      );
    }
  });

  it("only claims a service tier when the composer actually sent one", () => {
    // `serviceTier` is optional on the request, and claiming provenance for a
    // field that has no value is a shape the schema does not accept.
    assert.match(spawnThread, /request2\.serviceTier === undefined/);
  });

  it("still refuses a workspace that belongs to another project", () => {
    // The one field this handler validates itself. Rewriting the origin must
    // not have moved the guard out of the way.
    assert.match(spawnThread, /ownerProjectId !== null && ownerProjectId !== projectId/);
    assert.match(spawnThread, /This workspace belongs to/);
  });
});
