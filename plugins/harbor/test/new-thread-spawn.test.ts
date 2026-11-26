import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";

import { buildSpawnRequestPayload } from "../hooks/use-new-thread.ts";

function sampleRequest(
  overrides: Partial<NewThreadRequest> = {},
): NewThreadRequest {
  return {
    projectId: "proj_default",
    providerId: "codex",
    model: "gpt-5",
    reasoningLevel: "medium",
    permissionMode: "accept-edits",
    executionInputSources: {
      providerId: "explicit",
      model: "explicit",
      reasoningLevel: "explicit",
      permissionMode: "explicit",
    },
    environment: { type: "project-default" },
    input: [{ type: "text", text: "Hello", mentions: [] }],
    ...overrides,
  };
}

describe("buildSpawnRequestPayload", () => {
  it("re-asserts reuse environment so empty/unindexed worktrees do not fall back", () => {
    const request = sampleRequest({
      projectId: "proj_personal",
      environment: { type: "project-default" },
    });
    const payload = buildSpawnRequestPayload({
      request,
      environment: { type: "reuse", environmentId: "env_empty_wt" },
      fallbackProjectId: "proj_repo",
    });
    assert.deepEqual(payload.environment, {
      type: "reuse",
      environmentId: "env_empty_wt",
    });
    assert.equal(payload.projectId, "proj_repo");
  });

  it("locks projectId and environment for locked feature root seeds", () => {
    const request = sampleRequest({
      projectId: "proj_other",
      environment: { type: "project-default" },
    });
    const payload = buildSpawnRequestPayload({
      request,
      projectId: "proj_features",
      environment: {
        type: "host",
        hostId: "host_1",
        workspace: { type: "unmanaged", path: "/work/harbor-features/feat-x" },
      },
      locked: true,
    });
    assert.equal(payload.projectId, "proj_features");
    assert.deepEqual(payload.environment, {
      type: "host",
      hostId: "host_1",
      workspace: { type: "unmanaged", path: "/work/harbor-features/feat-x" },
    });
  });

  it("preserves user environment choices for non-reuse, unlocked seeds", () => {
    const request = sampleRequest({
      projectId: "proj_repo",
      environment: {
        type: "host",
        hostId: "host_1",
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "named", name: "main" },
        },
      },
    });
    const payload = buildSpawnRequestPayload({
      request,
      projectId: "proj_repo",
      environment: {
        type: "host",
        hostId: "host_1",
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "default" },
        },
      },
    });
    assert.deepEqual(payload.environment, request.environment);
    assert.equal(payload.projectId, "proj_repo");
  });
});
