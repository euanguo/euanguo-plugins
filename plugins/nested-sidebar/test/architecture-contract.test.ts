import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

async function sourceFiles(relativeDirectory: string): Promise<string[]> {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const relativePath = path.join(relativeDirectory, entry.name);
        if (entry.isDirectory()) return sourceFiles(relativePath);
        return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
          ? [relativePath]
          : [];
      }),
  );
  return files.flat();
}

async function moduleSpecifiers(relativePath: string): Promise<string[]> {
  const file = path.join(root, relativePath);
  const source = await readFile(file, "utf8");
  const pattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s*)?["']([^"']+)["']/g;
  return [...source.matchAll(pattern)]
    .map((match) => match[1] ?? "")
    .filter(Boolean);
}

function resolvedLocalTarget(
  fromFile: string,
  specifier: string,
): string | null {
  if (specifier.startsWith("@/")) return specifier.slice(2);
  if (!specifier.startsWith(".")) return null;
  return path.relative(
    root,
    path.resolve(root, path.dirname(fromFile), specifier),
  );
}

describe("architecture boundaries", () => {
  it("keeps frontend code off the server entry point", async () => {
    const files = [
      ...(await sourceFiles("components")),
      ...(await sourceFiles("hooks")),
      "app.tsx",
    ];
    for (const file of files) {
      for (const specifier of await moduleSpecifiers(file)) {
        if (!specifier.startsWith("@/server")) continue;
        assert.equal(
          specifier,
          "@/server/contract",
          `${file} may import only the RPC contract`,
        );
      }
    }
  });

  it("keeps server, host, and domain code independent of the UI", async () => {
    const files = [
      "server.ts",
      ...(await sourceFiles("server")),
      ...(await sourceFiles("host")),
      ...(await sourceFiles("lib")),
    ];
    for (const file of files) {
      for (const specifier of await moduleSpecifiers(file)) {
        const target = resolvedLocalTarget(file, specifier);
        if (target === null) continue;
        assert.equal(
          target.startsWith("components/") || target.startsWith("hooks/"),
          false,
          `${file} must not depend on UI module ${target}`,
        );
      }
    }
  });
});
