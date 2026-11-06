import { useMemo, useState } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Choosing several repositories at once.
 *
 * A filter box over a checkbox list rather than a select, because the common
 * case is two or three repositories out of a dozen, and a select picks one. A
 * row can carry a line of status underneath — the pre-flight answer for that
 * repository — so the decision and its consequence are read in one place.
 */
export function RepositoryPicker({
  projects,
  selected,
  onChange,
  status,
  disabled = false,
}: {
  projects: readonly PluginSidebarProject[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  /** projectId -> a line under the row, and its tone. */
  status?: ReadonlyMap<string, { readonly text: string; readonly tone: "muted" | "ok" | "bad" }>;
  disabled?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle.length === 0
      ? projects
      : projects.filter((project) => project.name.toLowerCase().includes(needle));
  }, [filter, projects]);
  const chosen = new Set(selected);
  const toggle = (projectId: string, on: boolean) =>
    onChange(
      on
        ? [...selected.filter((id) => id !== projectId), projectId]
        : selected.filter((id) => id !== projectId),
    );

  return (
    <div className="grid gap-1.5">
      {projects.length > 6 ? (
        <Input
          value={filter}
          placeholder="Filter repositories"
          aria-label="Filter repositories"
          disabled={disabled}
          onChange={(event) => setFilter(event.currentTarget.value)}
        />
      ) : null}
      <ul
        role="group"
        aria-label="Repositories"
        className="max-h-64 overflow-y-auto rounded-md border border-border"
      >
        {visible.length === 0 ? (
          <li className="px-2 py-2 text-2xs text-muted-foreground">No repository matches.</li>
        ) : (
          visible.map((project) => {
            const line = status?.get(project.id);
            const checked = chosen.has(project.id);
            return (
              <li key={project.id} className="border-b border-border/60 last:border-b-0">
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2 px-2 py-1.5 hover:bg-accent/50",
                    disabled && "cursor-not-allowed opacity-60",
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(value) => toggle(project.id, value === true)}
                    className="mt-px"
                  />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-xs text-foreground">{project.name}</span>
                    {checked && line !== undefined ? (
                      <span
                        className={cn(
                          "flex min-w-0 items-start gap-1 text-2xs",
                          line.tone === "bad"
                            ? "text-destructive"
                            : line.tone === "ok"
                              ? "text-muted-foreground"
                              : "text-muted-foreground/80",
                        )}
                      >
                        {line.tone === "bad" ? (
                          <Icon name="AlertCircle" className="mt-px size-3 shrink-0" aria-hidden />
                        ) : line.tone === "ok" ? (
                          <Icon name="Check" className="mt-px size-3 shrink-0" aria-hidden />
                        ) : null}
                        <span className="min-w-0 break-words">{line.text}</span>
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
