import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UNARCHIVE_RETRY_APPROVAL,
  UNARCHIVE_RETRY_TIMEOUT_MS,
  parseUnarchiveRetryPayload,
  unarchiveRetryApproved,
  unarchiveRetryPayload,
} from "../lib/domain/unarchive-retry.ts";

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