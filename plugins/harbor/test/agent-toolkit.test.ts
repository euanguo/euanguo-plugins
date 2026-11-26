import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import type { AgentAccessTier } from "../lib/domain/agent-access.ts";
import {
  createAgentToolRegistry,
  truncateToolOutput,
} from "../lib/agent/toolkit.ts";

type Registration = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (params: unknown, context: unknown) => Promise<string>;
};

function stubBb() {
  const registrations: Registration[] = [];
  return {
    registrations,
    bb: {
      agents: {
        registerTool(registration: Registration) {
          registrations.push(registration);
        },
      },
    } as never,
  };
}

const CONTEXT = {
  threadId: "thr_1",
  projectId: "proj_1",
  signal: new AbortController().signal,
};

describe("registering tools and enforcing three-tier access", () => {
  it("registers every tool once and reports which are enabled for the tier", () => {
    const { bb, registrations } = stubBb();
    let tier: AgentAccessTier = "read-only";
    const registry = createAgentToolRegistry({ bb, getTier: () => tier });

    registry.register({
      name: "harbor_sidebar_map",
      description: "read",
      parameters: z.object({}),
      async execute() {
        return "read ok";
      },
    });
    registry.register({
      name: "harbor_sidebar_organize",
      description: "write",
      parameters: z.object({}),
      async execute() {
        return "write ok";
      },
    });

    assert.equal(registrations.length, 2);
    assert.deepEqual(registry.enabledToolNames(), ["harbor_sidebar_map"]);
    assert.equal(registry.isEnabled("harbor_sidebar_map"), true);
    assert.equal(registry.isEnabled("harbor_sidebar_organize"), false);

    tier = "full";
    assert.deepEqual(registry.enabledToolNames(), [
      "harbor_sidebar_map",
      "harbor_sidebar_organize",
    ]);

    tier = "off";
    assert.deepEqual(registry.enabledToolNames(), []);
  });

  it("refuses a call disallowed by the active tier without throwing or executing", async () => {
    const { bb, registrations } = stubBb();
    let executed = false;
    const registry = createAgentToolRegistry({ bb, getTier: () => "read-only" });
    registry.register({
      name: "harbor_sidebar_organize",
      description: "write",
      parameters: z.object({}),
      async execute() {
        executed = true;
        return "should not run";
      },
    });

    const answer = await registrations[0].execute({}, CONTEXT);
    assert.equal(executed, false);
    assert.match(answer, /"read-only"/);
    assert.doesNotMatch(answer, /should not run/);
  });

  it("follows tier changes made after registration without reloading", async () => {
    const { bb, registrations } = stubBb();
    let tier: AgentAccessTier = "off";
    const registry = createAgentToolRegistry({ bb, getTier: () => tier });
    registry.register({
      name: "harbor_sidebar_organize",
      description: "write",
      parameters: z.object({}),
      async execute() {
        return "wrote";
      },
    });

    assert.match(await registrations[0].execute({}, CONTEXT), /"off"/);
    tier = "read-only";
    assert.match(await registrations[0].execute({}, CONTEXT), /"read-only"/);
    tier = "full";
    assert.equal(await registrations[0].execute({}, CONTEXT), "wrote");
    assert.deepEqual(registry.enabledToolNames(), ["harbor_sidebar_organize"]);
  });

  it("reports a throwing tool instead of failing the turn", async () => {
    const { bb, registrations } = stubBb();
    const registry = createAgentToolRegistry({ bb, getTier: () => "read-only" });
    registry.register({
      name: "harbor_sidebar_map",
      description: "read",
      parameters: z.object({}),
      async execute() {
        throw new Error("the machine is asleep");
      },
    });

    assert.equal(
      await registrations[0].execute({}, CONTEXT),
      "Error: the machine is asleep",
    );
  });

  it("caps output and says by how much", () => {
    const short = "x".repeat(100);
    assert.equal(truncateToolOutput(short), short);

    const long = "x".repeat(20_000);
    const capped = truncateToolOutput(long);
    assert.ok(capped.length < long.length);
    assert.match(capped, /truncated 4000 characters/);
  });
});
