import { experimental_execHostFile } from "@get-bb/plugin-sdk/process";
import type { z } from "zod";
import { providerHealthResultSchema } from "@get-bb/plugin-sdk/provider-bridge";
import { resolveAntigravityCommand } from "./cli.ts";
import { readAntigravityProviderUsage } from "./usage.ts";

export type HealthStatus = "ready" | "unauthenticated" | "expired" | "unknown";
export type HealthResult = z.infer<typeof providerHealthResultSchema>;
export type AuthProbe = (
  command: string,
  env: Record<string, string>,
) => Promise<HealthStatus>;
export type ExecRunner = (
  command: string,
  args: string[],
  env: Record<string, string>,
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

const HEALTH_CACHE_TTL_MS = 30_000;
const HEALTH_EXEC_TIMEOUT_MS = 4_000;

export function authStatusFromUsage(result: {
  supported: boolean;
  usage?: { status: string };
}): HealthStatus {
  if (!result.supported || !result.usage) return "unknown";
  switch (result.usage.status) {
    case "ok":
      return "ready";
    case "unauthenticated":
    case "expired":
      return result.usage.status;
    default:
      return "unknown";
  }
}

async function defaultExecRunner(
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await experimental_execHostFile(command, args, {
      env,
      timeout: HEALTH_EXEC_TIMEOUT_MS,
      maxBuffer: 256 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const record =
      error && typeof error === "object"
        ? (error as { code?: unknown; stdout?: unknown; stderr?: unknown })
        : {};
    return {
      code: typeof record.code === "number" ? record.code : 1,
      stdout: typeof record.stdout === "string" ? record.stdout : "",
      stderr: typeof record.stderr === "string" ? record.stderr : "",
    };
  }
}

async function defaultAuthProbe(
  command: string,
  env: Record<string, string>,
): Promise<HealthStatus> {
  return authStatusFromUsage(
    await readAntigravityProviderUsage({ command, env }),
  );
}

export function createHealthChecker(options?: {
  probe?: AuthProbe;
  exec?: ExecRunner;
  resolve?: (
    command: string,
    opts?: { env?: NodeJS.ProcessEnv },
  ) => Promise<string | null> | string | null;
  now?: () => number;
}) {
  const probe = options?.probe ?? defaultAuthProbe;
  const exec = options?.exec ?? defaultExecRunner;
  const resolve =
    options?.resolve ??
    ((cmd: string, opts?: { env?: NodeJS.ProcessEnv }) =>
      resolveAntigravityCommand(cmd, opts));
  const now = options?.now ?? Date.now;
  const cache = new Map<string, { at: number; result: HealthResult }>();
  const pending = new Map<string, Promise<HealthResult>>();

  return async (
    command: string,
    env: Record<string, string> = {},
  ): Promise<HealthResult> => {
    const normalizedCommand = command.trim() || "agy";
    const key = JSON.stringify([normalizedCommand, Object.entries(env).sort()]);
    const cached = cache.get(key);
    if (
      cached &&
      now() - cached.at >= 0 &&
      now() - cached.at < HEALTH_CACHE_TTL_MS
    ) {
      return cached.result;
    }
    const existing = pending.get(key);
    if (existing) return existing;

    const promise = (async () => {
      let installedVersion: string | null = null;
      const loginCommand = `${normalizedCommand} acp --login`;
      const makeResult = (
        status: "not_installed" | "unsupported_version" | HealthStatus,
        statusMessage: string | null = null,
      ): HealthResult => ({
        supported: true,
        health: {
          status,
          statusMessage,
          installedVersion,
          minimumSupportedVersion: null,
          canInstall: false,
          canUpdate: false,
          accountEmail: null,
          planLabel: null,
          loginCommand,
        },
      });

      try {
        const mergedEnv = { ...process.env, ...env } as NodeJS.ProcessEnv;
        const resolvedPath = await resolve(normalizedCommand, {
          env: mergedEnv,
        });
        if (!resolvedPath) {
          return makeResult(
            "not_installed",
            "Install Antigravity CLI on this machine.",
          );
        }

        const versionRun = await exec(
          resolvedPath,
          ["--version"],
          mergedEnv as Record<string, string>,
        );
        if (versionRun.code === 0) {
          const match = /\b\d+\.\d+(?:\.\d+)*(?:[-+][\w.-]+)?\b/.exec(
            `${versionRun.stdout}\n${versionRun.stderr}`,
          );
          if (match) installedVersion = match[0];
        }

        const help = await exec(
          resolvedPath,
          ["acp", "--help"],
          mergedEnv as Record<string, string>,
        );
        if (
          help.code !== 0 ||
          !/Agent Client Protocol|ACP.*stdio/i.test(
            `${help.stdout}\n${help.stderr}`,
          )
        ) {
          return makeResult(
            "unsupported_version",
            "This CLI does not expose native ACP. Update Antigravity CLI.",
          );
        }

        const auth = await probe(resolvedPath, env);
        return makeResult(
          auth,
          auth === "ready"
            ? null
            : auth === "unknown"
              ? "Could not verify the Antigravity sign-in. Check the CLI logs."
              : `Run ${loginCommand} on this machine.`,
        );
      } catch {
        return makeResult(
          "unknown",
          "Could not check Antigravity CLI. Check its executable path and retry.",
        );
      }
    })();

    pending.set(key, promise);
    try {
      const value = await promise;
      if (cache.size > 64) cache.clear();
      cache.set(key, { at: now(), result: value });
      return value;
    } finally {
      pending.delete(key);
    }
  };
}
