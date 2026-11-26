/**
 * Harbor's three-tier agent access model and canonical tool inventory.
 *
 * One source of truth feeds:
 * - persistent KV storage (`agentAccess:v1`),
 * - RPC validation (`getAgentAccess` / `setAgentAccess`),
 * - `bb.agents.configure` (session tool visibility),
 * - `bb.agents.registerTool` (live per-call execution gating), and
 * - `bb.agents.contributeInstructions` (tool list advertised in instructions).
 *
 * Keeping all five on one table ensures the prompt never names a tool the
 * session cannot invoke, and `read-only` never exposes a mutating tool.
 */

import {
  AGENT_ACCESS_TIERS,
  type AgentAccessTier,
} from "../schemas/settings.ts";

export { AGENT_ACCESS_TIERS, type AgentAccessTier };

export const DEFAULT_AGENT_ACCESS_TIER: AgentAccessTier = "read-only";
export const AGENT_ACCESS_KV_KEY = "agentAccess:v1";
export const AGENT_ACCESS_CHANNEL = "agent-access";

export type AgentToolScope = "global" | "feature-inside";
export type AgentToolMinTier = Exclude<AgentAccessTier, "off">;

export interface AgentToolSpec {
  readonly name: string;
  readonly minTier: AgentToolMinTier;
  readonly scope: AgentToolScope;
  readonly readOnly: boolean;
  readonly destructive: boolean;
}

export const HARBOR_AGENT_TOOL_SPECS = [
  {
    name: "harbor_sidebar_map",
    minTier: "read-only",
    scope: "global",
    readOnly: true,
    destructive: false,
  },
  {
    name: "harbor_feature_list",
    minTier: "read-only",
    scope: "global",
    readOnly: true,
    destructive: false,
  },
  {
    name: "harbor_feature_brief",
    minTier: "read-only",
    scope: "feature-inside",
    readOnly: true,
    destructive: false,
  },
  {
    name: "harbor_feature_git_status",
    minTier: "read-only",
    scope: "feature-inside",
    readOnly: true,
    destructive: false,
  },
  {
    name: "harbor_feature_meta",
    minTier: "full",
    scope: "feature-inside",
    readOnly: false,
    destructive: false,
  },
  {
    name: "harbor_feature_repos",
    minTier: "full",
    scope: "feature-inside",
    readOnly: false,
    destructive: true,
  },
  {
    name: "harbor_feature_lifecycle",
    minTier: "full",
    scope: "global",
    readOnly: false,
    destructive: true,
  },
  {
    name: "harbor_sidebar_organize",
    minTier: "full",
    scope: "global",
    readOnly: false,
    destructive: false,
  },
  {
    name: "harbor_thread_spawn",
    minTier: "full",
    scope: "global",
    readOnly: false,
    destructive: false,
  },
  {
    name: "harbor_admin_delete",
    minTier: "full",
    scope: "global",
    readOnly: false,
    destructive: true,
  },
] as const satisfies readonly AgentToolSpec[];

export type HarborAgentToolName = (typeof HARBOR_AGENT_TOOL_SPECS)[number]["name"];

export const HARBOR_AGENT_TOOL_NAMES: readonly HarborAgentToolName[] =
  HARBOR_AGENT_TOOL_SPECS.map((spec) => spec.name);

const TOOL_SPEC_BY_NAME: ReadonlyMap<string, (typeof HARBOR_AGENT_TOOL_SPECS)[number]> =
  new Map(HARBOR_AGENT_TOOL_SPECS.map((spec) => [spec.name, spec]));

export function isAgentAccessTier(value: unknown): value is AgentAccessTier {
  return value === "off" || value === "read-only" || value === "full";
}

/**
 * Decode an untrusted KV value into a valid `AgentAccessTier`.
 *
 * Missing, corrupt, or legacy v0 payloads fall back directly to
 * `DEFAULT_AGENT_ACCESS_TIER` (`"read-only"`) with zero compatibility shims.
 */
export function decodeAgentAccessTier(raw: unknown): AgentAccessTier {
  if (isAgentAccessTier(raw)) return raw;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const candidate = (raw as { readonly tier?: unknown }).tier;
    if (isAgentAccessTier(candidate)) return candidate;
  }
  return DEFAULT_AGENT_ACCESS_TIER;
}

export interface AccessTierVisibilityOptions {
  /** Whether the thread runs inside a Harbor feature folder. Defaults to `true`. */
  readonly insideFeature?: boolean;
}

export function isToolAllowedForTier(
  toolName: string,
  tier: AgentAccessTier,
  options?: AccessTierVisibilityOptions,
): boolean {
  if (tier === "off") return false;
  const spec = TOOL_SPEC_BY_NAME.get(toolName);
  if (spec === undefined) return false;
  if (tier === "read-only" && spec.minTier !== "read-only") return false;
  const insideFeature = options?.insideFeature ?? true;
  if (!insideFeature && spec.scope === "feature-inside") return false;
  return true;
}

export function toolsForAccessTier(
  tier: AgentAccessTier,
  options?: AccessTierVisibilityOptions,
): readonly HarborAgentToolName[] {
  if (tier === "off") return [];
  const insideFeature = options?.insideFeature ?? true;
  return HARBOR_AGENT_TOOL_SPECS.filter((spec) => {
    if (tier === "read-only" && spec.minTier !== "read-only") return false;
    if (!insideFeature && spec.scope === "feature-inside") return false;
    return true;
  }).map((spec) => spec.name);
}
