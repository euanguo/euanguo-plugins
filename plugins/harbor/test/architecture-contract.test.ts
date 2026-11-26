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

interface ModuleImport {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

async function moduleSpecifiers(relativePath: string): Promise<ModuleImport[]> {
  const file = path.join(root, relativePath);
  const source = await readFile(file, "utf8");
  const pattern =
    /\b(import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s*)?["']([^"']+)["']/g;
  return [...source.matchAll(pattern)]
    .map((match) => ({
      specifier: match[3] ?? "",
      typeOnly: match[2]?.trim() === "type",
    }))
    .filter((moduleImport) => moduleImport.specifier.length > 0);
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

const isReactRuntime = (specifier: string): boolean =>
  specifier === "react" ||
  specifier.startsWith("react/") ||
  specifier === "react-dom" ||
  specifier.startsWith("react-dom/");

const isAppSdkRuntime = (specifier: string): boolean =>
  specifier === "@get-bb/plugin-sdk/app" ||
  specifier.startsWith("@get-bb/plugin-sdk/app/");

describe("architecture boundaries", () => {
  it("keeps frontend code off the server entry point", async () => {
    const files = [
      ...(await sourceFiles("components")),
      ...(await sourceFiles("hooks")),
      ...(await sourceFiles("app")),
      "app.tsx",
    ];
    for (const file of files) {
      for (const { specifier } of await moduleSpecifiers(file)) {
        if (!specifier.startsWith("@/server")) continue;
        assert.equal(
          specifier,
          "@/server/contract",
          `${file} may import only the RPC contract`,
        );
      }
    }
  });

  it("keeps domain free of UI, stores, persistence, and app runtime", async () => {
    for (const file of await sourceFiles("lib/domain")) {
      for (const { specifier, typeOnly } of await moduleSpecifiers(file)) {
        assert.equal(
          (isReactRuntime(specifier) || isAppSdkRuntime(specifier)) &&
            !typeOnly,
          false,
          `${file} must not value-import app runtime ${specifier}`,
        );
        assert.equal(
          specifier === "better-sqlite3" ||
            specifier.startsWith("better-sqlite3/"),
          false,
          `${file} must not import ${specifier}`,
        );
        const target = resolvedLocalTarget(file, specifier);
        if (target === null) continue;
        const forbidden = [
          "lib/ui/",
          "lib/stores/",
          "lib/persistence/",
          "components/",
          "hooks/",
        ];
        assert.equal(
          forbidden.some((prefix) => target.startsWith(prefix)),
          false,
          `${file} must not import ${target}`,
        );
      }
    }
  });

  it("keeps ui on domain, persistence, and sibling ui modules", async () => {
    for (const file of await sourceFiles("lib/ui")) {
      for (const { specifier } of await moduleSpecifiers(file)) {
        const target = resolvedLocalTarget(file, specifier);
        if (target === null) continue;
        const allowed =
          target.startsWith("lib/domain/") ||
          target.startsWith("lib/persistence/") ||
          target.startsWith("lib/schemas/") ||
          target.startsWith("lib/ui/");
        assert.equal(
          allowed,
          true,
          `${file} may import only domain, persistence, schemas, or sibling ui, got ${target}`,
        );
      }
    }
  });

  it("keeps schemas free of app runtime, stores, persistence, server, host, and UI", async () => {
    for (const file of await sourceFiles("lib/schemas")) {
      for (const { specifier } of await moduleSpecifiers(file)) {
        assert.equal(
          isReactRuntime(specifier) ||
            isAppSdkRuntime(specifier) ||
            specifier === "better-sqlite3" ||
            specifier.startsWith("better-sqlite3/"),
          false,
          `${file} must not import ${specifier}`,
        );
        const target = resolvedLocalTarget(file, specifier);
        if (target === null) continue;
        assert.equal(
          target.startsWith("lib/schemas/") || target.startsWith("lib/domain/"),
          true,
          `${file} may import only schemas or domain leaves, got ${target}`,
        );
      }
    }
  });

  it("keeps ui free of stores and server code", async () => {
    for (const file of await sourceFiles("lib/ui")) {
      for (const { specifier } of await moduleSpecifiers(file)) {
        const target = resolvedLocalTarget(file, specifier);
        if (target === null) continue;
        assert.equal(
          target.startsWith("lib/stores/") || target.startsWith("server/"),
          false,
          `${file} must not import ${target}`,
        );
      }
    }
  });

  it("keeps store and persistence layers free of app runtime", async () => {
    const files = [
      ...(await sourceFiles("lib/stores")),
      ...(await sourceFiles("lib/persistence")),
    ];
    for (const file of files) {
      for (const { specifier } of await moduleSpecifiers(file)) {
        assert.equal(
          isReactRuntime(specifier) || isAppSdkRuntime(specifier),
          false,
          `${file} must not import ${specifier}`,
        );
      }
    }
  });

  it("keeps stores within stores and domain", async () => {
    for (const file of await sourceFiles("lib/stores")) {
      for (const { specifier } of await moduleSpecifiers(file)) {
        const target = resolvedLocalTarget(file, specifier);
        if (target === null) continue;
        assert.equal(
          target.startsWith("lib/domain/") ||
            target.startsWith("lib/schemas/") ||
            target.startsWith("lib/stores/"),
          true,
          `${file} may import only domain, schemas, or sibling stores, got ${target}`,
        );
      }
    }
  });

  it("keeps server and host off ui and browser persistence", async () => {
    const files = [
      "server.ts",
      "host.ts",
      ...(await sourceFiles("server")),
      ...(await sourceFiles("host")),
    ];
    for (const file of files) {
      for (const { specifier } of await moduleSpecifiers(file)) {
        assert.equal(
          isReactRuntime(specifier) || isAppSdkRuntime(specifier),
          false,
          `${file} must not import app runtime ${specifier}`,
        );
        const target = resolvedLocalTarget(file, specifier);
        if (target === null) continue;
        if (target.startsWith("lib/")) {
          assert.equal(
            target.startsWith("lib/domain/") ||
              target.startsWith("lib/schemas/") ||
              target.startsWith("lib/stores/") ||
              target.startsWith("lib/agent/") ||
              target === "lib/realtime-channels.ts" ||
              target === "lib/realtime-channels",
            true,
            `${file} may import only domain, schemas, stores, agent, or realtime channels, got ${target}`,
          );
        }
        const forbidden = [
          "lib/persistence/",
          "lib/ui/",
          "components/",
          "hooks/",
          "app/",
        ];
        assert.equal(
          forbidden.some((prefix) => target.startsWith(prefix)),
          false,
          `${file} must not import UI module ${target}`,
        );
      }
    }
  });

  it("keeps frontend lib imports on domain, ui, persistence, and channels", async () => {
    const files = [
      ...(await sourceFiles("components")),
      ...(await sourceFiles("hooks")),
      ...(await sourceFiles("app")),
      "app.tsx",
    ];
    for (const file of files) {
      for (const { specifier } of await moduleSpecifiers(file)) {
        const target = resolvedLocalTarget(file, specifier);
        if (target === null || !target.startsWith("lib/")) continue;
        assert.equal(
          target.startsWith("lib/domain/") ||
            target.startsWith("lib/schemas/") ||
            target.startsWith("lib/ui/") ||
            target.startsWith("lib/persistence/") ||
            target === "lib/realtime-channels.ts" ||
            target === "lib/realtime-channels",
          true,
          `${file} may import only domain, schemas, ui, persistence, or realtime channels, got ${target}`,
        );
      }
    }
  });
});
