import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  detectProjectIcon,
  extractIconHref,
  iconHrefCandidates,
} from "../host/project-icon.ts";
import {
  PROJECT_ICON_MIGRATION,
  createProjectIconStore,
} from "../lib/project-icon-store.ts";
import {
  MAX_PROJECT_ICON_DATA_URL_CHARS,
  MAX_PROJECT_ICON_ROWS,
  canonicalProjectIcon,
} from "../lib/project-icons.ts";

/** Both fixtures are the bytes they claim to be; the sniffers read the real ones. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const WEBP_BASE64 =
  "UklGRhoAAABXRUJQVlA4IA4AAAAwAQCdASoBAAEAAQIlSkwAAA==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

const FAVICON_URL =
  "https://www.google.com/s2/favicons?domain=app.example.com&sz=64";

/**
 * Detection is a real filesystem walk, so these run over real directories.
 *
 * Orca's own tests spy on `node:fs/promises` to count concurrent probes. There
 * is no mocking facility in this suite — `node --test` with no test library —
 * so the property that matters is pinned behaviourally instead: within one
 * batch the earlier candidate wins, which is what the batching exists to
 * guarantee.
 */
async function withCheckout(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "nest-project-icon-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function put(
  root: string,
  relativePath: string,
  contents: string | Buffer,
): Promise<void> {
  const target = join(root, ...relativePath.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

describe("detectProjectIcon", () => {
  it("prefers a checked-in favicon over the package's website", async () => {
    await withCheckout(async (root) => {
      await put(root, "favicon.png", Buffer.from(PNG_BASE64, "base64"));
      await put(
        root,
        "package.json",
        JSON.stringify({ homepage: "https://example.com" }),
      );

      assert.deepEqual(await detectProjectIcon(root), {
        src: PNG_DATA_URL,
        label: "favicon.png",
        source: "file",
      });
    });
  });

  it("keeps the candidate list's order when several resolve at once", async () => {
    await withCheckout(async (root) => {
      await put(root, "favicon.png", Buffer.from(PNG_BASE64, "base64"));
      await put(root, "public/favicon.png", Buffer.from(PNG_BASE64, "base64"));

      assert.equal((await detectProjectIcon(root))?.label, "favicon.png");
    });
  });

  it("finds a Tauri bundle icon", async () => {
    await withCheckout(async (root) => {
      await put(root, "src-tauri/icons/icon.png", Buffer.from(PNG_BASE64, "base64"));

      assert.equal(
        (await detectProjectIcon(root))?.label,
        "src-tauri/icons/icon.png",
      );
    });
  });

  it("finds a WebP icon and names it for what it is", async () => {
    await withCheckout(async (root) => {
      await put(root, "public/icon.webp", Buffer.from(WEBP_BASE64, "base64"));

      assert.deepEqual(await detectProjectIcon(root), {
        src: `data:image/webp;base64,${WEBP_BASE64}`,
        label: "public/icon.webp",
        source: "file",
      });
    });
  });

  it("resolves a declared icon href the way a server would", async () => {
    await withCheckout(async (root) => {
      await put(
        root,
        "index.html",
        `<link rel="stylesheet" href="/app.css"><link rel="icon" href="/chosen.png">`,
      );
      await put(root, "public/chosen.png", Buffer.from(PNG_BASE64, "base64"));

      assert.equal((await detectProjectIcon(root))?.label, "public/chosen.png");
    });
  });

  it("resolves an object-form href beside the file that declared it", async () => {
    await withCheckout(async (root) => {
      await put(root, "src/root.tsx", `const head = { rel: "icon", href: "./brand.png" }`);
      await put(root, "src/brand.png", Buffer.from(PNG_BASE64, "base64"));

      assert.equal((await detectProjectIcon(root))?.label, "src/brand.png");
    });
  });

  it("skips a candidate whose bytes are not an image", async () => {
    await withCheckout(async (root) => {
      await put(root, "favicon.png", "<!doctype html>");
      await put(root, "logo.png", Buffer.from(PNG_BASE64, "base64"));

      assert.equal((await detectProjectIcon(root))?.label, "logo.png");
    });
  });

  it("refuses an icon larger than the badge would ever draw", async () => {
    await withCheckout(async (root) => {
      await put(
        root,
        "favicon.png",
        Buffer.concat([Buffer.from(PNG_BASE64, "base64"), Buffer.alloc(300 * 1024)]),
      );

      assert.equal(await detectProjectIcon(root), null);
    });
  });

  it("answers null for a checkout with nothing to find", async () => {
    await withCheckout(async (root) => {
      await put(root, "src/index.ts", "export {};");

      assert.equal(await detectProjectIcon(root), null);
    });
  });

  it("fetches the package's website favicon as a last resort", async () => {
    await withCheckout(async (root) => {
      await put(
        root,
        "package.json",
        JSON.stringify({ homepage: "https://app.example.com/docs" }),
      );

      assert.deepEqual(await detectProjectIcon(root), {
        src: FAVICON_URL,
        label: "Website favicon",
        source: "favicon",
      });
    });
  });

  it("will not take a forge's favicon for a project's own", async () => {
    await withCheckout(async (root) => {
      await put(
        root,
        "package.json",
        JSON.stringify({ homepage: "https://github.com/euanguo/thing" }),
      );

      assert.equal(await detectProjectIcon(root), null);
    });
  });

  it("survives a checkout it cannot read", async () => {
    assert.equal(
      await detectProjectIcon(join(tmpdir(), "nest-project-icon-absent")),
      null,
    );
    assert.equal(await detectProjectIcon("   "), null);
  });
});

describe("extractIconHref", () => {
  it("reads the icon link and not the ones before it", () => {
    assert.equal(
      extractIconHref(
        `<link rel="preload" href="/font.woff2"><link rel="shortcut icon" href="./icon.png?v=3#x">`,
      ),
      "./icon.png",
    );
  });

  it("reads an object declaration whichever order its fields are in", () => {
    assert.equal(
      extractIconHref(`const meta = { href: "/a.png", rel: "icon" }`),
      "/a.png",
    );
  });

  it("finds nothing when no declaration is an icon", () => {
    assert.equal(extractIconHref(`<link rel="manifest" href="/site.webmanifest">`), null);
    assert.equal(extractIconHref("{}"), null);
  });
});

describe("iconHrefCandidates", () => {
  it("puts public/ in front of the root for a root-relative href", () => {
    assert.deepEqual(iconHrefCandidates("/icon.png", "index.html"), [
      "public/icon.png",
      "icon.png",
    ]);
  });

  it("tries the declaring file's own directory first", () => {
    assert.deepEqual(iconHrefCandidates("./brand.png", "src/root.tsx"), [
      "src/brand.png",
      "public/brand.png",
      "brand.png",
    ]);
  });

  it("refuses to resolve outside the checkout", () => {
    for (const href of [
      "../../etc/passwd",
      "https://cdn.example.com/icon.png",
      "//cdn.example.com/icon.png",
      "data:image/png;base64,AAAA",
      "",
    ]) {
      assert.deepEqual(iconHrefCandidates(href, "index.html"), [], href);
    }
  });
});

describe("canonicalProjectIcon", () => {
  it("accepts exactly what this plugin can paint", () => {
    assert.deepEqual(
      canonicalProjectIcon({ src: PNG_DATA_URL, label: "favicon.png", source: "file" }),
      { src: PNG_DATA_URL, label: "favicon.png", source: "file" },
    );
    assert.deepEqual(canonicalProjectIcon({ src: FAVICON_URL, source: "favicon" }), {
      src: FAVICON_URL,
      label: "",
      source: "favicon",
    });
  });

  it("refuses anything else, however it was spelled", () => {
    for (const value of [
      { src: "https://evil.example/icon.png", source: "file" },
      { src: "data:text/html;base64,AAAA", source: "file" },
      { src: "data:image/svg+xml;base64,AAAA", source: "file" },
      { src: "javascript:alert(1)", source: "favicon" },
      { src: "http://www.google.com/s2/favicons?domain=x", source: "favicon" },
      { src: "https://www.google.com/search?q=1", source: "favicon" },
      { src: PNG_DATA_URL, source: "upload" },
      { src: `data:image/png;base64,${"A".repeat(MAX_PROJECT_ICON_DATA_URL_CHARS)}`, source: "file" },
      { src: PNG_DATA_URL },
      null,
      "data:image/png;base64,AAAA",
    ]) {
      assert.equal(canonicalProjectIcon(value), null, JSON.stringify(value)?.slice(0, 60));
    }
  });

  it("drops a label it cannot show rather than the icon", () => {
    assert.equal(
      canonicalProjectIcon({ src: PNG_DATA_URL, label: "bad\u0000name", source: "file" })
        ?.label,
      "",
    );
  });
});

describe("project icon store", () => {
  function createStore() {
    const db = new Database(":memory:");
    db.exec(PROJECT_ICON_MIGRATION);
    return { db, store: createProjectIconStore(db) };
  }

  const hit = {
    projectId: "project-a",
    icon: { src: PNG_DATA_URL, label: "favicon.png", source: "file" as const },
    sourcePath: "/code/alpha",
    sourceHostId: "local",
  };

  it("round-trips a hit and a miss, and knows the difference", () => {
    const { db, store } = createStore();
    try {
      store.set(hit, 1);
      store.set(
        {
          projectId: "project-b",
          icon: null,
          sourcePath: "/code/beta",
          sourceHostId: "local",
        },
        2,
      );

      assert.deepEqual(store.get("project-a"), { ...hit, updatedAt: 1 });
      assert.deepEqual(store.get("project-b"), {
        projectId: "project-b",
        icon: null,
        sourcePath: "/code/beta",
        sourceHostId: "local",
        updatedAt: 2,
      });
      assert.equal(store.get("project-c"), undefined);
    } finally {
      db.close();
    }
  });

  it("replaces a project's answer rather than accumulating them", () => {
    const { db, store } = createStore();
    try {
      store.set(hit, 1);
      store.set(
        {
          projectId: "project-a",
          icon: null,
          sourcePath: "/code/moved",
          sourceHostId: "local",
        },
        2,
      );

      assert.equal(store.list().length, 1);
      assert.equal(store.get("project-a")?.icon, null);
      assert.equal(store.get("project-a")?.sourcePath, "/code/moved");
    } finally {
      db.close();
    }
  });

  it("drops a row this build would not paint", () => {
    const { db, store } = createStore();
    try {
      db.prepare(
        `INSERT INTO project_icons
           (project_id, src, label, source, source_path, source_host_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "project-a",
        "data:text/html;base64,AAAA",
        "x",
        "file",
        "/code/alpha",
        "local",
        1,
      );

      assert.deepEqual(store.list(), []);
      assert.equal(store.get("project-a"), undefined);
    } finally {
      db.close();
    }
  });

  it("rejects what bb would never call a project", () => {
    const { db, store } = createStore();
    try {
      assert.throws(
        () => store.set({ ...hit, projectId: "project\nb" }),
        /Invalid/,
      );
      assert.equal(store.get("project\nb"), undefined);
      assert.equal(store.drop("project\nb"), false);
    } finally {
      db.close();
    }
  });

  it("bounds new rows while allowing updates at the limit", () => {
    const { db, store } = createStore();
    try {
      const insert = db.prepare(
        `INSERT INTO project_icons
           (project_id, src, label, source, source_path, source_host_id, updated_at)
         VALUES (?, NULL, NULL, NULL, '/code', 'local', ?)`,
      );
      db.transaction(() => {
        for (let index = 0; index < MAX_PROJECT_ICON_ROWS; index += 1) {
          insert.run(`project-${index}`, index);
        }
      })();

      assert.equal(store.list().length, MAX_PROJECT_ICON_ROWS);
      assert.throws(
        () =>
          store.set({ ...hit, projectId: "one-too-many" }),
        /limit reached/,
      );
      assert.equal(store.set({ ...hit, projectId: "project-1" }, 2).updatedAt, 2);
      assert.equal(store.drop("project-1"), true);
    } finally {
      db.close();
    }
  });
});
