/**
 * Find the icon a project's checkout already carries.
 *
 * Ported from Orca's `src/main/repo-icon-file-detection.ts`,
 * `src/main/repo-icon-source-href.ts`, `src/main/repo-icon-href-candidates.ts`
 * and the local half of `src/main/repo-icon-autodetect.ts` at commit
 * ca2ae890115faf66ee97e7335caeac061a350524. See THIRD_PARTY_NOTICES.md.
 *
 * Three Orca layers are deliberately absent, because this plugin has nothing
 * for them to talk to: the SSH filesystem provider and its route dispatch (this
 * module already runs on the machine that owns the path), the `runtime:` host
 * case, and the GitHub avatar fallback (which needs Orca's GitHub client).
 *
 * Nothing here throws. A checkout that cannot be read, a file that lies about
 * its name, a package.json that is not JSON — each is an ordinary miss, and the
 * caller's answer is the same one it gives for "no icon": the letter badge the
 * row drew before this existed.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  MAX_PROJECT_ICON_BYTES,
  type ProjectIcon,
} from "../lib/project-icons.ts";

/**
 * Conventional locations only, and the list stays short: every entry is an
 * extra stat against a checkout the user is waiting on.
 */
const ICON_FILE_STEMS = [
  "favicon",
  "public/favicon",
  "app/favicon",
  "app/icon",
  "src/favicon",
  "src/app/icon",
  "assets/favicon",
  "assets/icon",
  "static/favicon",
  "logo",
  "public/logo",
  // Why: CLI tools and branded assets often use public/icon.*.
  "public/icon",
  // Why: Tauri's default bundle icon path.
  "src-tauri/icons/icon",
  "app-icon",
  "icon",
] as const;

const ICON_FILE_EXTENSIONS = [".png", ".webp"] as const;

/**
 * SSH stats are network round trips; a local one is not, but the expanded
 * candidate list would still make this serial without a bound. Orca's own
 * number.
 */
const ICON_PROBE_CONCURRENCY = 6;

const ICON_FILE_CANDIDATES: readonly string[] = ICON_FILE_STEMS.flatMap((stem) =>
  ICON_FILE_EXTENSIONS.map((extension) => `${stem}${extension}`),
);

const ICON_SOURCE_FILE_CANDIDATES = [
  "index.html",
  "public/index.html",
  "app/routes/__root.tsx",
  "src/routes/__root.tsx",
  "app/root.tsx",
  "src/root.tsx",
  "src/index.html",
] as const;

/**
 * Icon detection runs while the sidebar is filling in; declared-icon probing
 * should not read large app entrypoints just to find a small favicon href.
 */
const MAX_ICON_SOURCE_BYTES = 256 * 1024;

/** A package.json larger than this is not a manifest anyone hand-wrote. */
const MAX_PACKAGE_JSON_BYTES = 128 * 1024;

type ImageFormat = { mimeType: "image/png" | "image/webp" };

function isPngBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function isWebpBuffer(buffer: Buffer): boolean {
  // Why: RIFF container, WEBP fourcc — enough to reject a text file that a
  // build step renamed, without decoding anything. The badge only needs a
  // source an <img> will accept.
  return (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  );
}

function detectImageFormat(buffer: Buffer): ImageFormat | null {
  if (isPngBuffer(buffer)) return { mimeType: "image/png" };
  if (isWebpBuffer(buffer)) return { mimeType: "image/webp" };
  return null;
}

/**
 * The bytes become the icon's whole value here — a `data:` URL, so nothing is
 * written to disk and no route has to serve it. Orca ran the same bytes past a
 * raster-preview size filter as well; the file-size cap it read them under
 * already bounds this, and the badge draws at 20px.
 */
function iconFromImageBuffer(
  buffer: Buffer,
  relativePath: string,
): ProjectIcon | null {
  const format = detectImageFormat(buffer);
  if (format === null) return null;
  return {
    src: `data:${format.mimeType};base64,${buffer.toString("base64")}`,
    label: relativePath,
    source: "file",
  };
}

/** One candidate path, read the same way whoever asked for it. */
async function readImageIcon(
  rootPath: string,
  relativePath: string,
): Promise<ProjectIcon | null> {
  const filePath = path.join(rootPath, ...relativePath.split("/"));
  const info = await stat(filePath);
  if (!info.isFile() || info.size > MAX_PROJECT_ICON_BYTES) return null;
  return iconFromImageBuffer(await readFile(filePath), relativePath);
}

/**
 * Walk the conventional candidates in bounded batches, first hit wins.
 *
 * The batching is not only about the host: it is what keeps the list's order
 * meaningful when several probes are in flight at once — a `favicon.png` in the
 * batch before `public/favicon.png` is preferred even if its read resolves
 * later.
 */
async function detectConventionalIcon(
  rootPath: string,
): Promise<ProjectIcon | null> {
  for (
    let offset = 0;
    offset < ICON_FILE_CANDIDATES.length;
    offset += ICON_PROBE_CONCURRENCY
  ) {
    const batch = ICON_FILE_CANDIDATES.slice(
      offset,
      offset + ICON_PROBE_CONCURRENCY,
    );
    const icons = await Promise.all(
      batch.map(async (relativePath) => {
        try {
          return await readImageIcon(rootPath, relativePath);
        } catch {
          return null;
        }
      }),
    );
    const icon = icons.find(
      (candidate): candidate is ProjectIcon => candidate !== null,
    );
    if (icon !== undefined) return icon;
  }
  return null;
}

const LINK_START_RE = /<link\b/gi;
const LINK_ICON_HTML_RE =
  /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))[^>]*>/iy;
const LINK_ICON_OBJECT_RE =
  /(?=[^}]*\brel\s*:\s*["'](?:icon|shortcut icon)["'])(?=[^}]*\bhref\s*:\s*["']([^"'?]+))[^}]*/iy;

function extractHtmlIconHref(source: string): string | null {
  LINK_START_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_START_RE.exec(source))) {
    LINK_ICON_HTML_RE.lastIndex = match.index;
    const href = LINK_ICON_HTML_RE.exec(source)?.[1];
    if (href !== undefined) return href;
    // Later link starts before the same closing angle see only a subset of
    // these attributes.
    const closingAngle = source.indexOf(">", LINK_START_RE.lastIndex);
    if (closingAngle === -1) return null;
    LINK_START_RE.lastIndex = closingAngle + 1;
  }
  return null;
}

/**
 * The href a document or a route root declares as its icon.
 *
 * Both forms are in the wild: a plain `<link rel="icon" href>` in an HTML
 * entrypoint, and the same object spelled out in a framework's root component.
 */
export function extractIconHref(source: string): string | null {
  const htmlHref = extractHtmlIconHref(source);
  if (htmlHref !== null) return htmlHref;
  let start = 0;
  while (start <= source.length) {
    // Every suffix before the next closing brace sees the same candidate
    // properties.
    LINK_ICON_OBJECT_RE.lastIndex = start;
    const href = LINK_ICON_OBJECT_RE.exec(source)?.[1];
    if (href !== undefined) return href;
    const closingBrace = source.indexOf("}", start);
    if (closingBrace === -1) return null;
    start = closingBrace + 1;
  }
  return null;
}

function normalizeIconHrefPath(
  href: string,
): { path: string; rootRelative: boolean } | null {
  const trimmed = href.trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("//") ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)
  ) {
    return null;
  }
  const rootRelative = trimmed.startsWith("/");
  const pathOnly = (trimmed.split(/[?#]/)[0] ?? "")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
  const parts = pathOnly.split("/").filter((part) => part && part !== ".");
  // Why: a declared href is repo content. A best-effort icon probe must never
  // resolve outside the checkout through `../` segments.
  if (parts.length === 0 || parts.some((part) => part === "..")) return null;
  return { path: parts.join("/"), rootRelative };
}

/**
 * Where a declared href could actually live, in the order worth trying.
 *
 * A root-relative href is served from `public/` by every bundler that serves
 * one, so that comes first; a relative href is resolved next to the file that
 * declared it before either.
 */
export function iconHrefCandidates(
  href: string,
  sourceFile: string,
): readonly string[] {
  const clean = normalizeIconHrefPath(href);
  if (clean === null) return [];
  const candidates = new Set<string>();
  if (!clean.rootRelative) {
    const sourceDirectory = path.posix.dirname(sourceFile);
    if (sourceDirectory && sourceDirectory !== ".") {
      candidates.add(path.posix.join(sourceDirectory, clean.path));
    }
  }
  candidates.add(`public/${clean.path}`);
  candidates.add(clean.path);
  return [...candidates];
}

/**
 * What the checkout's own entrypoints say its icon is, when no conventional
 * file was there to find.
 */
async function detectDeclaredIcon(
  rootPath: string,
): Promise<ProjectIcon | null> {
  for (const sourceFile of ICON_SOURCE_FILE_CANDIDATES) {
    try {
      const sourcePath = path.join(rootPath, ...sourceFile.split("/"));
      const sourceInfo = await stat(sourcePath);
      if (
        !sourceInfo.isFile() ||
        sourceInfo.size > MAX_ICON_SOURCE_BYTES
      ) {
        continue;
      }
      const href = extractIconHref(await readFile(sourcePath, "utf8"));
      if (href === null) continue;
      for (const relativePath of iconHrefCandidates(href, sourceFile)) {
        try {
          const icon = await readImageIcon(rootPath, relativePath);
          if (icon !== null) return icon;
        } catch {
          // Try the next href resolution.
        }
      }
    } catch {
      // Try the next source file.
    }
  }
  return null;
}

/**
 * Hostnames whose favicon is never the project's own icon: a repository hosted
 * on one of these has the forge's mark, not the product's.
 */
const WEBSITE_HOSTS_TO_SKIP = new Set([
  "github.com",
  "www.github.com",
  "gitlab.com",
  "www.gitlab.com",
  "bitbucket.org",
  "www.bitbucket.org",
]);

function faviconUrlFromWebsite(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) return null;
  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`,
    );
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
      return null;
    }
    if (WEBSITE_HOSTS_TO_SKIP.has(url.hostname.toLowerCase())) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`;
  } catch {
    return null;
  }
}

/**
 * The last resort: a package that names its own website gets that site's
 * favicon, fetched by the browser that draws it. This is the only branch that
 * leaves the machine, which is why the row falls back to its letter badge if
 * the image never arrives.
 */
async function detectPackageHomepageIcon(
  rootPath: string,
): Promise<ProjectIcon | null> {
  try {
    const packageJsonPath = path.join(rootPath, "package.json");
    const info = await stat(packageJsonPath);
    if (!info.isFile() || info.size > MAX_PACKAGE_JSON_BYTES) return null;
    const parsed: unknown = JSON.parse(await readFile(packageJsonPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const homepage = (parsed as { homepage?: unknown }).homepage;
    if (typeof homepage !== "string") return null;
    const src = faviconUrlFromWebsite(homepage);
    if (src === null) return null;
    return { src, label: "Website favicon", source: "favicon" };
  } catch {
    return null;
  }
}

/**
 * The icon this checkout carries, or null.
 *
 * Order is Orca's: a file the checkout ships beats a website the checkout
 * mentions, because the first is what the project actually looks like and the
 * second needs the network to draw at all.
 */
export async function detectProjectIcon(
  rootPath: string,
): Promise<ProjectIcon | null> {
  try {
    if (rootPath.trim().length === 0) return null;
    return (
      (await detectConventionalIcon(rootPath)) ??
      (await detectDeclaredIcon(rootPath)) ??
      (await detectPackageHomepageIcon(rootPath))
    );
  } catch {
    // Best-effort by contract: a probe that cannot run is a miss, never an
    // error the row has to explain.
    return null;
  }
}
