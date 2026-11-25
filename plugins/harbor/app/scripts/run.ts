import type { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

import {
  parseSettingsFile,
  SETTINGS_FILES,
  type WorkspaceScripts,
} from "./settings.js";

type Sdk = ReturnType<typeof useSdk>;
type Navigate = ReturnType<typeof useBbNavigate>;

const RUN_TERMINAL_TITLE = "Run";

function decodeContent(content: string, encoding: "base64" | "utf8"): string {
  if (encoding === "utf8") return content;
  const bytes = Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function readWorkspaceScripts(
  sdk: Sdk,
  hostId: string,
  workspacePath: string,
): Promise<WorkspaceScripts | null> {
  for (const file of SETTINGS_FILES) {
    try {
      const result = await sdk.files.read({
        hostId,
        rootPath: workspacePath,
        path: `${workspacePath}/${file}`,
      });
      const scripts = parseSettingsFile(
        file,
        decodeContent(result.content, result.contentEncoding),
      );
      if (scripts.run !== null) return scripts;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Run the workspace's script in a terminal on this thread.
 *
 * The script comes from `.conductor/settings.toml` or `conductor.json`, the
 * same files Conductor reads. bb owns the setup script, so only `run` is used.
 */
export async function runWorkspaceScript(
  sdk: Sdk,
  navigate: Navigate,
  threadId: string,
  workspaceThreadIds: readonly string[] = [threadId],
): Promise<void> {
  const thread = await sdk.threads.get({ threadId });
  if (thread.environmentId === null) {
    toast.error("This thread has no workspace to run in.");
    return;
  }
  const environment = await sdk.environments.get({
    environmentId: thread.environmentId,
  });
  if (environment.path === null) {
    toast.error("This workspace has no checkout to run in.");
    return;
  }
  const scripts = await readWorkspaceScripts(
    sdk,
    environment.hostId,
    environment.path,
  );
  if (scripts === null || scripts.run === null) {
    toast.error(
      'No run script. Add [scripts] run = "…" to .conductor/settings.toml.',
    );
    return;
  }
  if (scripts.runMode === "nonconcurrent") {
    const lists = await Promise.all([
      sdk.terminals.list({
        scope: { kind: "environment", environmentId: environment.id },
      }),
      ...[...new Set([threadId, ...workspaceThreadIds])].map((id) =>
        sdk.terminals.list({ scope: { kind: "thread", threadId: id } }),
      ),
    ]);
    const sessions = lists.flatMap((list) => list.sessions);
    await Promise.all(
      sessions
        .filter(
          (session) =>
            session.title === RUN_TERMINAL_TITLE &&
            session.status === "running",
        )
        .map((session) =>
          sdk.terminals
            .close({ terminalId: session.id, mode: "force" })
            .catch(() => undefined),
        ),
    );
  }
  const terminal = await sdk.terminals.create({
    scope: { kind: "thread", threadId },
    cols: 120,
    rows: 32,
    title: RUN_TERMINAL_TITLE,
    start: { mode: "shell" },
  });
  await navigate.experimental_openTerminal({ terminalId: terminal.id });
  await sdk.terminals.input({
    terminalId: terminal.id,
    dataBase64: encodeBase64(`${scripts.run}\n`),
  });
}
