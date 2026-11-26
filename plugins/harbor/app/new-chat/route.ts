export const NEW_CHAT_PANEL_PATH = "new";
export const FEATURE_SUBPATH_PREFIX = "feature/";

export type NewChatTarget =
  | { readonly kind: "environment"; readonly environmentId: string }
  | { readonly kind: "feature"; readonly featureId: string };

export function featureNewChatSubPath(featureId: string): string {
  return `${FEATURE_SUBPATH_PREFIX}${encodeURIComponent(featureId)}`;
}

export function parseNewChatSubPath(subPath: string): NewChatTarget | null {
  const value = subPath.trim().replace(/^\/+|\/+$/g, "");
  if (value.length === 0 || value === "feature") return null;
  if (value.startsWith(FEATURE_SUBPATH_PREFIX)) {
    const rawId = value
      .slice(FEATURE_SUBPATH_PREFIX.length)
      .replace(/^\/+|\/+$/g, "");
    if (rawId.length === 0) return null;
    let featureId = rawId;
    try {
      featureId = decodeURIComponent(rawId);
    } catch {
      featureId = rawId;
    }
    const trimmed = featureId.trim();
    return trimmed.length === 0 ? null : { kind: "feature", featureId: trimmed };
  }
  return { kind: "environment", environmentId: value };
}

export function environmentIdFromSubPath(subPath: string): string | null {
  const parsed = parseNewChatSubPath(subPath);
  return parsed?.kind === "environment" ? parsed.environmentId : null;
}

export function draftKeyFor(environmentId: string): string {
  return `harbor:new-chat:${environmentId}`;
}

export function draftKeyForTarget(target: NewChatTarget): string {
  return target.kind === "environment"
    ? draftKeyFor(target.environmentId)
    : `harbor:new-chat:feature:${target.featureId}`;
}
