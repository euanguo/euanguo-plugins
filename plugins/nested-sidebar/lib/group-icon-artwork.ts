/**
 * The group picker's artwork file: read it once, hand back the icons asked for.
 *
 * `assets/group-icons.txt` is JSON, and `scripts/generate-group-icons.mjs`
 * writes it from the same name list the picker offers. It is imported as text
 * rather than as a module object on purpose — see that script for why — so the
 * parse is explicit and deferred to the first request instead of happening
 * while the plugin loads.
 *
 * Nothing here trusts the file. It is generated, but a truncated write, a stale
 * file from an older generator, or a hand edit would otherwise reach the RPC
 * boundary as a shape failure that names the wrong thing.
 */
import type { GroupIconArtwork } from "./group-icons.ts";

function isArtwork(value: unknown): value is GroupIconArtwork {
  if (!Array.isArray(value)) return false;
  return value.every(
    (element) =>
      Array.isArray(element) &&
      element.length === 2 &&
      typeof element[0] === "string" &&
      typeof element[1] === "object" &&
      element[1] !== null &&
      Object.values(element[1] as Record<string, unknown>).every(
        (attribute) =>
          typeof attribute === "string" || typeof attribute === "number",
      ),
  );
}

/**
 * Index the artwork file by icon name.
 *
 * Throws when the text is not the file this build wrote. The caller turns that
 * into a failed request rather than into an empty picker with no explanation.
 */
export function parseGroupIconArtwork(
  text: string,
): ReadonlyMap<string, GroupIconArtwork> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("group icon artwork is not JSON", { cause: error });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { icons?: unknown }).icons !== "object" ||
    (parsed as { icons?: unknown }).icons === null
  ) {
    throw new Error("group icon artwork has no icon map");
  }
  const icons = new Map<string, GroupIconArtwork>();
  for (const [name, artwork] of Object.entries(
    (parsed as { icons: Record<string, unknown> }).icons,
  )) {
    if (!isArtwork(artwork)) {
      throw new Error(`group icon artwork is malformed for ${name}`);
    }
    icons.set(name, artwork);
  }
  return icons;
}

/**
 * The artwork for the named icons, with `null` for every name the file does not
 * carry. A name the picker offers is always present; a name that is not is a
 * row written by a build whose library was different, and the row keeps its
 * place with nothing drawn in it.
 */
export function selectGroupIconArtwork(
  icons: ReadonlyMap<string, GroupIconArtwork>,
  names: readonly string[],
): Record<string, GroupIconArtwork | null> {
  const artwork: Record<string, GroupIconArtwork | null> = {};
  for (const name of names) artwork[name] = icons.get(name) ?? null;
  return artwork;
}
