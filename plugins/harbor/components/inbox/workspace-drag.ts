export function parseDraggedWorkspace(
  raw: string,
): { projectId: string; workspaceKey: string } | null {
  if (raw.length === 0 || raw.length > 500) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("projectId" in parsed) ||
      !("workspaceKey" in parsed) ||
      typeof parsed.projectId !== "string" ||
      typeof parsed.workspaceKey !== "string"
    ) {
      return null;
    }
    return {
      projectId: parsed.projectId,
      workspaceKey: parsed.workspaceKey,
    };
  } catch {
    return null;
  }
}
