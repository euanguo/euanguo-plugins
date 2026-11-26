import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const REQUIRED_RUNTIME_DEPENDENCIES = {
  "@formkit/auto-animate": "^0.9.0",
  zod: "^4.3.6",
} as const;

/**
 * Shipped by the registry, and no longer by an icon package.
 *
 * This plugin vendored a 6,000-icon Hugeicons set to draw twenty-one glyphs.
 * The registry's `icon` is a thin wrapper over the host's `experimental_Icon`,
 * so the glyphs come from bb at runtime — nothing to bundle, and a missing name
 * falls back instead of failing to load.
 */
const FORBIDDEN_ICON_DEPENDENCIES = [
  "@hugeicons/core-free-icons",
  "@hugeicons/react",
] as const;

const BB_SHIMMED_DEPENDENCIES = {
  "@radix-ui/react-context-menu": "^2.4.1",
  "@radix-ui/react-dialog": "^1.3.1",
  "@radix-ui/react-dropdown-menu": "^2.2.1",
  "@radix-ui/react-hover-card": "^1.2.1",
  "@radix-ui/react-popover": "^1.3.1",
  "@radix-ui/react-select": "^2.4.1",
  "@radix-ui/react-tooltip": "^1.4.1",
  "class-variance-authority": "^0.7.1",
  clsx: "^2.1.1",
  "tailwind-merge": "^3.7.0",
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
 * Harbor is a standalone plugin, not a workspace member, so its manifest and
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

  assert.equal(manifest.name, "bb-plugin-harbor");
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

  for (const packageName of FORBIDDEN_ICON_DEPENDENCIES) {
    assert.equal(manifest.dependencies?.[packageName], undefined);
    assert.equal(manifest.devDependencies?.[packageName], undefined);
    assert.equal(lockedRoot.dependencies?.[packageName], undefined);
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
