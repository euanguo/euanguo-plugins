/**
 * Every runtime dependency has a caller.
 *
 * A dependency in `dependencies` is code the built plugin carries. One with no
 * import is weight a reader has to explain and an upgrade has to consider for no
 * reason. Dev-only tooling is exempt; this checks the shipped surface.
 */
import assert from "node:assert/strict";
import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceTargets = [
  "app.tsx",
  "server.ts",
  "host.ts",
  "app",
  "bb-ui",
  "components",
  "hooks",
  "lib",
  "server",
  "host",
];

async function sourceFiles(target: string): Promise<string[]> {
  const absolute = path.join(root, target);
  let entries: Dirent[];
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return target.endsWith(".ts") || target.endsWith(".tsx") ? [target] : [];
  }
  const nested = await Promise.all(
    entries.map((entry) =>
      sourceFiles(path.join(target, entry.name)),
    ),
  );
  return nested.flat();
}

async function moduleSpecifiers(relative: string): Promise<string[]> {
  const source = await readFile(path.join(root, relative), "utf8");
  const pattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s*)?["']([^"']+)["']/g;
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
}

describe("the shipped dependency list", () => {
  it("names only packages the source imports", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const declared = Object.keys(manifest.dependencies ?? {});
    const specifiers = new Set(
      (
        await Promise.all(
          sourceTargets.map(async (target) => {
            const files = await sourceFiles(target);
            return (await Promise.all(files.map(moduleSpecifiers))).flat();
          }),
        )
      ).flat(),
    );

    for (const dependency of declared) {
      const used = [...specifiers].some(
        (specifier) =>
          specifier === dependency || specifier.startsWith(`${dependency}/`),
      );
      assert.ok(used, `${dependency} is declared but never imported`);
    }
  });
});
