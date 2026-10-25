import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  semanticStateToneClass,
  type SemanticStateTone,
} from "../lib/attention-state.ts";

describe("semanticStateToneClass", () => {
  it("maps every named semantic role to theme-token utilities", () => {
    const expected: Record<SemanticStateTone, string> = {
      closed: "bg-muted/60 text-muted-foreground/60",
      destructive: "bg-destructive/10 text-destructive",
      merged: "bg-primary/10 text-[color:var(--pr-merged)]",
      muted: "bg-muted text-muted-foreground",
      primary: "bg-primary/10 text-primary",
      success: "bg-primary/10 text-success-foreground",
      warning:
        "bg-primary/10 text-[color:var(--warning-text,var(--warning))]",
    };
    for (const [tone, className] of Object.entries(expected)) {
      assert.equal(
        semanticStateToneClass(tone as SemanticStateTone),
        className,
      );
    }
  });
});
