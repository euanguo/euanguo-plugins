import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  UNARCHIVE_RETRY_APPROVAL,
  UNARCHIVE_RETRY_RENDERER_ID,
  UNARCHIVE_RETRY_TIMEOUT_MS,
  parseUnarchiveRetryPayload,
  unarchiveRetryApproved,
  unarchiveRetryPayload,
} from "../lib/unarchive-retry.ts";

const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
const app = await readFile(new URL("../app.tsx", import.meta.url), "utf8");
const prompt = await readFile(
  new URL("../components/inbox/unarchive-retry-prompt.tsx", import.meta.url),
  "utf8",
);

describe("the unarchive retry payload", () => {
  it("round trips", () => {
    const payload = { threadId: "thr_1", message: "host is offline" };
    assert.deepEqual(parseUnarchiveRetryPayload(payload), payload);
  });

  // bb's own words are what the user needs; a paraphrase is a second story about
  // the same failure.
  it("carries bb's message, bounded", () => {
    const long = "x".repeat(1_000);
    assert.equal(unarchiveRetryPayload({ threadId: "thr_1", message: long }).message.length, 400);
    assert.equal(parseUnarchiveRetryPayload({ threadId: "thr_1", message: long })?.message.length, 400);
  });

  it("rejects anything it did not write", () => {
    for (const value of [
      null,
      "thr_1",
      {},
      { threadId: "" },
      { threadId: 1 },
      { threadId: "x".repeat(201) },
    ]) {
      assert.equal(parseUnarchiveRetryPayload(value), null, JSON.stringify(value));
    }
  });

  it("reads a payload with no message", () => {
    assert.deepEqual(parseUnarchiveRetryPayload({ threadId: "thr_1" }), {
      threadId: "thr_1",
      message: "",
    });
  });
});

describe("unarchiveRetryApproved", () => {
  it("approves only a submission carrying the approval", () => {
    assert.equal(
      unarchiveRetryApproved({
        outcome: "submitted",
        value: UNARCHIVE_RETRY_APPROVAL,
      }),
      true,
    );
  });

  /**
   * One function for two questions, because they are the same question: a prompt
   * that timed out, a user who closed it, and a submission carrying something
   * else all mean "do not touch bb's archive again".
   */
  it("treats everything else as a dismissal", () => {
    assert.equal(unarchiveRetryApproved({ outcome: "cancelled" }), false);
    assert.equal(
      unarchiveRetryApproved({ outcome: "submitted", value: "something-else" }),
      false,
    );
    assert.equal(unarchiveRetryApproved({ outcome: "submitted" }), false);
    assert.equal(unarchiveRetryApproved(null), false);
    assert.equal(unarchiveRetryApproved(undefined), false);
  });

  it("waits a bounded time for the answer", () => {
    // Shorter than the host's own one-hour cap: a prompt about a thread the user
    // has moved on from is worse than no prompt.
    assert.equal(UNARCHIVE_RETRY_TIMEOUT_MS, 600_000);
  });
});

/**
 * The wiring. The failure this exists for is the one the README has carried a
 * paragraph about since the feature landed: un-settling clears the row and takes
 * bb's archive off the thread, and an unreachable machine leaves the thread
 * archived, so it simply disappears.
 */
describe("the unarchive retry, wired", () => {
  it("reports the failure instead of only logging it", () => {
    // `unarchiveThreads` used to swallow it, which is what made the failure
    // invisible: a log line is not an answer to "where did my thread go".
    assert.match(server, /const unarchiveThreads = async \(\s*threadIds: readonly string\[\],\s*\): Promise<string \| null>/);
    assert.match(server, /return failure;/);
  });

  it("asks on failure, and retries once on the user's word", () => {
    assert.match(server, /const failure = await unarchiveThreads\(ids\);/);
    assert.match(
      server,
      /if \(failure !== null && \(await askToRetryUnarchive\(threadId, failure\)\)\)/,
    );
    // One retry. A second failure is logged like the first and the row is
    // cleared as before — the thread is still in bb's archived view.
    assert.equal(
      (server.match(/await unarchiveThreads\(ids\);/g) ?? []).length,
      2,
    );
  });

  it("raises it through the host, and cannot fail the RPC if it cannot", () => {
    assert.match(server, /bb\.ui\.requestInput\(\{/);
    assert.match(server, /rendererId: UNARCHIVE_RETRY_RENDERER_ID/);
    assert.match(server, /timeoutMs: UNARCHIVE_RETRY_TIMEOUT_MS/);
    // A prompt that could not be raised is not a reason to fail the call.
    assert.match(server, /could not ask about the unarchive/);
  });

  it("registers the renderer under the id the backend raises", () => {
    assert.match(app, /app\.slots\.pendingInteraction\(\{/);
    assert.match(app, /id: UNARCHIVE_RETRY_RENDERER_ID/);
    assert.match(app, /component: UnarchiveRetryPrompt/);
    assert.equal(UNARCHIVE_RETRY_RENDERER_ID, "unarchive-retry");
  });

  it("shows what bb said, and offers the two answers that differ", () => {
    assert.match(prompt, /payload\.message/);
    assert.match(prompt, /Leave it archived/);
    assert.match(prompt, /Try again/);
    assert.match(prompt, /void submit\(UNARCHIVE_RETRY_APPROVAL\)/);
    assert.match(prompt, /void cancel\(\)/);
  });

  // A payload this build cannot read is not a reason to guess at a retry.
  it("dismisses a payload it cannot read", () => {
    assert.match(prompt, /if \(payload === null\) \{/);
    assert.match(prompt, /came from a newer version of Nest/);
  });

  /**
   * `JsonValue` wants an index signature and an interface does not carry one, so
   * the payload crosses as a fresh literal.
   */
  it("crosses the wire as a literal, not as the interface", () => {
    assert.match(
      server,
      /payload: \{ threadId: payload\.threadId, message: payload\.message \}/,
    );
  });
});