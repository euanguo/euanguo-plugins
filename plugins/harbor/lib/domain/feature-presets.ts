/**
 * Reusable multi-repo templates (`FeaturePreset`) and bidirectional
 * `.code-workspace` serialization/import helpers.
 */

export const MAX_PRESET_NAME_LENGTH = 60;
export const MAX_PRESETS = 50;
export const MAX_PRESET_REPOS = 20;

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/u;

export interface FeaturePresetRepo {
  readonly projectId: string;
  readonly role: "worktree" | "ref";
  readonly branchTemplate: string | null;
}

export interface FeaturePreset {
  readonly id: string;
  readonly name: string;
  readonly baseBranch: string | null;
  readonly repos: readonly FeaturePresetRepo[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CodeWorkspaceFolder {
  readonly path: string;
  readonly name: string | null;
}

export function validPresetName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_PRESET_NAME_LENGTH &&
    !CONTROL_CHARACTER.test(value)
  );
}

export function canonicalPresetName(value: string): string {
  return value.replace(CONTROL_CHARACTER, " ").replace(/\s+/gu, " ").trim();
}

export function normalizePresetRepos(
  value: unknown,
): readonly FeaturePresetRepo[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: FeaturePresetRepo[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const projectId =
      typeof raw.projectId === "string" ? raw.projectId.trim() : "";
    if (
      projectId.length === 0 ||
      projectId.length > 200 ||
      CONTROL_CHARACTER.test(projectId) ||
      seen.has(projectId)
    ) {
      continue;
    }
    seen.add(projectId);
    const role = raw.role === "ref" ? "ref" : "worktree";
    const branchTemplate =
      typeof raw.branchTemplate === "string" &&
      raw.branchTemplate.trim().length > 0 &&
      !CONTROL_CHARACTER.test(raw.branchTemplate)
        ? raw.branchTemplate.trim().slice(0, 200)
        : null;
    normalized.push({ projectId, role, branchTemplate });
    if (normalized.length >= MAX_PRESET_REPOS) break;
  }
  return normalized;
}

/**
 * Generates an editor-ready `.code-workspace` JSON file containing every
 * member inside the feature directory plus any adopted external worktrees.
 */
export function renderCodeWorkspace(input: {
  readonly name: string;
  readonly members: readonly {
    readonly directory: string;
    readonly repository: string;
    readonly role: "worktree" | "ref";
  }[];
  readonly adoptedPaths?: readonly {
    readonly name: string;
    readonly path: string;
  }[];
}): string {
  const folders: { path: string; name: string }[] = input.members.map(
    (member) => ({
      path: `./${member.directory}`,
      name:
        member.role === "ref"
          ? `${member.repository} (Ref · Read-only)`
          : member.repository,
    }),
  );
  for (const adopted of input.adoptedPaths ?? []) {
    if (adopted.path.trim().length === 0) continue;
    folders.push({
      path: adopted.path,
      name: `${adopted.name} (Adopted)`,
    });
  }
  return `${JSON.stringify(
    {
      folders,
      settings: {
        "harbor.featureName": input.name,
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * Parses a `.code-workspace` JSON or JSONC file safely without stripping URLs or
 * string literals containing comment markers.
 */
export function parseCodeWorkspaceJson(
  raw: string,
  workspaceDir: string,
): readonly CodeWorkspaceFolder[] {
  const cleaned = stripJsonCommentsAndTrailingCommas(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const folders = (parsed as { folders?: unknown }).folders;
  if (!Array.isArray(folders)) return [];

  const resolved: CodeWorkspaceFolder[] = [];
  const seen = new Set<string>();
  const baseDir = normalizeSlashPath(workspaceDir);

  for (const item of folders) {
    if (typeof item !== "object" || item === null) continue;
    const rawPath = (item as { path?: unknown }).path;
    const rawName = (item as { name?: unknown }).name;
    if (typeof rawPath !== "string" || rawPath.trim().length === 0) continue;
    const fullPath = resolveWorkspaceFolderPath(baseDir, rawPath.trim());
    if (seen.has(fullPath)) continue;
    seen.add(fullPath);
    resolved.push({
      path: fullPath,
      name:
        typeof rawName === "string" && rawName.trim().length > 0
          ? rawName.trim()
          : null,
    });
  }
  return resolved;
}

function stripJsonCommentsAndTrailingCommas(input: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let escaped = false;

  while (i < input.length) {
    const ch = input[i] ?? "";
    const next = input[i + 1] ?? "";

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < input.length && input[i] !== "\n") i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < input.length) {
        if (input[i] === "*" && input[i + 1] === "/") {
          i += 2;
          break;
        }
        i += 1;
      }
      continue;
    }

    out += ch;
    i += 1;
  }

  // Strip trailing commas before closing array or object tokens outside strings.
  let noTrailing = "";
  inString = false;
  escaped = false;
  for (let idx = 0; idx < out.length; idx += 1) {
    const ch = out[idx] ?? "";
    if (inString) {
      noTrailing += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      noTrailing += ch;
      continue;
    }
    if (ch === ",") {
      let look = idx + 1;
      while (look < out.length && /\s/u.test(out[look] ?? "")) look += 1;
      const ahead = out[look];
      if (ahead === "}" || ahead === "]") continue;
    }
    noTrailing += ch;
  }
  return noTrailing;
}

function normalizeSlashPath(value: string): string {
  const replaced = value.replaceAll("\\", "/");
  if (replaced === "/") return "/";
  return replaced.replace(/\/+$/u, "");
}

function resolveWorkspaceFolderPath(baseDir: string, target: string): string {
  const normTarget = normalizeSlashPath(target);
  if (normTarget.startsWith("/") || /^[A-Za-z]:\//u.test(normTarget)) {
    return collapseDotSegments(normTarget);
  }
  const combined =
    baseDir.length === 0 ? normTarget : `${baseDir}/${normTarget}`;
  return collapseDotSegments(combined);
}

function collapseDotSegments(value: string): string {
  const leadingSlash = value.startsWith("/");
  const drivePrefixMatch = !leadingSlash
    ? value.match(/^[A-Za-z]:/u)
    : null;
  const prefix = leadingSlash
    ? "/"
    : drivePrefixMatch !== null
      ? `${drivePrefixMatch[0]}/`
      : "";
  const rest = leadingSlash
    ? value.slice(1)
    : drivePrefixMatch !== null
      ? value.slice(drivePrefixMatch[0].length + 1)
      : value;
  const parts = rest.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part.length === 0 || part === ".") continue;
    if (part === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else if (!leadingSlash && drivePrefixMatch === null) {
        stack.push("..");
      }
      continue;
    }
    stack.push(part);
  }
  return `${prefix}${stack.join("/")}` || (leadingSlash ? "/" : ".");
}
