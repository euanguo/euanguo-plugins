import {
  experimental_useSidebarThreads as useSidebarThreads,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  FamilyStatusBadge,
  FamilyStatusIcon,
} from "@/components/inbox/family-status";
import {
  familyStatusPresentation,
  workingActivityPresentation,
  type FamilyStatusKind,
  type WorkingActivityKind,
} from "@/lib/family-status";
import {
  nestPreferenceStyle,
  resolveNestPreferences,
  type NestPreferences,
  type RowDetailPlacement,
  type SemanticColorRole,
} from "@/lib/preferences";
import type { WorkspaceLabelMode } from "@/lib/workspace";
import { useProjectColors } from "@/hooks/use-project-colors";
import { RepoFactsPanel } from "@/components/settings/repo-facts-panel";
import {
  automaticProjectColor,
  projectBadgeLetter,
  projectBadgePresentation,
} from "@/lib/project-colors";

const WORKTREE_LABEL_SUMMARY: Readonly<Record<WorkspaceLabelMode, string>> = {
  "alias-over-branch": "alias over branch",
  "alias-and-branch": "alias + branch",
  "alias-only": "alias only",
  "branch-only": "branch only",
};

const ROW_DETAIL_SUMMARY: Readonly<Record<RowDetailPlacement, string>> = {
  row: "in the row",
  "row-no-branch": "in the row, no branch",
  hover: "on hover",
};

const THREAD_STATES: readonly FamilyStatusKind[] = [
  "working",
  "needs-you",
  "unread",
  "failed",
  "inactive",
  "stale",
];

const WORKING_ACTIVITIES: ReadonlyArray<{
  kind: WorkingActivityKind;
  label: string;
}> = [
  { kind: "runtime", label: "Runtime" },
  { kind: "workflow", label: "Workflow" },
  { kind: "agent", label: "Agent" },
  { kind: "command", label: "Command" },
  { kind: "plan", label: "Plan" },
  { kind: "goal", label: "Goal" },
];

const PR_SWATCHES: ReadonlyArray<{
  role: SemanticColorRole;
  label: string;
}> = [
  { role: "prReview", label: "PR review" },
  { role: "prChecks", label: "PR checks" },
  { role: "prReady", label: "PR ready" },
  { role: "prMerged", label: "PR merged" },
  { role: "prDraft", label: "PR draft" },
  { role: "prBlocked", label: "PR blocked" },
  { role: "prClosed", label: "PR closed" },
];

export function NestSettingsSection() {
  const settings = useSettings();
  const preferences = resolveNestPreferences(settings.values);
  const { projects } = useSidebarThreads();
  const projectColors = useProjectColors();

  return (
    <section
      data-nest-settings-preview=""
      style={nestPreferenceStyle(preferences) as CSSProperties}
      className="space-y-4 rounded-lg border border-border bg-muted/20 p-3"
    >
      <SettingsGroup
        id="appearance"
        title="Appearance"
        description="Semantic colors and project identity use the same quiet, readable visual language."
      >
        <p className="text-2xs text-muted-foreground">
          Effective palette: <span className="font-medium text-foreground">{preferences.palettePreset}</span>.
          Custom color fields are used only when Custom is selected. Icon shape,
          animation, labels, and tooltips remain available in every palette.
        </p>
        <StatePreview />
        <PalettePreview title="Pull requests" items={PR_SWATCHES} preferences={preferences} />
      </SettingsGroup>

      <SettingsGroup
        id="threads"
        title="Thread list"
        description="Nest always uses Compact rows. The options below decide which information shares each row."
      >
        <div className="rounded-md border border-border/70 bg-background/50 px-2 py-2 text-2xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Current layout:</span>{" "}
          Compact rows · {preferences.rowLayout === "one-line" ? "one line" : "two lines"} ·
          worktree labels {WORKTREE_LABEL_SUMMARY[preferences.worktreeLabel]} ·
          {preferences.statusDisplay === "dot" ? "dot" : "icon"} status ·
          details {ROW_DETAIL_SUMMARY[preferences.rowDetails]} ·
          children {preferences.defaultChildrenExpanded ? "expanded" : "collapsed"} ·
          child counts {preferences.showChildCount ? "shown" : "hidden"} ·
          branch/host {preferences.showThreadLocation ? "shown" : "hidden"} ·
          providers {preferences.showProviderIcons ? "shown" : "hidden"} ·
          PR metadata {preferences.showPullRequestMetadata ? "shown" : "hidden"} ·
          times {preferences.showRelativeTime ? "shown" : "hidden"} ·
          {preferences.pageSize} rows per page.
        </div>
      </SettingsGroup>

      <SettingsGroup
        id="projects"
        title="Projects and workspaces"
        description="Project badge colors are stable by project ID, so renaming a project does not change its identity. What each machine reports about the workspaces themselves is below it."
      >
        <ProjectColorEditor
          projects={projects}
          overrides={projectColors.overrides}
          isLoading={projectColors.isLoading}
          setProjectColor={projectColors.setProjectColor}
          resetProjectColor={projectColors.resetProjectColor}
        />
        <RepoFactsPanel />
      </SettingsGroup>

      <SettingsGroup
        id="advanced"
        title="Advanced behavior"
        description="These behaviors are automatic and intentionally have no extra switches."
      >
        <ul className="grid gap-1.5 text-2xs text-muted-foreground">
          <li className="rounded-md border border-border/70 bg-background/50 px-2 py-1.5">
            Search reveals every matching row, regardless of pagination.
          </li>
          <li className="rounded-md border border-border/70 bg-background/50 px-2 py-1.5">
            Default child expansion applies until you explicitly expand or collapse a family.
          </li>
          <li className="rounded-md border border-border/70 bg-background/50 px-2 py-1.5">
            Project icons are detected on the machine that owns the checkout and cached per project.
          </li>
        </ul>
      </SettingsGroup>
    </section>
  );
}

function SettingsGroup({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section data-nest-settings-group={id} className="space-y-2">
      <div>
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
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
      <div className="flex items-end justify-between gap-2">
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
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              className="h-7 w-36 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
        ) : null}
      </div>
      {isLoading && projects.length === 0 ? (
        <p className="mt-2 text-2xs text-muted-foreground">Loading projects…</p>
      ) : visibleProjects.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed border-border p-3 text-center text-2xs text-muted-foreground">
          No projects match this filter.
        </p>
      ) : (
        <ul className="mt-2 grid gap-1.5">
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

  const preview = projectBadgePresentation(project.id, draft);
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
      className="rounded-md border border-border/70 bg-background/55 p-2"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded-md border border-black/15 text-2xs font-semibold uppercase shadow-sm"
          style={{
            backgroundColor: preview.backgroundColor,
            color: preview.foregroundColor,
          }}
        >
          {projectBadgeLetter(project.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">
            {project.name}
          </p>
          <p className="select-text text-2xs tabular-nums text-muted-foreground">
            {status} · {draft}
          </p>
        </div>
        <label className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
          <span className="sr-only">Badge color for {project.name}</span>
          <span
            aria-hidden
            className="size-4 rounded border border-black/15"
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
        <button
          ref={saveButtonRef}
          type="button"
          disabled={!dirty || busy !== null}
          aria-label={`Save badge color for ${project.name}`}
          onClick={() => void save()}
          className="h-7 rounded-md border border-border px-2 text-2xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={override === undefined || busy !== null}
          aria-label={`Reset badge color for ${project.name}`}
          onClick={() => void reset()}
          className="h-7 rounded-md px-2 text-2xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy === "reset" ? "Resetting…" : "Reset"}
        </button>
      </div>
      {changedElsewhere ? (
        <p className="mt-1.5 text-2xs text-warning-foreground">
          Color changed elsewhere.{" "}
          <button
            type="button"
            onClick={() => {
              setDraft(persisted);
              setDirty(false);
              setChangedElsewhere(false);
            }}
            className="font-medium underline underline-offset-2"
          >
            Reload
          </button>{" "}
          or save this draft.
        </p>
      ) : null}
      {error !== null ? (
        <p id={errorId} className="mt-1.5 text-2xs text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function StatePreview() {
  return (
    <div>
      <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        Thread states
      </p>
      <ul className="mt-1.5 grid grid-cols-2 gap-1.5">
        {THREAD_STATES.map((kind) => {
          const status = familyStatusPresentation(kind);
          return (
            <li
              key={kind}
              className="flex min-w-0 items-center gap-1 rounded border border-border/70 bg-background/50 px-1.5 py-1.5"
            >
              <FamilyStatusIcon status={status} />
              <FamilyStatusBadge status={status} preview />
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        Working activity types
      </p>
      <ul className="mt-1.5 grid grid-cols-3 gap-1.5">
        {WORKING_ACTIVITIES.map(({ kind, label }) => {
          const status = workingActivityPresentation(kind);
          return (
            <li
              key={kind}
              className="flex min-w-0 items-center gap-1 rounded border border-border/70 bg-background/50 px-1.5 py-1"
            >
              <FamilyStatusIcon status={status} />
              <span className="truncate text-[10px] font-medium text-foreground/80">
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PalettePreview({
  title,
  items,
  preferences,
}: {
  title: string;
  items: ReadonlyArray<{ role: SemanticColorRole; label: string }>;
  preferences: NestPreferences;
}) {
  return (
    <div>
      <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="mt-1.5 grid grid-cols-2 gap-1.5">
        {items.map(({ role, label }) => (
          <li
            key={role}
            className="flex min-w-0 items-center gap-1.5 rounded border border-border/70 bg-background/50 px-2 py-1.5"
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full border border-black/20"
              style={{ backgroundColor: preferences.colors[role] }}
            />
            <span className="truncate text-2xs text-foreground/85">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
