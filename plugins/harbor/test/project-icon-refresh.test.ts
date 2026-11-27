/**
 * Project icon cache invalidation.
 *
 * The bug these guard against: a cached icon was believed forever (only misses
 * had a TTL), so replacing `assets/icon.png` never showed up; and a large PNG
 * was silently skipped by the detector. Cached hits now carry the source file's
 * mtime and are re-probed when it changes, with an explicit size diagnostic.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import Database from "better-sqlite3";
import { describe, it } from "node:test";

import { probeProjectIcon } from "../host/project-icon.ts";
import { MAX_PROJECT_ICON_BYTES } from "../lib/domain/project-icons.ts";
import {
  PROJECT_ICON_MIGRATION,
  PROJECT_ICON_MTIME_MIGRATION,
  createProjectIconStore,
} from "../lib/stores/project-icon-store.ts";
import { projectIconHandlers } from "../server/rpc/settings.ts";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);
const dataUrl = (fill = ""): string =>
  `data:image/png;base64,${PNG_BYTES.toString("base64")}${fill}`;
const OLD_ICON = dataUrl();
const NEW_ICON = dataUrl("AA==");

type HostInput = {
  path: string;
  knownLabel?: string | null;
  knownMtimeMs?: number | null;
};
type HostResult =
  | {
      status: "found";
      src: string;
      label: string;
      source: "file";
      mtimeMs: number | null;
    }
  | { status: "unchanged" }
  | { status: "none" }
  | { status: "too-large"; label: string; size: number }
  | { status: "failed"; message: string };

describe("probeProjectIcon mtime invalidation", () => {
  it("answers unchanged for the same file and re-reads it after the mtime changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "harbor-icon-probe-"));
    try {
      await mkdir(join(root, "assets"), { recursive: true });
      const file = join(root, "assets", "icon.png");
      await writeFile(file, PNG_BYTES);

      const first = await probeProjectIcon({ path: root });
      assert.equal(first.status, "found");
      if (first.status !== "found") return;
      assert.equal(first.icon.label, "assets/icon.png");
      assert.equal(typeof first.mtimeMs, "number");

      const same = await probeProjectIcon({
        path: root,
        knownLabel: first.icon.label,
        knownMtimeMs: first.mtimeMs,
      });
      assert.equal(same.status, "unchanged");

      const later = new Date(Date.now() + 5_000);
      await utimes(file, later, later);
      const changed = await probeProjectIcon({
        path: root,
        knownLabel: first.icon.label,
        knownMtimeMs: first.mtimeMs,
      });
      assert.equal(changed.status, "found");
      if (changed.status === "found") {
        assert.notEqual(changed.mtimeMs, first.mtimeMs);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a file above the cap instead of silently treating it as a miss", async () => {
    const root = await mkdtemp(join(tmpdir(), "harbor-icon-large-"));
    try {
      await mkdir(join(root, "assets"), { recursive: true });
      const file = join(root, "assets", "icon.png");
      await writeFile(
        file,
        Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_PROJECT_ICON_BYTES + 1)]),
      );
      const result = await probeProjectIcon({
        path: root,
        knownLabel: "assets/icon.png",
        knownMtimeMs: 1,
      });
      assert.equal(result.status, "too-large");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function makeHarness(
  host: (input: HostInput) => HostResult,
): {
  dispose: () => void;
  handlers: ReturnType<typeof projectIconHandlers>;
  inputs: HostInput[];
  published: string[];
  store: ReturnType<typeof createProjectIconStore>;
} {
  const db = new Database(":memory:");
  db.exec(PROJECT_ICON_MIGRATION);
  db.exec(PROJECT_ICON_MTIME_MIGRATION);
  const store = createProjectIconStore(db);
  const inputs: HostInput[] = [];
  const published: string[] = [];
  const deps = {
    bb: {
      realtime: {
        publish: (_channel: string, payload: { projectId: string }) => {
          published.push(payload.projectId);
        },
      },
      sdk: {
        projects: {
          list: async () => [{ id: "proj_a" }, { id: "proj_b" }],
        },
      },
    } as unknown as BbPluginApi,
    projectIcons: store,
    worktreeHost: {
      call: async (_method: "detectProjectIcon", input: HostInput) => {
        inputs.push(input);
        return host(input);
      },
    },
    appearance: { get: async () => ({ autoProjectIcons: true }) },
    projectSource: async () => ({ path: "/repos/acme-app", hostId: "host_a" }),
  } as unknown as Parameters<typeof projectIconHandlers>[0];
  return {
    dispose: () => db.close(),
    handlers: projectIconHandlers(deps),
    inputs,
    published,
    store,
  };
}

function seedHit(store: ReturnType<typeof createProjectIconStore>): void {
  store.set({
    projectId: "proj_a",
    icon: { src: OLD_ICON, label: "assets/icon.png", source: "file" },
    sourcePath: "/repos/acme-app",
    sourceHostId: "host_a",
    sourceMtime: 1_000,
  });
}

describe("projectIconHandlers cache invalidation", () => {
  it("keeps cached bytes when the host reports an unchanged mtime", async () => {
    const h = makeHarness(() => ({ status: "unchanged" }));
    try {
      seedHit(h.store);
      const before = h.store.get("proj_a")?.updatedAt;
      const result = await h.handlers.detectProjectIcon({
        projectId: "proj_a",
      });
      assert.equal(result.icon?.src, OLD_ICON);
      assert.equal(h.store.get("proj_a")?.updatedAt, before);
      assert.equal(h.inputs[0]?.knownLabel, "assets/icon.png");
      assert.equal(h.inputs[0]?.knownMtimeMs, 1_000);
      assert.deepEqual(h.published, []);
    } finally {
      h.dispose();
    }
  });

  it("replaces the cached icon and records the new mtime when the file changed", async () => {
    const h = makeHarness(() => ({
      status: "found" as const,
      src: NEW_ICON,
      label: "assets/icon.png",
      source: "file" as const,
      mtimeMs: 2_000,
    }));
    try {
      seedHit(h.store);
      const result = await h.handlers.detectProjectIcon({
        projectId: "proj_a",
      });
      assert.equal(result.icon?.src, NEW_ICON);
      assert.equal(h.store.get("proj_a")?.sourceMtime, 2_000);
      assert.deepEqual(h.published, ["proj_a"]);
    } finally {
      h.dispose();
    }
  });

  it("refreshProjectIcons forces a full probe for every project", async () => {
    const h = makeHarness(() => ({
      status: "found" as const,
      src: NEW_ICON,
      label: "assets/icon.png",
      source: "file" as const,
      mtimeMs: 4_000,
    }));
    try {
      seedHit(h.store);
      const outcome = await h.handlers.refreshProjectIcons({});
      assert.equal(h.inputs.length, 2);
      for (const input of h.inputs) {
        assert.equal(input.knownLabel, null);
        assert.equal(input.knownMtimeMs, null);
      }
      assert.equal(outcome.refreshed, 2);
      assert.equal(outcome.unchanged, 0);
      assert.equal(h.store.get("proj_b")?.sourceMtime, 4_000);
    } finally {
      h.dispose();
    }
  });

  it("keeps the old icon but returns a size diagnostic for an oversized file", async () => {
    const h = makeHarness(() => ({
      status: "too-large" as const,
      label: "assets/icon.png",
      size: 2 * 1024 * 1024,
    }));
    try {
      seedHit(h.store);
      const result = await h.handlers.detectProjectIcon({
        projectId: "proj_a",
      });
      assert.equal(result.icon?.src, OLD_ICON);
      assert.match(result.diagnostic ?? "", /limit is 1024 KB/u);
      assert.deepEqual(h.published, []);
    } finally {
      h.dispose();
    }
  });

  it("re-probes a row written before mtime tracking existed", async () => {
    const h = makeHarness(() => ({
      status: "found" as const,
      src: NEW_ICON,
      label: "assets/icon.png",
      source: "file" as const,
      mtimeMs: 3_000,
    }));
    try {
      h.store.set({
        projectId: "proj_a",
        icon: { src: OLD_ICON, label: "assets/icon.png", source: "file" },
        sourcePath: "/repos/acme-app",
        sourceHostId: "host_a",
      });
      assert.equal(h.store.get("proj_a")?.sourceMtime, null);
      const result = await h.handlers.detectProjectIcon({
        projectId: "proj_a",
      });
      assert.equal(result.icon?.src, NEW_ICON);
      assert.equal(h.store.get("proj_a")?.sourceMtime, 3_000);
    } finally {
      h.dispose();
    }
  });
});
