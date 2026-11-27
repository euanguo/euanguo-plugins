/**
 * What a project icon is, and what may be believed about one.
 *
 * The detector that produces these runs on the host (see `host/project-icon.ts`)
 * because it reads the project's checkout. Everything downstream — the store, the
 * RPC, the badge — only ever sees a decoded `data:` URL or the favicon service's
 * URL, so the vocabulary and the guard live here where all three can share them.
 *
 * Ported from Orca (`src/shared/repo-icon.ts` and `src/shared/image-data-uri.ts`
 * at commit ca2ae890115faf66ee97e7335caeac061a350524); see THIRD_PARTY_NOTICES.md.
 */

import {
  MAX_PROJECT_ICON_LABEL_LENGTH,
  MAX_PROJECT_ICON_ROWS,
  PROJECT_ICON_SOURCES,
  type ProjectIcon,
  type ProjectIconSource,
} from "../schemas/sidebar.ts";

export {
  MAX_PROJECT_ICON_LABEL_LENGTH,
  MAX_PROJECT_ICON_ROWS,
  PROJECT_ICON_SOURCES,
  type ProjectIcon,
  type ProjectIconSource,
};

/**
 * A 1024px RGBA PNG exported by a design tool is commonly ~800 KB, and the
 * badge draws it at 20px. Rejecting those silently left a stale cached icon on
 * screen, so the read cap is generous; the data-URL cap below bounds storage.
 */
export const MAX_PROJECT_ICON_BYTES = 1024 * 1024;

/** Comfortably above what 1 MB base64s to (~1.4 MB). */
export const MAX_PROJECT_ICON_DATA_URL_CHARS = 2 * 1024 * 1024;

export interface StoredProjectIcon extends ProjectIcon {
  projectId: string;
}

const DATA_URL = /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/=]+$/i;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

function isProjectIconSource(value: string): value is ProjectIconSource {
  return (PROJECT_ICON_SOURCES as readonly string[]).includes(value);
}

/**
 * The one place an icon's `src` is judged.
 *
 * Both branches are closed sets rather than "looks like a URL": the plugin wrote
 * this value itself, one host round trip ago, and every consumer of it either
 * paints it into an `<img>` or ships it to another process. A stored `file` icon
 * is base64 the detector sniffed the magic bytes of, and a `favicon` icon is one
 * exact service path — nothing else may be rendered.
 */
function supportedProjectIconSrc(
  src: string,
  source: ProjectIconSource,
): boolean {
  if (src.length === 0 || src.length > MAX_PROJECT_ICON_DATA_URL_CHARS) {
    return false;
  }
  if (source === "file") return DATA_URL.test(src);
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    url.hostname === "www.google.com" &&
    url.pathname === "/s2/favicons"
  );
}

/** The icon a row may hold, or null for anything this build cannot paint. */
export function canonicalProjectIcon(value: unknown): ProjectIcon | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const src = typeof candidate.src === "string" ? candidate.src.trim() : "";
  const source =
    typeof candidate.source === "string" ? candidate.source : "";
  if (!isProjectIconSource(source) || !supportedProjectIconSrc(src, source)) {
    return null;
  }
  const rawLabel =
    typeof candidate.label === "string" ? candidate.label.trim() : "";
  const label = CONTROL_CHARACTER.test(rawLabel)
    ? ""
    : rawLabel.slice(0, MAX_PROJECT_ICON_LABEL_LENGTH);
  return { src, label, source };
}
