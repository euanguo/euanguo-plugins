export const PROJECT_BADGE_PALETTE = [
  "#5B78A0",
  "#76688F",
  "#956B82",
  "#996A70",
  "#9A6C62",
  "#987553",
  "#8E7B4F",
  "#66805F",
  "#557E73",
  "#557C82",
  "#5A7890",
  "#66739A",
] as const;

export const MAX_PROJECT_COLOR_ROWS = 500;
export const MAX_PROJECT_ID_LENGTH = 200;

const HEX_COLOR = /^#[0-9A-F]{6}$/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

export interface ProjectBadgePresentation {
  backgroundColor: string;
  foregroundColor: "#000000" | "#FFFFFF";
  isCustom: boolean;
}

export function canonicalProjectColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return HEX_COLOR.test(normalized) ? normalized : null;
}

export function validProjectId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PROJECT_ID_LENGTH &&
    !CONTROL_CHARACTER.test(value)
  );
}

export function automaticProjectColor(projectId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < projectId.length; index += 1) {
    hash ^= projectId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return PROJECT_BADGE_PALETTE[(hash >>> 0) % PROJECT_BADGE_PALETTE.length];
}

export function projectBadgePresentation(
  projectId: string,
  override: unknown,
): ProjectBadgePresentation {
  const canonicalOverride = canonicalProjectColor(override);
  const backgroundColor =
    canonicalOverride ?? automaticProjectColor(projectId);
  return {
    backgroundColor,
    foregroundColor: bestBadgeForeground(backgroundColor),
    isCustom: canonicalOverride !== null,
  };
}

export function projectBadgeLetter(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase() || "?";
}

export function contrastRatio(left: string, right: string): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function bestBadgeForeground(
  backgroundColor: string,
): "#000000" | "#FFFFFF" {
  return contrastRatio(backgroundColor, "#000000") >=
    contrastRatio(backgroundColor, "#FFFFFF")
    ? "#000000"
    : "#FFFFFF";
}

function relativeLuminance(color: string): number {
  const canonical = canonicalProjectColor(color);
  if (canonical === null) return 0;
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(canonical.slice(offset, offset + 2), 16),
  );
  const [red, green, blue] = channels.map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045
      ? srgb / 12.92
      : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
