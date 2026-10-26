/**
 * The switches that decide what Nest offers an agent.
 *
 * Five booleans, one per feature, plus the master gate. A feature rather than a
 * tool, because a tool is an implementation detail and the thing a user wants to
 * decide is "may an agent reorganize my sidebar" — but each feature maps to one
 * or two tools, so turning one off is turning specific tools off.
 *
 * Reading is on and every write is off. The failure mode of reading is that an
 * agent knows less than it could; the failure mode of *not* reading is the whole
 * reason this exists — an agent that cannot see the organization layer builds a
 * second project for a worktree that already has one. A write is different: it
 * changes something the user made, so it waits to be asked for.
 */

import type { AgentToolFlags } from "./toolkit.ts";

export interface AgentToolSettingDescriptor {
  readonly type: "boolean";
  readonly label: string;
  readonly description: string;
  readonly default: boolean;
}

/**
 * The descriptors, spread into the plugin's one `bb.settings.define` call.
 *
 * They live here rather than in `server.ts` so the switch and the tool it gates
 * are added in one commit: a tool whose setting is missing from this map is a
 * tool no user can turn off, and the type below makes that a compile error.
 */
export const AGENT_TOOL_SETTING_DESCRIPTORS = {
  agentToolsEnabled: {
    type: "boolean",
    label: "Agents · Nest tools",
    description:
      "Let agents read and (below) change the organization layer bb itself does not hold.",
    default: true,
  },
  agentToolsRead: {
    type: "boolean",
    label: "Agents · Read the sidebar structure",
    description:
      "Give agents `nest_sidebar_map`, so one does not create a second project for a worktree that already has one.",
    default: true,
  },
  agentToolsGrouping: {
    type: "boolean",
    label: "Agents · File projects into groups",
    description:
      "Let agents move a project into a group or out to Ungrouped. Only the filing changes.",
    default: false,
  },
  agentToolsGroups: {
    type: "boolean",
    label: "Agents · Create and rename groups",
    description: "Let agents create a group and rename one.",
    default: false,
  },
  agentToolsAliases: {
    type: "boolean",
    label: "Agents · Rename workspaces",
    description:
      "Let agents set or clear a worktree's alias — the name shown instead of its branch.",
    default: false,
  },
} as const satisfies Record<string, AgentToolSettingDescriptor>;

/**
 * Which flag each setting feeds.
 *
 * The inverse of the map above and deliberately written out: a typo in one
 * direction is a switch that does nothing, and two derived maps that disagree
 * would be a switch that turns on the wrong thing.
 */
const SETTING_FOR_FLAG: Readonly<Record<keyof AgentToolFlags, keyof typeof AGENT_TOOL_SETTING_DESCRIPTORS>> = {
  enabled: "agentToolsEnabled",
  read: "agentToolsRead",
  grouping: "agentToolsGrouping",
  groups: "agentToolsGroups",
  aliases: "agentToolsAliases",
};

/** The flags a plugin load starts from, before any setting has been read. */
export const DEFAULT_AGENT_TOOL_FLAGS: AgentToolFlags = {
  enabled: true,
  read: true,
  grouping: false,
  groups: false,
  aliases: false,
};

/** What a settings read hands back, loosely: this module only wants booleans. */
export interface AgentToolSettingsSource {
  get(): Promise<Readonly<Record<string, unknown>>>;
  onChange(listener: (next: Readonly<Record<string, unknown>>) => void): void;
}

/**
 * A flags object that stays current.
 *
 * Returned as a live object rather than a value because the two agent callbacks
 * are synchronous and run long after this returns: the tool gate reads it per
 * call, and the instruction provider reads it per thread start. Assigning into
 * one object is what makes a settings change visible to both without a reload —
 * `registerTool` has no disposer, so this is the only mechanism there is.
 *
 * A read that fails leaves the defaults standing. They are the same values the
 * descriptors declare, so the failure is a window of a few milliseconds at
 * plugin load and never a wrong answer.
 */
export function liveAgentToolFlags(source: AgentToolSettingsSource): AgentToolFlags {
  const flags: AgentToolFlags = { ...DEFAULT_AGENT_TOOL_FLAGS };

  const apply = (values: Readonly<Record<string, unknown>>): void => {
    for (const flag of Object.keys(flags) as (keyof AgentToolFlags)[]) {
      const value = values[SETTING_FOR_FLAG[flag]];
      if (typeof value === "boolean") flags[flag] = value;
    }
  };

  void source.get().then(apply).catch(() => {});
  source.onChange(apply);
  return flags;
}
