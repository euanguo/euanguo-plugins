import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  createAgentToolRegistry,
  truncateToolOutput,
  type AgentToolFlags,
} from "../lib/agent/toolkit.ts";
import {
  AGENT_TOOL_SETTING_DESCRIPTORS,
  DEFAULT_AGENT_TOOL_FLAGS,
  liveAgentToolFlags,
} from "../lib/agent/settings.ts";

type Registration = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (params: unknown, context: unknown) => Promise<string>;
};

/** The smallest `bb` the registry touches, recording what it was handed. */
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

function flags(overrides: Partial<AgentToolFlags> = {}): AgentToolFlags {
  return { ...DEFAULT_AGENT_TOOL_FLAGS, ...overrides };
}

const CONTEXT = { threadId: "thr_1", projectId: "proj_1", signal: new AbortController().signal };

describe("registering a tool and gating it", () => {
  it("registers every tool once and reports which are on", () => {
    const { bb, registrations } = stubBb();
    const registry = createAgentToolRegistry({ bb, flags: flags({ read: true, grouping: false }) });

    registry.register({
      name: "nest_read",
      feature: "read",
      description: "read",
      parameters: z.object({}),
      async execute() {
        return "read ok";
      },
    });
    registry.register({
      name: "nest_write",
      feature: "grouping",
      description: "write",
      parameters: z.object({}),
      async execute() {
        return "write ok";
      },
    });

    assert.equal(registrations.length, 2);
    assert.deepEqual(registry.enabledToolNames(), ["nest_read"]);
    assert.deepEqual(
      registry.tools.map((tool) => tool.name),
      ["nest_read", "nest_write"],
    );
  });

  it("answers a disabled call with a sentence rather than an error", async () => {
    const { bb, registrations } = stubBb();
    const registry = createAgentToolRegistry({ bb, flags: flags({ grouping: false }) });
    registry.register({
      name: "nest_write",
      feature: "grouping",
      description: "write",
      parameters: z.object({}),
      async execute() {
        return "should not run";
      },
    });

    const answer = await registrations[0].execute({}, CONTEXT);
    assert.match(answer, /turned off/);
    assert.doesNotMatch(answer, /should not run/);
  });

  it("takes the master gate as a gate over every feature", () => {
    const { bb } = stubBb();
    const live = flags({ enabled: false, read: true, grouping: true });
    const registry = createAgentToolRegistry({ bb, flags: live });
    registry.register({
      name: "nest_read",
      feature: "read",
      description: "read",
      parameters: z.object({}),
      async execute() {
        return "";
      },
    });

    assert.deepEqual(registry.enabledToolNames(), []);
    assert.equal(registry.isEnabled("read"), false);
  });

  it("follows a settings change made after registration", async () => {
    const { bb, registrations } = stubBb();
    const live = flags({ grouping: false });
    const registry = createAgentToolRegistry({ bb, flags: live });
    registry.register({
      name: "nest_write",
      feature: "grouping",
      description: "write",
      parameters: z.object({}),
      async execute() {
        return "wrote";
      },
    });

    assert.match(await registrations[0].execute({}, CONTEXT), /turned off/);
    // The registration cannot be undone, so this mutation is the only mechanism
    // there is: the same registration must answer differently afterwards.
    live.grouping = true;
    assert.equal(await registrations[0].execute({}, CONTEXT), "wrote");
    assert.deepEqual(registry.enabledToolNames(), ["nest_write"]);
  });

  it("reports a throwing tool instead of failing the turn", async () => {
    const { bb, registrations } = stubBb();
    const registry = createAgentToolRegistry({ bb, flags: flags() });
    registry.register({
      name: "nest_read",
      feature: "read",
      description: "read",
      parameters: z.object({}),
      async execute() {
        throw new Error("the machine is asleep");
      },
    });

    assert.equal(await registrations[0].execute({}, CONTEXT), "Error: the machine is asleep");
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

describe("the switches that gate the tools", () => {
  it("declares one setting per flag, and one flag per setting", () => {
    const declared = Object.keys(AGENT_TOOL_SETTING_DESCRIPTORS).sort();
    assert.deepEqual(declared, [
      "agentToolsAliases",
      "agentToolsEnabled",
      "agentToolsGrouping",
      "agentToolsGroups",
      "agentToolsRead",
    ]);
  });

  it("starts read-only, which is the whole safety story", () => {
    assert.deepEqual(DEFAULT_AGENT_TOOL_FLAGS, {
      enabled: true,
      read: true,
      grouping: false,
      groups: false,
      aliases: false,
    });
    for (const [key, descriptor] of Object.entries(AGENT_TOOL_SETTING_DESCRIPTORS)) {
      const expected = DEFAULT_AGENT_TOOL_FLAGS[
        (key.replace("agentTools", "").toLowerCase() === "enabled"
          ? "enabled"
          : key.replace("agentTools", "").toLowerCase()) as keyof AgentToolFlags
      ];
      assert.equal(descriptor.default, expected, key);
    }
  });

  it("reads the stored values and follows later changes", async () => {
    const listeners: ((next: Record<string, unknown>) => void)[] = [];
    const source = {
      async get() {
        return { agentToolsRead: true, agentToolsGrouping: true, agentToolsGroups: false };
      },
      onChange(next: (values: Record<string, unknown>) => void) {
        listeners.push(next);
      },
    };

    const live = liveAgentToolFlags(source);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(live.grouping, true);
    assert.equal(live.groups, false);

    assert.equal(listeners.length, 1);
    listeners[0]({ agentToolsGroups: true, agentToolsAliases: true });
    assert.equal(live.groups, true);
    assert.equal(live.aliases, true);
    // A key the write did not mention keeps its value rather than reverting.
    assert.equal(live.grouping, true);
  });

  it("keeps the declared defaults when the read fails", async () => {
    const live = liveAgentToolFlags({
      async get() {
        throw new Error("settings unavailable");
      },
      onChange() {},
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(live, DEFAULT_AGENT_TOOL_FLAGS);
  });

  it("ignores a value of the wrong type rather than trusting it", async () => {
    const live = liveAgentToolFlags({
      async get() {
        return { agentToolsGrouping: "yes", agentToolsGroups: true };
      },
      onChange() {},
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(live.grouping, false);
    assert.equal(live.groups, true);
  });
});
