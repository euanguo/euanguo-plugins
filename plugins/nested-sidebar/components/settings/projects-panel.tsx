import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BadgeSwatch } from "@/components/ui/badge-swatch";
import {
  SettingsChoice,
  SettingsToggle,
} from "@/components/ui/settings-row";
import {
  WORKSPACE_OWNERSHIP_OPTIONS,
} from "@/lib/preferences";
import type { AppearanceValues } from "@/lib/appearance";
import { automaticProjectColor, projectBadgeLetter } from "@/lib/project-colors";
import type { useProjectColors } from "@/hooks/use-project-colors";
import type { SettingsSetter } from "@/components/ui/settings-row";

export function ProjectsPanel({
  projects,
  projectColors,
  values,
  set,
}: {
  projects: readonly { id: string; name: string }[];
  projectColors: ReturnType<typeof useProjectColors>;
  values: AppearanceValues;
  set: SettingsSetter;
}) {
  return (
    <div className="space-y-4">
      <SettingsToggle
        label="Detect project icons"
        hint="Read a conventional favicon or logo from the checkout, on the machine that owns it."
        value={values.autoProjectIcons}
        onChange={(next) => set({ autoProjectIcons: next })}
      />
      <SettingsChoice
        label="Workspace ownership"
        hint="Filesystem keeps a checkout with its worktrees; bb claims keeps bb's filing."
        value={values.workspaceOwnership as string}
        options={WORKSPACE_OWNERSHIP_OPTIONS}
        onChange={(value) => set({ workspaceOwnership: value })}
      />
      <SettingsToggle
        label="Show unregistered worktrees"
        hint="Worktrees the repository records but bb has no environment for. Makes them adoptable with +."
        value={values.showUnregisteredWorktrees}
        onChange={(next) => set({ showUnregisteredWorktrees: next })}
      />
      <SettingsToggle
        label="Group by repository"
        hint="One repository as one row, by the .git its workspaces share. Off is exactly bb's own list."
        value={values.groupByRepository}
        onChange={(next) => set({ groupByRepository: next })}
      />

      <div className="border-t border-border/80 pt-2">
        <Fold
          summary="Project badge colors"
          badge={`${projectColors.overrides.size} of ${projects.length} custom`}
        >
          <ProjectColorEditor
            projects={projects}
            overrides={projectColors.overrides}
            isLoading={projectColors.isLoading}
            setProjectColor={projectColors.setProjectColor}
            resetProjectColor={projectColors.resetProjectColor}
          />
        </Fold>
      </div>
    </div>
  );
}

/**
 * A heading with a body that stays shut until asked.
 *
 * The project badge editor is reference material — one row per project, read
 * once and then left alone — so it sits behind a summary instead of pushing the
 * switches a user came for off the screen.
 */
function Fold({
  summary,
  badge,
  children,
}: {
  summary: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <details data-nest-settings-fold="" className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-2xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Icon
          name="ChevronRight"
          className="size-3 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {badge === undefined ? null : (
          <span className="shrink-0 tabular-nums text-muted-foreground/70">
            {badge}
          </span>
        )}
      </summary>
      <div className="pb-2 pt-1">{children}</div>
    </details>
  );
}

function ProjectColorEditor({
  projects,
  overrides,
  isLoading,
  setProjectColor,
  resetProjectColor,
}: {
  projects: readonly { id: string; name: string }[];
  overrides: ReadonlyMap<string, string>;
  isLoading: boolean;
  setProjectColor(projectId: string, color: string): Promise<string>;
  resetProjectColor(projectId: string): Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized.length === 0
      ? projects
      : projects.filter((project) =>
          project.name.toLocaleLowerCase().includes(normalized),
        );
  }, [projects, query]);

  return (
    <div data-nest-project-color-settings="">
      <div className="flex items-end justify-between gap-3 pb-1.5">
        <div>
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            Project badge colors
          </p>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            Automatic colors stay with a project when it is renamed.
          </p>
        </div>
        {projects.length > 8 ? (
          <label className="grid gap-1 text-2xs text-muted-foreground">
            Filter projects
            <Input
              type="search"
              className="h-7 w-36 text-xs"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
        ) : null}
      </div>
      {isLoading && projects.length === 0 ? (
        <p className="py-1.5 text-2xs text-muted-foreground">Loading projects…</p>
      ) : visibleProjects.length === 0 ? (
        <p className="rounded border border-dashed border-border px-2 py-2 text-center text-2xs text-muted-foreground">
          No projects match this filter.
        </p>
      ) : (
        <ul className="border-t border-border/60">
          {visibleProjects.map((project) => (
            <ProjectColorRow
              key={project.id}
              project={project}
              override={overrides.get(project.id)}
              setProjectColor={setProjectColor}
              resetProjectColor={resetProjectColor}
              announce={setAnnouncement}
            />
          ))}
        </ul>
      )}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}

function ProjectColorRow({
  project,
  override,
  setProjectColor,
  resetProjectColor,
  announce,
}: {
  project: { id: string; name: string };
  override: string | undefined;
  setProjectColor(projectId: string, color: string): Promise<string>;
  resetProjectColor(projectId: string): Promise<void>;
  announce(message: string): void;
}) {
  const automatic = automaticProjectColor(project.id);
  const persisted = override ?? automatic;
  const [draft, setDraft] = useState(persisted);
  const [dirty, setDirty] = useState(false);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previousPersisted = useRef(persisted);
  const errorId = useId();
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = previousPersisted.current;
    previousPersisted.current = persisted;
    if (persisted === previous) return;
    if (!dirty || draft === previous) {
      setDraft(persisted);
      setDirty(false);
      setChangedElsewhere(false);
    } else if (draft !== persisted) {
      setChangedElsewhere(true);
    }
  }, [dirty, draft, persisted]);

  const status = dirty ? "Draft" : override === undefined ? "Automatic" : "Custom";

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const stored = await setProjectColor(project.id, draft);
      previousPersisted.current = stored;
      setDraft(stored);
      setDirty(false);
      setChangedElsewhere(false);
      announce(`Saved badge color for ${project.name}.`);
    } catch {
      setError("Could not save this project color. Try again.");
    } finally {
      setBusy(null);
      requestAnimationFrame(() => saveButtonRef.current?.focus());
    }
  };

  const reset = async () => {
    setBusy("reset");
    setError(null);
    try {
      await resetProjectColor(project.id);
      previousPersisted.current = automatic;
      setDraft(automatic);
      setDirty(false);
      setChangedElsewhere(false);
      announce(`Reset badge color for ${project.name} to automatic.`);
    } catch {
      setError("Could not reset this project color. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <li
      data-nest-project-color-row={project.id}
      className="border-t border-border/60 py-1.5 first:border-t-0"
    >
      <div className="flex items-center gap-2">
        <BadgeSwatch
          backgroundColor={draft}
          className="size-5 rounded border-black/15 text-2xs"
        >
          {projectBadgeLetter(project.name)}
        </BadgeSwatch>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">
            {project.name}
          </p>
          <p className="select-text text-2xs tabular-nums text-muted-foreground">
            {status} · {draft}
          </p>
        </div>
        <label className="relative flex size-6 shrink-0 cursor-pointer items-center justify-center rounded border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
          <span className="sr-only">Badge color for {project.name}</span>
          <span
            aria-hidden
            className="size-3.5 rounded border border-black/15"
            style={{ backgroundColor: draft }}
          />
          <input
            type="color"
            value={draft}
            disabled={busy !== null}
            aria-describedby={error === null ? undefined : errorId}
            onChange={(event) => {
              const next = event.currentTarget.value.toUpperCase();
              setDraft(next);
              setDirty(next !== persisted);
              setError(null);
            }}
            className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-wait"
          />
        </label>
        <Button
          ref={saveButtonRef}
          variant="outline"
          size="sm"
          disabled={!dirty || busy !== null}
          aria-label={`Save badge color for ${project.name}`}
          onClick={() => void save()}
        >
          {busy === "save" ? "Saving…" : "Save"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={override === undefined || busy !== null}
          aria-label={`Reset badge color for ${project.name}`}
          onClick={() => void reset()}
        >
          {busy === "reset" ? "Resetting…" : "Reset"}
        </Button>
      </div>
      {changedElsewhere ? (
        <p className="pt-1 text-2xs text-warning-foreground">
          Color changed elsewhere.{" "}
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 text-inherit"
            onClick={() => {
              setDraft(persisted);
              setDirty(false);
              setChangedElsewhere(false);
            }}
          >
            Reload
          </Button>{" "}
          or save this draft.
        </p>
      ) : null}
      {error !== null ? (
        <p id={errorId} className="pt-1 text-2xs text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}
