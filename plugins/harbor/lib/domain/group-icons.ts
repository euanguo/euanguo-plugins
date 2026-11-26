/**
 * Monochrome BB vector icon vocabulary for project groups and sections.
 *
 * Legacy persisted Hugeicons names and emoji values remain accepted on read
 * (and mapped onto matching monochrome BB icon names) so existing databases
 * upgrade cleanly without showing colorful emojis next to linear sidebar rows.
 */

export const GROUP_ICON_OPTIONS = [
  "Folder",
  "Layers",
  "Settings",
  "Home",
  "Puzzle",
  "FolderGit",
  "Terminal",
  "Code",
  "Workflow",
  "GridView",
  "GitBranch",
  "GitMerge",
  "GitPullRequest",
  "ListTodo",
  "FileText",
  "Target",
  "Pin",
  "Archive",
  "Clock",
  "Eye",
  "Link",
  "MessageSquare",
  "SlidersHorizontal",
  "FolderSync",
] as const;

export type GroupIconName = (typeof GROUP_ICON_OPTIONS)[number];

export const DEFAULT_GROUP_ICON: GroupIconName = "Folder";

export const GROUP_ICON_LABELS: Readonly<Record<GroupIconName, string>> = {
  Folder: "Folder",
  Layers: "Layers",
  Settings: "Work / Tools",
  Home: "Personal / Home",
  Puzzle: "Side / Experiments",
  FolderGit: "Repositories",
  Terminal: "Terminal / CLI",
  Code: "Code",
  Workflow: "Workflow",
  GridView: "Apps / Suite",
  GitBranch: "Branches",
  GitMerge: "Merges",
  GitPullRequest: "Pull requests",
  ListTodo: "Tasks",
  FileText: "Docs / Notes",
  Target: "Focus / Goals",
  Pin: "Pinned",
  Archive: "Archive",
  Clock: "Scheduled",
  Eye: "Watched",
  Link: "Links",
  MessageSquare: "Conversations",
  SlidersHorizontal: "Config",
  FolderSync: "Sync",
};

const GROUP_ICON_SET: ReadonlySet<string> = new Set(GROUP_ICON_OPTIONS);

const LEGACY_GROUP_ICON_ALIASES: ReadonlyMap<string, GroupIconName> = new Map([
  // Earlier icon names or unmapped placeholders
  ["IdCard", "Home"],
  ["Server", "Terminal"],
  ["Tag", "Target"],
  ["Layer", "Folder"],
  ["LayerIcon", "Folder"],
  ["Folder02", "Folder"],
  ["FolderTree", "GitBranch"],
  ["FolderTreeIcon", "GitBranch"],
  ["GitBranchIcon", "GitBranch"],
  ["Target02Icon", "Target"],
  ["ListTodoIcon", "ListTodo"],
  ["PinIcon", "Pin"],
  ["AccountSetting01Icon", "Settings"],
  ["AddMoneyCircleIcon", "Home"],
  ["AiIdeaIcon", "Puzzle"],
  ["EyeIcon", "Eye"],
  ["Archive02Icon", "Archive"],
  ["Briefcase01Icon", "Layers"],
  ["Home01Icon", "Home"],
  ["Rocket01Icon", "Workflow"],
  ["StarIcon", "Pin"],
  ["HeartIcon", "Home"],
  ["BookOpen01Icon", "FileText"],
  ["CodeIcon", "Code"],
  ["Bug01Icon", "Puzzle"],
  ["ComputerIcon", "Terminal"],
  // Legacy emoji group icons
  ["📁", "Folder"],
  ["📂", "Folder"],
  ["🗂️", "Folder"],
  ["⚙️", "Settings"],
  ["⚙", "Settings"],
  ["🔧", "Settings"],
  ["🛠️", "Settings"],
  ["🛠", "Settings"],
  ["🧰", "Settings"],
  ["💰", "Home"],
  ["💳", "Home"],
  ["🏠", "Home"],
  ["🏦", "Home"],
  ["💡", "Puzzle"],
  ["🧩", "Puzzle"],
  ["✨", "Puzzle"],
  ["🔮", "Puzzle"],
  ["🧪", "Puzzle"],
  ["🔬", "Puzzle"],
  ["💼", "Layers"],
  ["📦", "Layers"],
  ["🏗️", "Layers"],
  ["💻", "Code"],
  ["⌨️", "Terminal"],
  ["🖥️", "Terminal"],
  ["🌍", "Terminal"],
  ["🗺️", "Terminal"],
  ["🛰️", "Terminal"],
  ["🚀", "Workflow"],
  ["⚡", "Workflow"],
  ["🔥", "Workflow"],
  ["🌿", "GitBranch"],
  ["🌳", "GitBranch"],
  ["🌱", "GitBranch"],
  ["📋", "ListTodo"],
  ["✅", "ListTodo"],
  ["🎯", "Target"],
  ["📌", "Pin"],
  ["🔖", "Pin"],
  ["⭐", "Pin"],
  ["❤️", "Home"],
  ["🏷️", "Target"],
  ["🗄️", "Archive"],
  ["📝", "FileText"],
  ["✍️", "FileText"],
  ["📖", "FileText"],
  ["📚", "FileText"],
  ["⏰", "Clock"],
  ["📅", "Clock"],
  ["👁️", "Eye"],
  ["🔍", "Eye"],
  ["📎", "Link"],
  ["🤖", "MessageSquare"],
  ["🧠", "MessageSquare"],
]);

const MAX_GROUP_ICON_LENGTH = 16;

/** Bounded non-ASCII emoji sequence stored by legacy builds. */
const EMOJI_SHAPE = /^[^\u0000-\u001F\u007F\u0020-\u007E]{1,16}$/u;

/**
 * Canonical monochrome BB icon name for a stored or user-chosen group icon,
 * or null when the string is unknown or unsafe.
 */
export function normalizeGroupIconName(value: unknown): GroupIconName | null {
  if (typeof value !== "string") return null;
  if (GROUP_ICON_SET.has(value)) return value as GroupIconName;
  const legacy = LEGACY_GROUP_ICON_ALIASES.get(value);
  if (legacy !== undefined) return legacy;
  if (value.length > MAX_GROUP_ICON_LENGTH) return null;
  return EMOJI_SHAPE.test(value) ? DEFAULT_GROUP_ICON : null;
}

export function validGroupIcon(value: unknown): value is string {
  return normalizeGroupIconName(value) !== null;
}

export function canonicalGroupIcon(value: unknown): GroupIconName {
  return normalizeGroupIconName(value) ?? DEFAULT_GROUP_ICON;
}
