#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const BB_UI_ROOT = path.join(REPO_ROOT, "packages", "bb-ui");
const BB_UI_CONFIG_PATH = path.join(BB_UI_ROOT, "config.json");
const BB_UI_MANIFEST_PATH = path.join(BB_UI_ROOT, "manifest.json");
const BB_UI_PACKAGE_JSON_PATH = path.join(BB_UI_ROOT, "package.json");
const BB_UI_SRC_DIR = path.join(BB_UI_ROOT, "src");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");

const BB_REGISTRY_PREFIX = "@bb/";

function parseArgs(argv) {
  const args = {
    check: false,
    syncPlugins: false,
    ref: null,
    bbDir: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--check") {
      args.check = true;
    } else if (token === "--sync-plugins") {
      args.syncPlugins = true;
    } else if (token === "--ref") {
      args.ref = argv[++i] ?? null;
      if (!args.ref) throw new Error("--ref requires a git ref or commit SHA");
    } else if (token === "--bb-dir") {
      args.bbDir = argv[++i] ?? null;
      if (!args.bbDir) throw new Error("--bb-dir requires a path");
    } else if (token === "-h" || token === "--help") {
      console.log(
        [
          "Usage: node scripts/sync-bb-ui.mjs [options]",
          "",
          "Options:",
          "  --ref <ref>      Fetch a specific git ref or commit SHA from upstream",
          "  --bb-dir <path>  Read registry JSONs from a local get-bb/bb checkout",
          "  --sync-plugins   Mirror packages/bb-ui/src to plugins/*/bb-ui.json offline",
          "  --check          Verify packages/bb-ui/src and plugin mirrors have zero drift",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizePosix(relPath) {
  const normalized = path.posix.normalize(relPath.replace(/\\/g, "/"));
  if (
    path.posix.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`Invalid relative registry path: "${relPath}"`);
  }
  return normalized;
}

function normalizeRegistryDepName(dep) {
  return dep.startsWith(BB_REGISTRY_PREFIX)
    ? dep.slice(BB_REGISTRY_PREFIX.length)
    : dep;
}

async function runGit(args, cwd) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

async function cloneUpstreamRegistry(repoUrl, registryRelPath, ref) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "bb-ui-sync-"));
  try {
    if (ref && /^[0-9a-f]{7,40}$/i.test(ref)) {
      await runGit(["init"], tmpDir);
      await runGit(["remote", "add", "origin", repoUrl], tmpDir);
      await runGit(["sparse-checkout", "init", "--cone"], tmpDir);
      await runGit(
        ["sparse-checkout", "set", registryRelPath],
        tmpDir,
      );
      await runGit(["fetch", "--depth", "1", "origin", ref], tmpDir);
      await runGit(["checkout", "FETCH_HEAD"], tmpDir);
    } else {
      const cloneArgs = [
        "clone",
        "--depth",
        "1",
        "--filter=blob:none",
        "--sparse",
      ];
      if (ref) cloneArgs.push("--branch", ref);
      cloneArgs.push(repoUrl, tmpDir);
      await runGit(cloneArgs, REPO_ROOT);
      await runGit(["sparse-checkout", "set", registryRelPath], tmpDir);
    }
    const sha = await runGit(["rev-parse", "HEAD"], tmpDir);
    return {
      dir: tmpDir,
      sha,
      cleanup: () => rm(tmpDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true });
    throw error;
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function collectFilesRecursively(dir, baseDir = dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursively(fullPath, baseDir)));
    } else if (entry.isFile()) {
      files.push(normalizePosix(path.relative(baseDir, fullPath)));
    }
  }
  return files.sort();
}

async function expandUpstreamClosure(registryDir, seedItems) {
  const items = new Map();
  const pending = [...seedItems];

  while (pending.length > 0) {
    const name = pending.pop();
    if (!name || items.has(name)) continue;
    const itemPath = path.join(registryDir, `${name}.json`);
    if (!existsSync(itemPath)) {
      throw new Error(`Registry item "${name}" not found at ${itemPath}`);
    }
    const raw = await readJson(itemPath);
    const deps = Array.isArray(raw.dependencies) ? [...raw.dependencies].sort() : [];
    const regDeps = Array.isArray(raw.registryDependencies)
      ? raw.registryDependencies.map(normalizeRegistryDepName).sort()
      : [];
    const files = Array.isArray(raw.files) ? raw.files : [];
    const targets = [];
    for (const file of files) {
      const target = normalizePosix(file.target ?? file.path);
      if (typeof file.content !== "string") {
        throw new Error(`Registry item "${name}" file "${target}" has no string content`);
      }
      targets.push({ target, content: file.content });
    }
    items.set(name, {
      dependencies: deps,
      registryDependencies: regDeps,
      files: targets,
    });
    for (const dep of regDeps) {
      if (!items.has(dep)) pending.push(dep);
    }
  }
  return items;
}

function buildPackageJson(rootTargets) {
  const exportsMap = {
    "./package.json": "./package.json",
  };
  for (const relPath of [...rootTargets].sort()) {
    if (
      relPath.startsWith("components/ui/") &&
      !relPath.startsWith("components/ui/hooks/") &&
      /\.(?:tsx?|css)$/u.test(relPath)
    ) {
      const exportName = `./${relPath.slice("components/ui/".length).replace(/\.(?:tsx?|ts)$/u, "")}`;
      exportsMap[exportName] = {
        source: `./src/${relPath}`,
        types: `./src/${relPath}`,
        default: `./src/${relPath}`,
      };
    }
  }
  return `${JSON.stringify(
    {
      name: "@euanguo/bb-ui",
      version: "0.0.1",
      private: true,
      type: "module",
      license: "MIT",
      description:
        "Canonical mirror of get-bb/bb shared UI primitives synced from packages/plugin-registry/r.",
      bb: {
        pluginTailwindContent: ["src/**/*.{ts,tsx}"],
      },
      exports: exportsMap,
    },
    null,
    2,
  )}\n`;
}

async function syncFromUpstream(config, options) {
  let sourceDir;
  let commitSha;
  let cleanup = async () => {};

  if (options.bbDir) {
    sourceDir = path.resolve(REPO_ROOT, options.bbDir);
    commitSha = await runGit(["rev-parse", "HEAD"], sourceDir).catch(() => "local");
  } else {
    const cloned = await cloneUpstreamRegistry(
      config.upstreamRepo,
      config.registryPath,
      options.ref,
    );
    sourceDir = cloned.dir;
    commitSha = cloned.sha;
    cleanup = cloned.cleanup;
  }

  try {
    const registryDir = path.join(sourceDir, config.registryPath);
    const itemsMap = await expandUpstreamClosure(registryDir, config.items);

    const fileMap = new Map();
    const manifestItems = {};
    for (const name of [...itemsMap.keys()].sort()) {
      const item = itemsMap.get(name);
      const manifestFiles = [];
      for (const { target, content } of item.files) {
        const existing = fileMap.get(target);
        if (existing !== undefined && existing !== content) {
          throw new Error(`Conflicting upstream file content for target "${target}"`);
        }
        fileMap.set(target, content);
        manifestFiles.push({
          target,
          sha256: sha256(content),
        });
      }
      manifestItems[name] = {
        dependencies: item.dependencies,
        registryDependencies: item.registryDependencies,
        files: manifestFiles.sort((a, b) => a.target.localeCompare(b.target)),
      };
    }

    // Rewrite packages/bb-ui/src cleanly so stale upstream files vanish.
    await rm(BB_UI_SRC_DIR, { recursive: true, force: true });
    for (const [target, content] of [...fileMap.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const dest = path.join(BB_UI_SRC_DIR, target);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, content, "utf8");
    }

    const manifest = {
      upstreamRepo: config.upstreamRepo,
      upstreamCommit: commitSha,
      registryPath: config.registryPath,
      items: manifestItems,
    };
    await writeFile(
      BB_UI_MANIFEST_PATH,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      BB_UI_PACKAGE_JSON_PATH,
      buildPackageJson(fileMap.keys()),
      "utf8",
    );

    console.log(
      `[bb-ui] Synced ${itemsMap.size} registry items (${fileMap.size} files) from ${commitSha.slice(0, 12)}`,
    );
    return manifest;
  } finally {
    await cleanup();
  }
}

async function discoverPluginConfigs() {
  if (!existsSync(PLUGINS_DIR)) return [];
  const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const configPath = path.join(PLUGINS_DIR, entry.name, "bb-ui.json");
    if (!existsSync(configPath)) continue;
    const raw = await readJson(configPath);
    if (!Array.isArray(raw.items)) {
      throw new Error(`${configPath}: "items" must be an array`);
    }
    const outDirRel = normalizePosix(raw.outDir ?? "bb-ui");
    found.push({
      pluginName: entry.name,
      pluginDir: path.join(PLUGINS_DIR, entry.name),
      outDir: path.join(PLUGINS_DIR, entry.name, outDirRel),
      outDirRel,
      items: raw.items,
    });
  }
  return found.sort((a, b) => a.pluginName.localeCompare(b.pluginName));
}

function expandManifestClosure(manifest, seedItems, contextLabel) {
  const closure = new Set();
  const pending = [...seedItems];
  while (pending.length > 0) {
    const name = pending.pop();
    if (!name || closure.has(name)) continue;
    const entry = manifest.items[name];
    if (!entry) {
      throw new Error(
        `${contextLabel}: unknown registry item "${name}". Re-run "node scripts/sync-bb-ui.mjs" after adding it to packages/bb-ui/config.json.`,
      );
    }
    closure.add(name);
    for (const dep of entry.registryDependencies ?? []) {
      if (!closure.has(dep)) pending.push(dep);
    }
  }

  const targets = new Set();
  const deps = new Set();
  for (const name of [...closure].sort()) {
    const entry = manifest.items[name];
    for (const file of entry.files ?? []) targets.add(file.target);
    for (const dep of entry.dependencies ?? []) deps.add(dep);
  }
  return {
    items: [...closure].sort(),
    targets: [...targets].sort(),
    dependencies: [...deps].sort(),
  };
}

async function checkRootMatchesManifest(manifest) {
  const errors = [];
  const expectedFiles = new Map();
  for (const item of Object.values(manifest.items)) {
    for (const file of item.files ?? []) {
      expectedFiles.set(file.target, file.sha256);
    }
  }
  const actualFiles = await collectFilesRecursively(BB_UI_SRC_DIR);
  const actualSet = new Set(actualFiles);

  for (const [target, expectedHash] of expectedFiles) {
    const absPath = path.join(BB_UI_SRC_DIR, target);
    if (!actualSet.has(target) || !existsSync(absPath)) {
      errors.push(`packages/bb-ui/src/${target}: missing`);
      continue;
    }
    const content = await readFile(absPath, "utf8");
    if (sha256(content) !== expectedHash) {
      errors.push(`packages/bb-ui/src/${target}: modified relative to manifest.json`);
    }
  }
  for (const actual of actualFiles) {
    if (!expectedFiles.has(actual)) {
      errors.push(`packages/bb-ui/src/${actual}: unexpected extra file`);
    }
  }
  return errors;
}

async function mirrorOrCheckPlugin(manifest, pluginCfg, { checkOnly }) {
  const closure = expandManifestClosure(
    manifest,
    pluginCfg.items,
    `plugins/${pluginCfg.pluginName}/bb-ui.json`,
  );

  if (checkOnly) {
    const errors = [];
    const expectedSet = new Set(closure.targets);
    const actualFiles = await collectFilesRecursively(pluginCfg.outDir);
    const actualSet = new Set(actualFiles);

    for (const target of closure.targets) {
      const srcPath = path.join(BB_UI_SRC_DIR, target);
      const dstPath = path.join(pluginCfg.outDir, target);
      if (!actualSet.has(target) || !existsSync(dstPath)) {
        errors.push(`plugins/${pluginCfg.pluginName}/${pluginCfg.outDirRel}/${target}: missing`);
        continue;
      }
      const [srcBuf, dstBuf] = await Promise.all([
        readFile(srcPath),
        readFile(dstPath),
      ]);
      if (!srcBuf.equals(dstBuf)) {
        errors.push(
          `plugins/${pluginCfg.pluginName}/${pluginCfg.outDirRel}/${target}: differs from packages/bb-ui/src/${target}`,
        );
      }
    }
    for (const actual of actualFiles) {
      if (!expectedSet.has(actual)) {
        errors.push(
          `plugins/${pluginCfg.pluginName}/${pluginCfg.outDirRel}/${actual}: unexpected extra file`,
        );
      }
    }
    return { errors, closure };
  }

  await rm(pluginCfg.outDir, { recursive: true, force: true });
  for (const target of closure.targets) {
    const srcPath = path.join(BB_UI_SRC_DIR, target);
    const dstPath = path.join(pluginCfg.outDir, target);
    await mkdir(path.dirname(dstPath), { recursive: true });
    await writeFile(dstPath, await readFile(srcPath));
  }
  console.log(
    `[bb-ui] Mirrored ${closure.targets.length} files (${closure.items.length} items) -> plugins/${pluginCfg.pluginName}/${pluginCfg.outDirRel}/`,
  );
  console.log(
    `[bb-ui] External npm packages in closure: ${closure.dependencies.join(", ") || "(none)"}`,
  );
  return { errors: [], closure };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await readJson(BB_UI_CONFIG_PATH);

  let manifest;
  if (args.check) {
    if (!existsSync(BB_UI_MANIFEST_PATH)) {
      throw new Error("packages/bb-ui/manifest.json does not exist; run sync first");
    }
    manifest = await readJson(BB_UI_MANIFEST_PATH);
    const rootErrors = await checkRootMatchesManifest(manifest);
    const pluginConfigs = await discoverPluginConfigs();
    const pluginErrors = [];
    for (const pluginCfg of pluginConfigs) {
      const { errors } = await mirrorOrCheckPlugin(manifest, pluginCfg, {
        checkOnly: true,
      });
      pluginErrors.push(...errors);
    }
    const allErrors = [...rootErrors, ...pluginErrors];
    if (allErrors.length > 0) {
      console.error("[bb-ui] Drift detected:");
      for (const err of allErrors) console.error(`  - ${err}`);
      process.exit(1);
    }
    console.log(
      `[bb-ui] Passed (${Object.keys(manifest.items).length} root items, ${pluginConfigs.length} plugin mirror(s) verified, 0 drift).`,
    );
    return;
  }

  if (args.syncPlugins) {
    if (!existsSync(BB_UI_MANIFEST_PATH)) {
      throw new Error("packages/bb-ui/manifest.json missing; run without --sync-plugins first");
    }
    manifest = await readJson(BB_UI_MANIFEST_PATH);
  } else {
    manifest = await syncFromUpstream(config, args);
  }

  const pluginConfigs = await discoverPluginConfigs();
  for (const pluginCfg of pluginConfigs) {
    await mirrorOrCheckPlugin(manifest, pluginCfg, { checkOnly: false });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
