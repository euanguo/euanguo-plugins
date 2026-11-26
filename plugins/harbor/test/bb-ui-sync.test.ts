import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function collectFiles(dir: string, baseDir = dir): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, baseDir)));
    } else if (entry.isFile()) {
      files.push(path.relative(baseDir, fullPath).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

test("mirrored bb-ui files stay in exact parity with root packages/bb-ui when present", async (t) => {
  const pluginRoot = path.resolve(import.meta.dirname, "..");
  const repoRootManifest = path.resolve(
    pluginRoot,
    "../..",
    "packages/bb-ui/manifest.json",
  );
  if (!existsSync(repoRootManifest)) {
    t.skip("Standalone plugin checkout without monorepo root packages/bb-ui");
    return;
  }

  const rootSrcDir = path.resolve(pluginRoot, "../..", "packages/bb-ui/src");
  const pluginBbUiConfig = JSON.parse(
    await readFile(path.join(pluginRoot, "bb-ui.json"), "utf8"),
  ) as { outDir?: string; items: string[] };
  const manifest = JSON.parse(await readFile(repoRootManifest, "utf8")) as {
    items: Record<
      string,
      { registryDependencies?: string[]; files?: { target: string }[] }
    >;
  };

  const closure = new Set<string>();
  const pending = [...pluginBbUiConfig.items];
  while (pending.length > 0) {
    const name = pending.pop();
    if (!name || closure.has(name)) continue;
    const entry = manifest.items[name];
    assert.ok(entry, `Unknown bb-ui item "${name}" in plugins/harbor/bb-ui.json`);
    closure.add(name);
    for (const dep of entry.registryDependencies ?? []) {
      if (!closure.has(dep)) pending.push(dep);
    }
  }

  const expectedTargets = new Set<string>();
  for (const name of closure) {
    for (const file of manifest.items[name]?.files ?? []) {
      expectedTargets.add(file.target);
    }
  }

  const mirrorDir = path.join(pluginRoot, pluginBbUiConfig.outDir ?? "bb-ui");
  const actualFiles = await collectFiles(mirrorDir);
  assert.deepEqual(actualFiles, [...expectedTargets].sort());

  for (const relPath of actualFiles) {
    const [upstreamBuf, mirroredBuf] = await Promise.all([
      readFile(path.join(rootSrcDir, relPath)),
      readFile(path.join(mirrorDir, relPath)),
    ]);
    assert.ok(
      upstreamBuf.equals(mirroredBuf),
      `Mirrored file bb-ui/${relPath} drifted from packages/bb-ui/src/${relPath}. Run: node scripts/sync-bb-ui.mjs --sync-plugins`,
    );
  }
});
