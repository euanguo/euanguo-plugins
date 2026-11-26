import assert from "node:assert/strict";
import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoots = [
  "app.tsx",
  "host.ts",
  "server.ts",
  "components",
  "host",
  "hooks",
  "lib",
  "server",
];

async function sourceFiles(target: string): Promise<string[]> {
  const absolute = path.join(root, target);
  let entries: Dirent[];
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return absolute.endsWith(".ts") || absolute.endsWith(".tsx")
      ? [target]
      : [];
  }
  const nested = await Promise.all(
    entries.map((entry) =>
      sourceFiles(
        `${target}/${entry.name}`,
      ),
    ),
  );
  return nested.flat();
}

async function lineCount(relative: string): Promise<number> {
  const source = await readFile(path.join(root, relative), "utf8");
  return source.split("\n").length - 1;
}

describe("production source shape", () => {
  it("keeps every production source file below the hard ceiling", async () => {
    const files = (
      await Promise.all(sourceRoots.map((target) => sourceFiles(target)))
    ).flat();
    for (const file of files) {
      assert.ok(
        (await lineCount(file)) <= 900,
        `${file} exceeds the 900-line hard ceiling`,
      );
    }
  });
});
