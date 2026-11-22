import { experimental_execHostFile } from "@get-bb/plugin-sdk/process";
import type { ProviderUsageResult } from "@get-bb/plugin-sdk/provider-bridge";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { resolveAntigravityCommand } from "./cli.ts";

const USAGE_TIMEOUT_MS = 15_000;
const USAGE_CACHE_TTL_MS = 60_000;
const PROVIDER_ID = "antigravity-cli";
const PLUGIN_ID = "antigravity-cli";

const agyBucketSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  window: z.string().optional(),
  remaining_fraction: z.number().optional(),
  remaining_amount: z.number().optional(),
  disabled: z.boolean().optional(),
  reset_time: z.string().nullable().optional(),
}).passthrough();

const agyGroupSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  buckets: z.array(agyBucketSchema).default([]),
}).passthrough();

const agyUsageCommandSchema = z.object({
  status: z.string().optional(),
  error: z.unknown().optional(),
  command: z.object({
    name: z.literal("usage"),
    data: z.object({
      description: z.string().optional(),
      groups: z.array(agyGroupSchema).default([]),
      buckets: z.array(agyBucketSchema).optional(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

type AgyBucket = z.infer<typeof agyBucketSchema>;
type AgyGroup = z.infer<typeof agyGroupSchema>;

function clampUsedPercent(remainingFraction: number): number {
  if (!Number.isFinite(remainingFraction)) return 0;
  const used = (1 - remainingFraction) * 100;
  return Math.min(100, Math.max(0, Math.round(used)));
}

function normalizeResetIso(resetTime: string | null | undefined): string | null {
  if (!resetTime) return null;
  const parsed = new Date(resetTime);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function collapseWhitespace(text: string): string {
  return text.trim().split(/\s+/u).join(" ");
}

function stripTrailingToken(text: string, tokenLower: string): string {
  const suffix = ` ${tokenLower}`;
  if (text.toLowerCase().endsWith(suffix)) {
    return text.slice(0, -suffix.length);
  }
  return text;
}

function shortenGroupName(groupName: string): string {
  const normalized = collapseWhitespace(groupName);
  const lower = normalized.toLowerCase();
  if (lower === "gemini models") return "Gemini";
  if (lower === "claude and gpt models") return "Claude/GPT";
  if (lower === "gemini 4 argon") return "Argon";
  return stripTrailingToken(normalized, "models");
}

function formatWindowSuffix(bucket: AgyBucket): string {
  const win = bucket.window?.trim().toLowerCase();
  const normalizedName = collapseWhitespace(bucket.name);
  const lowerName = normalizedName.toLowerCase();
  if (win === "5h" || win === "five-hour" || lowerName.startsWith("five hour")) return "5h";
  if (win === "weekly" || lowerName.includes("weekly")) return "7d";
  if (win === "daily" || lowerName.includes("daily")) return "1d";
  if (win) return win;
  const withoutRemaining = stripTrailingToken(normalizedName, "remaining");
  const withoutLimit = stripTrailingToken(withoutRemaining, "limit");
  return withoutLimit.toLowerCase() === "limit" ? "" : withoutLimit;
}

export function formatBucketWindowLabel(groupName: string | null, bucket: AgyBucket): string {
  const suffix = formatWindowSuffix(bucket);
  if (!groupName) return suffix || bucket.name;
  const shortGroup = shortenGroupName(groupName);
  if (!suffix || shortGroup.toLowerCase() === suffix.toLowerCase()) return shortGroup;
  return `${shortGroup} ${suffix}`;
}

export function normalizeAntigravityUsageOutput(stdout: string): ProviderUsageResult {
  const trimmed = stdout.trim();
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    if (isUnauthenticatedFailure(trimmed)) return { supported: true, usage: { status: "unauthenticated" } };
    if (isExpiredFailure(trimmed)) return { supported: true, usage: { status: "expired" } };
    return {
      supported: true,
      usage: {
        status: "error",
        message: "Antigravity CLI returned malformed usage JSON.",
        planLabel: null,
        accountEmail: null,
      },
    };
  }

  const parsed = agyUsageCommandSchema.safeParse(raw);
  if (!parsed.success) {
    if (isUnauthenticatedFailure(trimmed)) return { supported: true, usage: { status: "unauthenticated" } };
    if (isExpiredFailure(trimmed)) return { supported: true, usage: { status: "expired" } };
    return {
      supported: true,
      usage: {
        status: "error",
        message: "Antigravity CLI usage response was malformed.",
        planLabel: null,
        accountEmail: null,
      },
    };
  }

  const windows: Array<{
    label: string;
    usedPercent: number;
    resetsAt: string | null;
    kind: "custom";
    model: null;
  }> = [];

  const appendBucket = (groupName: string | null, bucket: AgyBucket) => {
    if (bucket.disabled === true) return;
    if (bucket.remaining_fraction === undefined && bucket.remaining_amount !== undefined) return;
    const remainingFraction = bucket.remaining_fraction ?? 0;
    windows.push({
      label: formatBucketWindowLabel(groupName, bucket),
      usedPercent: clampUsedPercent(remainingFraction),
      resetsAt: normalizeResetIso(bucket.reset_time),
      kind: "custom",
      model: null,
    });
  };

  const data = parsed.data.command.data;
  if (data.groups.length > 0) {
    for (const group of data.groups as AgyGroup[]) {
      for (const bucket of group.buckets) {
        appendBucket(group.name, bucket);
      }
    }
  } else if (Array.isArray(data.buckets)) {
    for (const bucket of data.buckets) {
      appendBucket(null, bucket);
    }
  }

  return {
    supported: true,
    usage: {
      status: "ok",
      accountEmail: null,
      planLabel: null,
      windows,
    },
  };
}

function isUnauthenticatedFailure(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("not signed in") ||
    lower.includes("authentication required") ||
    lower.includes("login") && lower.includes("required") ||
    lower.includes("unauthenticated")
  );
}

function isExpiredFailure(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("token expired") ||
    lower.includes("session expired") ||
    lower.includes("invalid_grant") ||
    lower.includes("reauthenticate")
  );
}

export async function readAntigravityProviderUsage(options?: {
  command?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  execFile?: typeof experimental_execHostFile;
  resolveCommand?: (command: string, opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) => string | null;
}): Promise<ProviderUsageResult> {
  const command = options?.command ?? "agy";
  const cwd = options?.cwd ?? process.cwd();
  const env = options?.env ?? process.env;
  const resolveCommand = options?.resolveCommand ?? resolveAntigravityCommand;
  const execFile = options?.execFile ?? experimental_execHostFile;

  try {
    const resolvedCommand = command ? await resolveCommand(command, { cwd, env }) : null;
    if (!resolvedCommand) {
      return { supported: true, usage: { status: "not_installed" } };
    }
    const { stdout, stderr } = await execFile(
      resolvedCommand,
      ["-p", "/usage", "--output-format", "json"],
      {
        cwd,
        env,
        timeout: USAGE_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      },
    );
    const combined = `${stdout}\n${stderr}`;
    const normalized = normalizeAntigravityUsageOutput(stdout);
    const usage = normalized.usage as { status: string };
    if (usage.status === "error" && isUnauthenticatedFailure(combined)) {
      return { supported: true, usage: { status: "unauthenticated" } };
    }
    if (usage.status === "error" && isExpiredFailure(combined)) {
      return { supported: true, usage: { status: "expired" } };
    }
    return normalized;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { supported: true, usage: { status: "not_installed" } };
    }
    const stdout = error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
    const stderr = error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
    const message = error instanceof Error ? error.message : String(error);
    const combined = `${message}\n${stdout}\n${stderr}`;
    if (isUnauthenticatedFailure(combined)) {
      return { supported: true, usage: { status: "unauthenticated" } };
    }
    if (isExpiredFailure(combined)) {
      return { supported: true, usage: { status: "expired" } };
    }
    return {
      supported: true,
      usage: {
        status: "error",
        message: "Antigravity CLI usage could not be collected.",
        planLabel: null,
        accountEmail: null,
      },
    };
  }
}

const baseUsageFields = {
  plan: z.object({ id: z.string().min(1), multiplier: z.number().int().positive().nullable() }).nullable().default(null),
  accountEmail: z.string().nullable(),
  planLabel: z.string().nullable(),
};

const windowKindSchema = z.enum(["five-hour", "daily", "weekly", "custom"]);

const usageResourceWindowSchema = z.object({
  kind: windowKindSchema.default("custom"),
  id: z.string().min(1),
  label: z.string().min(1),
  usedPercent: z.number().nonnegative(),
  resetsAt: z.string().nullable(),
  model: z.string().nullable(),
  cost: z.object({
    usedUsdCents: z.number().nonnegative(),
    limitUsdCents: z.number().positive(),
  }).nullable(),
});

const usageStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), ...baseUsageFields, windows: z.array(usageResourceWindowSchema) }),
  z.object({ status: z.literal("not_installed"), ...baseUsageFields }),
  z.object({ status: z.literal("unauthenticated"), ...baseUsageFields }),
  z.object({ status: z.literal("expired"), ...baseUsageFields }),
  z.object({ status: z.literal("error"), ...baseUsageFields, message: z.string() }),
]);

const accountKeySchema = z.string().min(1).nullable().default(null);

const usageResourceSchema = z.object({
  accountKey: accountKeySchema,
  id: z.string().min(1),
  providerId: z.string().min(1),
  label: z.string().min(1),
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("shared") }),
    z.object({ kind: z.literal("host"), hostId: z.string().min(1), hostName: z.string().min(1) }),
  ]),
});

const listResourcesOutputSchema = z.object({
  label: z.string().min(1).optional(),
  resources: z.array(usageResourceSchema),
});

const getResourceOutputSchema = z.object({
  accountKey: accountKeySchema,
  observedAt: z.number().int().nonnegative().nullable(),
  usage: usageStateSchema,
});

const LIST_RESOURCES_METHOD = "provider-usage.v1.listResources";
const GET_RESOURCE_METHOD = "provider-usage.v1.getResource";

const providerUsageSourceContract = defineRpcContract({
  [LIST_RESOURCES_METHOD]: {
    input: z.object({}),
    output: listResourcesOutputSchema,
    experimental_description: "Host-local usage inventory owned by the antigravity-cli provider plugin.",
  },
  [GET_RESOURCE_METHOD]: {
    input: z.object({
      resourceId: z.string().min(1),
      refresh: z.boolean(),
    }),
    output: getResourceOutputSchema,
    experimental_description: "Returns actual usage for one listed antigravity-cli host resource.",
  },
});

const resourceIdTupleSchema = z.tuple([z.string().min(1), z.string().min(1)]);

export function registerAntigravityUsageSource(bb: BbPluginApi) {
  if (!bb.rpc || !bb.sdk) return;

  type CachedObservation = z.infer<typeof getResourceOutputSchema>;
  const cache = new Map<string, CachedObservation>();
  const inflight = new Map<string, { refresh: boolean; promise: Promise<CachedObservation> }>();

  const loadResource = async (resourceId: string, refresh: boolean): Promise<CachedObservation> => {
    const [hostId, providerId] = resourceIdTupleSchema.parse(JSON.parse(resourceId));
    const host = await bb.sdk.hosts.get({ hostId }).catch((error: unknown) => {
      if (error instanceof Error && "status" in error && error.status === 404) {
        cache.delete(resourceId);
        throw new Error("Usage resource no longer exists.");
      }
      throw error;
    });
    const previous = cache.get(resourceId);
    const unavailable = (message: string): CachedObservation =>
      getResourceOutputSchema.parse({
        accountKey: previous?.accountKey ?? null,
        observedAt: previous?.observedAt ?? null,
        usage: {
          status: "error",
          accountEmail: null,
          planLabel: null,
          message,
        },
      });

    if (host.status === "disconnected") {
      return unavailable("Machine is disconnected.");
    }

    const providers = await bb.sdk.providers.list({ hostId, capability: "usage" });
    if (!providers.some(p => p.id === providerId && p.pluginId === (bb.pluginId ?? PLUGIN_ID) && p.id === PROVIDER_ID)) {
      cache.delete(resourceId);
      throw new Error("Usage resource no longer exists.");
    }

    if (
      !refresh &&
      previous?.usage.status === "ok" &&
      previous.observedAt !== null &&
      Date.now() - previous.observedAt < USAGE_CACHE_TTL_MS
    ) {
      return previous;
    }

    try {
      const limits = await bb.sdk.system.usageLimits({ hostId, providerId, refresh });
      const rawUsage = limits[providerId];
      if (!rawUsage) {
        throw new Error("Provider returned no usage information.");
      }
      const rawRecord = rawUsage as Record<string, unknown>;
      const result = getResourceOutputSchema.parse({
        accountKey: null,
        observedAt: rawUsage.status === "ok" ? Date.now() : previous?.observedAt ?? null,
        usage: {
          ...rawUsage,
          accountEmail: typeof rawRecord.accountEmail === "string" ? rawRecord.accountEmail : null,
          planLabel: typeof rawRecord.planLabel === "string" ? rawRecord.planLabel : null,
          plan: null,
          ...(rawUsage.status === "ok"
            ? {
                windows: rawUsage.windows.map((win, index) => ({
                  ...win,
                  id: `${index}:${win.label}`,
                  cost: win.cost ?? null,
                })),
              }
            : {}),
        },
      });
      cache.set(resourceId, result);
      return result;
    } catch {
      return unavailable("Usage could not be collected from this machine.");
    }
  };

  const collectResource = async (resourceId: string, refresh: boolean): Promise<CachedObservation> => {
    const existing = inflight.get(resourceId);
    if (existing) {
      if (!refresh || existing.refresh) return existing.promise;
      await existing.promise.catch(() => {});
      return collectResource(resourceId, refresh);
    }
    const promise = loadResource(resourceId, refresh).finally(() => {
      inflight.delete(resourceId);
    });
    inflight.set(resourceId, { refresh, promise });
    return promise;
  };

  bb.rpc.register(
    providerUsageSourceContract,
    {
      async [LIST_RESOURCES_METHOD]() {
        const hosts = await bb.sdk.hosts.list();
        const resources = (
          await Promise.all(
            hosts.map(async host => {
              const providers = await bb.sdk.providers.list({ hostId: host.id, capability: "usage" });
              return providers
                .filter(p => p.pluginId === (bb.pluginId ?? PLUGIN_ID) && p.id === PROVIDER_ID)
                .map(p => {
                  const id = JSON.stringify([host.id, p.id]);
                  return {
                    id,
                    accountKey: cache.get(id)?.accountKey ?? null,
                    providerId: p.id,
                    label: p.displayName,
                    scope: {
                      kind: "host" as const,
                      hostId: host.id,
                      hostName: host.name,
                    },
                  };
                });
            }),
          )
        ).flat();

        const validIds = new Set(resources.map(r => r.id));
        for (const cachedId of cache.keys()) {
          if (!validIds.has(cachedId)) cache.delete(cachedId);
        }
        return { resources };
      },
      [GET_RESOURCE_METHOD]: ({ resourceId, refresh }) => collectResource(resourceId, refresh),
    },
    {
      experimental_discoverable: true,
      experimental_description: "Host-local usage owned by the antigravity-cli provider plugin. Inventory reads metadata only. Independent of display plugins.",
    },
  );
}
