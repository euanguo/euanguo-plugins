import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renameIntent, canonicalGroupName } from "../lib/groups.ts";

describe("renameIntent", () => {
  it("normalises surrounding and repeated whitespace", () => {
    assert.equal(renameIntent("  Work   stuff ", "Other"), "Work stuff");
  });

  it("treats an empty or whitespace-only draft as no rename", () => {
    assert.equal(renameIntent("", "Work"), null);
    assert.equal(renameIntent("   ", "Work"), null);
  });

  it("treats an unchanged name as no rename", () => {
    // Matters because blur commits: clicking into a field and out again must not
    // cost a round trip or a needless publish.
    assert.equal(renameIntent("Work", "Work"), null);
    assert.equal(renameIntent("  Work  ", "Work"), null);
  });

  it("returns a changed name", () => {
    assert.equal(renameIntent("Work", "Personal"), "Work");
    assert.equal(renameIntent("Personal", "Work"), "Personal");
  });

  it("agrees with the canonical form the server stores", () => {
    const draft = "  Side\tprojects  ";
    assert.equal(renameIntent(draft, "Other"), canonicalGroupName(draft));
  });
});
