/**
 * A group's icon: one emoji.
 *
 * This used to be a name in the free Hugeicons set — 6,025 of them — with the
 * artwork shipped as a 6.9 MB file the backend served on demand, a batching
 * loader in the frontend, a name list in the bundle for the picker to search,
 * and a per-icon round trip to draw a row. All of that existed so a group could
 * show a picture, and a group is one row in a sidebar.
 *
 * An emoji is the same picture with none of it: no artwork, no RPC, no loader,
 * no bundle cost, and it renders at the row's own font size. The trade is that
 * the set is the emoji a keyboard can type rather than a curated 6,025 — which
 * is the right trade for a label, and one a user can already make without a
 * picker at all.
 *
 * Stored values are still validated, because they arrive from a database this
 * build may not have written and from a browser-local snapshot anyone can edit.
 * A name is accepted only if it is a short run of non-ASCII glyphs: ASCII would
 * let a stored value smuggle in markup-looking text, and an unbounded length
 * would let it push a row's layout around.
 */

export type GroupIconName = string;

export const DEFAULT_GROUP_ICON: GroupIconName = "📁";

/**
 * What a group showed before icons were configurable, mapped onto the emoji
 * that means the same thing.
 *
 * Rows written by any earlier build hold a Hugeicons name, and they have to
 * keep meaning something after the upgrade rather than all collapsing onto the
 * default. This is the one-way door: a name not in here and not a valid emoji
 * becomes the default.
 */
const LEGACY_GROUP_ICON_ALIASES: ReadonlyMap<string, GroupIconName> = new Map([
  ["Layer", "📁"],
  ["LayerIcon", "📁"],
  ["FolderTree", "🌳"],
  ["FolderTreeIcon", "🌳"],
  ["GitBranch", "🌿"],
  ["GitBranchIcon", "🌿"],
  ["Target", "🎯"],
  ["Target02Icon", "🎯"],
  ["ListTodo", "📋"],
  ["ListTodoIcon", "📋"],
  ["Pin", "📌"],
  ["PinIcon", "📌"],
  ["AccountSetting01Icon", "⚙️"],
  ["AddMoneyCircleIcon", "💰"],
  ["AiIdeaIcon", "💡"],
  ["EyeIcon", "👁️"],
  ["Archive02Icon", "🗄️"],
  ["Briefcase01Icon", "💼"],
  ["Home01Icon", "🏠"],
  ["Rocket01Icon", "🚀"],
  ["StarIcon", "⭐"],
  ["HeartIcon", "❤️"],
  ["BookOpen01Icon", "📖"],
  ["CodeIcon", "💻"],
  ["Bug01Icon", "🐛"],
]);

/**
 * The picker's offers.
 *
 * A short, hand-picked list rather than every emoji there is: the point of the
 * picker is to choose quickly from things that read well at 12px in a sidebar,
 * and an exhaustive grid would be slower to use than typing the emoji into the
 * field beside it.
 */
export const GROUP_ICON_OPTIONS: readonly GroupIconName[] = [
  "📁", "📂", "🗂️", "📋", "📌", "📎", "🗄️", "📦",
  "💼", "🧰", "⚙️", "🔧", "🛠️", "🧪", "🔬", "🧬",
  "💻", "⌨️", "🖥️", "🐛", "🚀", "🛰️", "🤖", "🧠",
  "💡", "🔮", "✨", "🎯", "🔥", "⚡", "🌱", "🌳",
  "🌿", "🍀", "🌊", "🏔️", "🌍", "🗺️", "🏠", "🏗️",
  "💰", "💳", "📈", "📉", "🧾", "🏦", "🛒", "🎁",
  "📝", "✍️", "📖", "📚", "🎨", "🎬", "🎵", "📷",
  "🔍", "👁️", "🕹️", "♟️", "🧩", "🔒", "🔑", "⏰",
  "📅", "✅", "⭐", "❤️", "🏷️", "🔖", "🧭", "☕",
];

const GROUP_ICON_SET = new Set(GROUP_ICON_OPTIONS);

/**
 * How long a stored icon may be, in UTF-16 units.
 *
 * Enough for a family emoji with joiners or a flag with a skin tone, and short
 * enough that nothing can use an icon to move a row's layout.
 */
const MAX_GROUP_ICON_LENGTH = 16;

/** Non-ASCII, no control characters, bounded length. */
const EMOJI_SHAPE = /^[^\u0000-\u001F\u007F\u0020-\u007E]{1,16}$/u;

/**
 * The canonical form of a stored or chosen icon, or null when it is neither a
 * legacy name this build understands nor something shaped like an emoji.
 */
export function normalizeGroupIconName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (GROUP_ICON_SET.has(value)) return value;
  const legacy = LEGACY_GROUP_ICON_ALIASES.get(value);
  if (legacy !== undefined) return legacy;
  if (value.length > MAX_GROUP_ICON_LENGTH) return null;
  return EMOJI_SHAPE.test(value) ? value : null;
}

export function validGroupIcon(value: unknown): value is GroupIconName {
  return normalizeGroupIconName(value) !== null;
}

export function canonicalGroupIcon(value: unknown): GroupIconName {
  return normalizeGroupIconName(value) ?? DEFAULT_GROUP_ICON;
}

/**
 * What a picker tile and a row announce for an icon.
 *
 * Emoji have no names to strip the way `LayerIcon` had, so the label is the
 * glyph itself. It is still a function rather than a bare pass-through: the
 * callers that ask are asking "how do I name this in a title attribute", and
 * that stays true if the vocabulary changes again.
 */
export function groupIconLabel(value: string): string {
  return canonicalGroupIcon(value);
}
