import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RPC_ERROR_CODES,
  RpcError,
  describeActionError,
  isRpcError,
} from "../lib/domain/rpc-error.ts";

describe("the domain error vocabulary", () => {
  it("keeps the six codes the handlers and agents branch on", () => {
    assert.deepEqual([...RPC_ERROR_CODES].sort(), [
      "blocked",
      "conflict",
      "invalid",
      "not-found",
      "stale",
      "unavailable",
    ]);
  });

  it("carries the code on the error and recognizes only its own errors", () => {
    const error = new RpcError("blocked", "The feature still holds work.");
    assert.equal(isRpcError(error), true);
    assert.equal(error.code, "blocked");
    assert.equal(error.message, "The feature still holds work.");
    assert.equal(isRpcError(new Error("plain")), false);
  });

  it("hands an agent the code and the sentence, and leaves plain errors alone", () => {
    assert.equal(
      describeActionError(new RpcError("not-found", "No feature f_1.")),
      "not-found: No feature f_1.",
    );
    assert.equal(describeActionError(new Error("plain")), "plain");
    assert.equal(describeActionError("text"), "text");
  });
});
