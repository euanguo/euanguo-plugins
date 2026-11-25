import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { confirmSubmitIcon } from "../hooks/use-dialog-task.ts";
import { errorMessage } from "../lib/domain/errors.ts";

describe("dialog task primitives", () => {
  it("uses the error's own message, a nested error string, or the caller's fallback", () => {
    assert.equal(errorMessage(new Error("Branch is taken."), "Fallback"), "Branch is taken.");
    assert.equal(errorMessage({ error: "Server refused." }, "Fallback"), "Server refused.");
    assert.equal(errorMessage("not an Error", "Fallback"), "Fallback");
    assert.equal(errorMessage(new Error("   "), "Fallback"), "Fallback");
  });

  it("only gives destructive confirmations their busy spinner", () => {
    assert.equal(confirmSubmitIcon(true, undefined), null);
    assert.equal(confirmSubmitIcon(false, "Trash2"), "Trash2");
    assert.equal(confirmSubmitIcon(true, "Trash2"), "Loading");
  });
});
