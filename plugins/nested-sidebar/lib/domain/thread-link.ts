/**
 * The link bb itself would copy for a thread.
 *
 * bb's own row menu offers "Copy thread link", and the URL it builds is the
 * route the app serves that thread at. A replaced sidebar has to reproduce the
 * same shape rather than invent one, because the link is pasted into chats and
 * issues where it is expected to open the thread — not to open this sidebar.
 *
 * The personal project is the one exception: its threads live at the top level
 * with no project segment, and bb keeps that sentinel in the domain package.
 */

export const PERSONAL_PROJECT_ID = "proj_personal";

export function isPersonalProject(projectId: string): boolean {
  return projectId === PERSONAL_PROJECT_ID;
}

/** The route path for one thread, matching bb's own `getThreadRoutePath`. */
export function threadRoutePath(projectId: string, threadId: string): string {
  return isPersonalProject(projectId)
    ? `/threads/${threadId}`
    : `/projects/${projectId}/threads/${threadId}`;
}

/**
 * An absolute URL for a thread, resolved against the page's own origin so the
 * link is usable outside the tab that produced it. A non-browser caller (a
 * test, or a render before hydration) gets the bare path rather than a broken
 * `undefined/threads/...` string.
 */
export function threadLinkUrl(
  projectId: string,
  threadId: string,
  origin: string | null = browserOrigin(),
): string {
  const path = threadRoutePath(projectId, threadId);
  if (origin === null || origin.length === 0) return path;
  return new URL(path, origin).toString();
}

function browserOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return window.location.origin;
}
