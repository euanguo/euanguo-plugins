/**
 * A group's icon: one emoji.
 *
 * Stored values are validated on every read because they arrive from persistence:
 * a name is accepted only if it is a bounded run of non-ASCII glyphs so markup
 * text cannot sneak in and long strings cannot break row layout.
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
