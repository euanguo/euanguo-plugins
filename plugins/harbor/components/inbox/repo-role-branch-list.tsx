import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import { Input } from "@bb-ui/input";
import { cn } from "@/lib/ui/utils";

export interface RepoRoleBranchListProps {
  readonly projectIds: readonly string[];
  readonly projects: readonly PluginSidebarProject[];
  readonly roles: Readonly<Record<string, "worktree" | "ref">>;
  readonly getBranch: (projectId: string) => string;
  readonly placeholderBranch?: string;
  readonly disabled?: boolean;
  readonly listClassName?: string;
  readonly onRoleChange: (projectId: string, role: "worktree" | "ref") => void;
  readonly onBranchChange: (projectId: string, branch: string) => void;
}

/**
 * Shared Worktree/Ref role toggle + branch input list for multi-repo feature flows.
 */
export function RepoRoleBranchList({
  projectIds,
  projects,
  roles,
  getBranch,
  placeholderBranch = "branch",
  disabled = false,
  listClassName,
  onRoleChange,
  onBranchChange,
}: RepoRoleBranchListProps) {
  if (projectIds.length === 0) return null;

  return (
    <ul
      className={cn(
        "grid gap-1.5 overflow-y-auto rounded-md border border-border bg-background/40 px-2 py-1.5",
        listClassName,
      )}
    >
      {projectIds.map((projectId) => {
        const project = projects.find((candidate) => candidate.id === projectId);
        const role = roles[projectId] ?? "worktree";
        return (
          <li
            key={projectId}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)] items-center gap-1.5"
          >
            <span className="truncate text-2xs font-medium text-foreground/90">
              {project?.name ?? projectId}
            </span>
            <div className="inline-flex rounded border border-border bg-muted/40 p-0.5 text-[10px]">
              {(["worktree", "ref"] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  disabled={disabled}
                  onClick={() => onRoleChange(projectId, choice)}
                  className={cn(
                    "rounded-sm px-1.5 py-0.5 transition-colors",
                    role === choice
                      ? "bg-state-active font-medium text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {choice === "ref" ? "Ref" : "Worktree"}
                </button>
              ))}
            </div>
            {role === "ref" ? (
              <div className="flex justify-end">
                <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  Read-only symlink
                </span>
              </div>
            ) : (
              <Input
                value={getBranch(projectId)}
                maxLength={200}
                aria-label={`Branch for ${project?.name ?? projectId}`}
                placeholder={placeholderBranch}
                disabled={disabled}
                onChange={(event) => onBranchChange(projectId, event.currentTarget.value)}
                className="h-6 min-w-0 font-mono text-2xs"
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
