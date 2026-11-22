import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { experimental_hostToolchain } from "@get-bb/plugin-sdk/process";

function isExecutableFile(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveAntigravityCommand(
  command: string,
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): string | null {
  const trimmed = command.trim() || "agy";
  const resolved = experimental_hostToolchain.resolve(trimmed, options);
  if (resolved || trimmed !== "agy") return resolved;

  const env = options?.env ?? process.env;
  const candidates =
    process.platform === "win32"
      ? [
          join(
            env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
            "agy",
            "bin",
            "agy.exe",
          ),
        ]
      : [
          join(homedir(), ".local", "bin", "agy"),
          "/opt/homebrew/bin/agy",
          "/usr/local/bin/agy",
        ];

  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

// Resolve on the agent host, where the CLI is installed, rather than the BB server.
export function resolveAntigravityLaunchSpec(request: any): void {
  const params = request?.params;
  for (const options of [params?.providerOptions, params?.options?.providerOptions]) {
    const spec = options?.acpLaunchSpec;
    if (typeof spec?.command !== "string") continue;
    const rawCommand = spec.command.trim() || "agy";
    spec.command = rawCommand;
    if (rawCommand !== "agy") continue;
    const command = resolveAntigravityCommand(rawCommand, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
    });
    if (command) spec.command = command;
  }
}
