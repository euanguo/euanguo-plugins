import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyProjectOrder,
  keyboardProjectMove,
  moveProject,
} from "../lib/domain/project-order.ts";
import type { ProjectThreadGroup } from "../lib/domain/inbox.ts";

function group(id: string): ProjectThreadGroup {
  return {
    project: {
      id,
      name: id,
      isPersonal: false,
      href: `/projects/${id}`,
      settingsHref: `/projects/${id}/settings`,
    },
    families: [],
  };
}

describe("project order", () => {
  it("applies stored ranks and preserves new projects", () => {
    assert.deepEqual(
      applyProjectOrder([group("a"), group("new"), group("b")], ["b", "a"]).map((item) => item.project.id),
      ["b", "a", "new"],
    );
  });

  it("moves complete project orders by drag and keyboard", () => {
    assert.deepEqual(
      moveProject({ projectIds: ["a", "b", "c"], sourceProjectId: "c", targetProjectId: "a", position: "before" }),
      { ok: true, order: ["c", "a", "b"] },
    );
    assert.deepEqual(keyboardProjectMove(["a", "b", "c"], "b", 1), {
      ok: true,
      order: ["a", "c", "b"],
    });
  });
});
