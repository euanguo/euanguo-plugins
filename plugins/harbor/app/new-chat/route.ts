export const NEW_CHAT_PANEL_PATH = "new";

export function environmentIdFromSubPath(subPath: string): string | null {
  const value = subPath.trim().replace(/^\/+|\/+$/g, "");
  return value.length === 0 ? null : value;
}

export function draftKeyFor(environmentId: string): string {
  return `harbor:new-chat:${environmentId}`;
}
