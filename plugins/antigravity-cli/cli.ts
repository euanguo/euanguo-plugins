import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { experimental_hostToolchain } from "@get-bb/plugin-sdk/process";

export function resolveAntigravityCommand(command: string, options?: { cwd?: string; env?: NodeJS.ProcessEnv }): string | null {
  const resolved = experimental_hostToolchain.resolve(command, options);
  if (resolved || command !== "agy") return resolved;
  const env = options?.env ?? process.env;
  const candidate = process.platform === "win32"
    ? join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "agy", "bin", "agy.exe")
    : join(homedir(), ".local", "bin", "agy");
  try {
    accessSync(candidate, constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

// Resolve on the agent host, where the CLI is installed, rather than the BB server.
export function resolveAntigravityLaunchSpec(request: any): void {
  const params = request?.params;
  for (const options of [params?.providerOptions, params?.options?.providerOptions]) {
    const spec = options?.acpLaunchSpec;
    if (spec?.command !== "agy") continue;
    const command = resolveAntigravityCommand(spec.command, { cwd: spec.cwd, env: { ...process.env, ...spec.env } });
    if (command) spec.command = command;
  }
}
