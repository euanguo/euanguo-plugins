import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PERSONAL_PROJECT_ID,
  isPersonalProject,
  threadLinkUrl,
  threadRoutePath,
} from "../lib/thread-link.ts";

describe("thread links match bb's own routes", () => {
  it("puts a project thread under its project", () => {
    assert.equal(
      threadRoutePath("proj_1", "thr_1"),
      "/projects/proj_1/threads/thr_1",
    );
  });

  it("puts a personal thread at the top level", () => {
    assert.equal(isPersonalProject(PERSONAL_PROJECT_ID), true);
    assert.equal(threadRoutePath(PERSONAL_PROJECT_ID, "thr_1"), "/threads/thr_1");
  });

  it("resolves an absolute link against the page origin", () => {
    assert.equal(
      threadLinkUrl("proj_1", "thr_1", "https://bb.example"),
      "https://bb.example/projects/proj_1/threads/thr_1",
    );
  });

  it("returns the bare path when there is no origin", () => {
    assert.equal(threadLinkUrl("proj_1", "thr_1", null), "/projects/proj_1/threads/thr_1");
  });
});
