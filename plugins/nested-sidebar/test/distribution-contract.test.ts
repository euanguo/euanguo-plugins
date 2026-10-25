import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const REQUIRED_RUNTIME_DEPENDENCIES = {
  "@formkit/auto-animate": "^0.9.0",
  "@hugeicons/core-free-icons": "^4.1.3",
  "@hugeicons/react": "^1.1.6",
  zod: "^4.3.6",
} as const;

const BB_SHIMMED_DEPENDENCIES = {
  "@radix-ui/react-context-menu": "^2.3.3",
  "@radix-ui/react-dropdown-menu": "^2.1.20",
  "@radix-ui/react-hover-card": "^1.1.19",
  "@radix-ui/react-select": "^2.3.3",
  clsx: "^2.1.1",
  "tailwind-merge": "^3.4.0",
} as const;

interface PackageRecord {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readJson<T>(url: URL): Promise<T> {
  return JSON.parse(await readFile(url, "utf8")) as T;
}

/**
 * Nest is a standalone fork, not a workspace member, so its manifest and
 * lockfile root describe the same package. Dependencies that bb does not shim
 * remain production dependencies; shared UI/runtime packages provided by the
 * host remain development declarations and are not bundled twice.
 */
test("declares unshimmed runtime imports as production dependencies", async () => {
  const manifest = await readJson<PackageRecord>(
    new URL("../package.json", import.meta.url),
  );
  const lockfile = await readJson<{ packages: Record<string, PackageRecord> }>(
    new URL("../package-lock.json", import.meta.url),
  );
  const lockedRoot = lockfile.packages[""];
  assert.ok(lockedRoot, "package-lock.json must include the root package");

  assert.equal(manifest.name, "bb-plugin-nested-sidebar");
  assert.equal(lockedRoot.name, manifest.name);
  assert.equal(lockedRoot.version, manifest.version);

  for (const [packageName, expectedRange] of Object.entries(
    REQUIRED_RUNTIME_DEPENDENCIES,
  )) {
    assert.equal(manifest.dependencies?.[packageName], expectedRange);
    assert.equal(lockedRoot.dependencies?.[packageName], expectedRange);
    assert.equal(manifest.devDependencies?.[packageName], undefined);
    assert.equal(lockedRoot.devDependencies?.[packageName], undefined);
  }

  for (const [packageName, expectedRange] of Object.entries(
    BB_SHIMMED_DEPENDENCIES,
  )) {
    assert.equal(manifest.devDependencies?.[packageName], expectedRange);
    assert.equal(lockedRoot.devDependencies?.[packageName], expectedRange);
    assert.equal(manifest.dependencies?.[packageName], undefined);
    assert.equal(lockedRoot.dependencies?.[packageName], undefined);
  }
});
