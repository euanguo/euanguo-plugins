import { experimental_useSidebarThreads as useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CHILD_EXPANSION_OPTIONS,
  PALETTE_PRESET_OPTIONS,
  ROW_DETAIL_OPTIONS,
  ROW_LAYOUT_OPTIONS,
  STATUS_DISPLAY_OPTIONS,
  WORKSPACE_OWNERSHIP_OPTIONS,
  WORKTREE_LABEL_OPTIONS,
  nestPreferenceStyle,
  type NestPreferences,
} from "@/lib/preferences";
import { MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/lib/paging";
import type { AppearanceKey, AppearanceValues } from "@/lib/appearance";
import { useAppearance } from "@/hooks/use-appearance";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import type { WorkspaceLabelMode } from "@/lib/workspace";
import { useProjectColors } from "@/hooks/use-project-colors";
import { RepoFactsPanel } from "@/components/settings/repo-facts-panel";
import { PaletteEditor } from "@/components/settings/palette-editor";
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

type TabId = "threads" | "palette" | "projects" | "diagnostics";

const TAB_IDS: readonly TabId[] = ["threads", "palette", "projects", "diagnostics"];

/**
 * Nest's settings, in tabs.
 *
 * Tabs are only worth having once the page is the plugin's to lay out, and that
 * only became true when the appearance settings moved out of `bb.settings`: the
 * host draws one form row per descriptor above this section and the plugin
 * cannot group, reorder or collapse them, so a tab strip there would have
 * governed a fraction of a page whose top the user still had to scroll. What is
 * left in the host form now is the five agent switches — a coherent block that
 * reads as its own thing.
 *
 * The four panels are ordered by what a user comes here to change: how the list
 * reads, the colours on it, project identity, then what the machines reported.
 */
export function NestSettingsSection() {
  const { values, preferences, set } = useAppearance();
  const { projects } = useSidebarThreads();
  const projectColors = useProjectColors();
  const [tab, setTab] = useState<TabId>(() => readTab());

  const selectTab = (next: TabId) => {
    setTab(next);
    writeTab(next);
  };

  return (
    <section
      data-nest-settings-preview=""
      style={nestPreferenceStyle(preferences) as CSSProperties}
      // The card, the fill and the 12px inset are bb's own settings block:
      // `rounded-md border border-border bg-surface-recessed/70 px-3 py-3`.
      className="max-w-[760px] rounded-md border border-border bg-surface-recessed/70 px-3 py-3"
    >
      <SettingsTabs
        active={tab}
        onSelect={selectTab}
        tabs={[
          {
            id: "threads",
            label: "Thread list",
            content: (
              <ThreadListPanel
                preferences={preferences}
                values={values}
                set={set}
              />
            ),
          },
          {
            id: "palette",
            label: "Palette",
            content: (
              <PalettePanel
                values={values}
                preset={preferences.palettePreset}
                set={set}
              />
            ),
          },
          {
            id: "projects",
            label: "Projects",
            hint: `${projectColors.overrides.size}`,
            content: (
              <ProjectsPanel
                projects={projects}
                projectColors={projectColors}
                values={values}
                set={set}
              />
            ),
          },
          {
            id: "diagnostics",
            label: "Diagnostics",
            content: <RepoFactsPanel />,
          },
        ]}
      />
    </section>
  );
}

/** Which tab was open last. A settings page that forgets is a settings page you re-learn. */
const TAB_STORAGE_KEY = "bb.nest.settings.tab";

function readTab(): TabId {
  if (typeof window === "undefined") return "threads";
  try {
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    return TAB_IDS.includes(stored as TabId) ? (stored as TabId) : "threads";
  } catch {
    return "threads";
  }
}

function writeTab(tab: TabId): void {
  try {
    window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // A full or blocked store costs the memory of one choice, not the page.
  }
}

function ThreadListPanel({
  preferences,
  values,
  set,
}: {
  preferences: NestPreferences;
  values: AppearanceValues;
  set: AppearanceSetter;
}) {
  const pageSizeId = useId();
  return (
    <div className="divide-y divide-border/80">
      <div className="pb-3">
        <CurrentLayout preferences={preferences} />
      </div>

      <Choice
        label="Row layout"
        hint="Only applies when the branch or host is shown."
        value={values.rowLayout as string}
        options={ROW_LAYOUT_OPTIONS}
        onChange={(value) => set({ rowLayout: value })}
      />
      <Choice
        label="Details"
        hint="Where the branch, provider, PR, age and child count live."
        value={values.rowDetails as string}
        options={ROW_DETAIL_OPTIONS}
        onChange={(value) => set({ rowDetails: value })}
      />
      <Choice
        label="Worktree label"
        hint="How an alias and a branch share the worktree row."
        value={values.worktreeLabel as string}
        options={WORKTREE_LABEL_OPTIONS}
        onChange={(value) => set({ worktreeLabel: value })}
      />
      <Choice
        label="Status marker"
        hint="A dot is quieter; an icon is distinct per state."
        value={values.statusDisplay as string}
        options={STATUS_DISPLAY_OPTIONS}
        onChange={(value) => set({ statusDisplay: value })}
      />
      <Choice
        label="Child threads"
        hint="Search still reveals matching children."
        value={values.defaultChildExpansion as string}
        options={CHILD_EXPANSION_OPTIONS}
        onChange={(value) => set({ defaultChildExpansion: value })}
      />
      <div className="flex flex-row items-start justify-between gap-5 py-2.5">
        <RowLabel
          label="Rows per page"
          hint="Drawn at first, and added by each Load more."
          htmlFor={pageSizeId}
        />
        <Input
          id={pageSizeId}
          type="number"
          min={MIN_PAGE_SIZE}
          max={MAX_PAGE_SIZE}
          value={String(values.pageSize)}
          aria-label="Rows per page"
          className="h-7 w-16 shrink-0 text-right text-xs"
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) set({ pageSize: next });
          }}
        />
      </div>

      <div className="flex flex-col py-2.5">
        <p className="pb-1 text-2xs font-medium uppercase tracking-wide text-subtle-foreground">
          Show in the row
        </p>
        <Toggle
          label="Branch or host"
          value={values.showThreadLocation}
          onChange={(next) => set({ showThreadLocation: next })}
        />
        <Toggle
          label="Provider icons"
          value={values.showProviderIcons}
          onChange={(next) => set({ showProviderIcons: next })}
        />
        <Toggle
          label="Parent PR metadata"
          value={values.showPullRequestMetadata}
          onChange={(next) => set({ showPullRequestMetadata: next })}
        />
        <Toggle
          label="Child thread count"
          value={values.showChildCount}
          onChange={(next) => set({ showChildCount: next })}
        />
        <Toggle
          label="Relative time"
          value={values.showRelativeTime}
          onChange={(next) => set({ showRelativeTime: next })}
        />
      </div>
    </div>
  );
}

function PalettePanel({
  values,
  preset,
  set,
}: {
  values: AppearanceValues;
  preset: string;
  set: AppearanceSetter;
}) {
  return (
    <div className="divide-y divide-border/80">
      <Choice
        label="Preset"
        hint="Custom is the only preset that reads the colours below."
        value={values.palettePreset as string}
        options={PALETTE_PRESET_OPTIONS}
        onChange={(value) => set({ palettePreset: value })}
      />
      <div className="pt-3">
        <PaletteEditor
          values={values}
          preset={preset}
          // Choosing a colour is a request to see it, so the preset follows.
          // Storing one while a preset overrides it reads as a broken control.
          onChange={(patch) => set({ ...patch, palettePreset: "Custom" })}
        />
      </div>
    </div>
  );
}

function ProjectsPanel({
  projects,
  projectColors,
  values,
  set,
}: {
  projects: readonly { id: string; name: string }[];
  projectColors: ReturnType<typeof useProjectColors>;
  values: AppearanceValues;
  set: AppearanceSetter;
}) {
  return (
    <div className="divide-y divide-border/80">
      <Toggle
        label="Detect project icons"
        hint="Read a conventional favicon or logo from the checkout, on the machine that owns it."
        value={values.autoProjectIcons}
        onChange={(next) => set({ autoProjectIcons: next })}
      />
      <Choice
        label="Workspace ownership"
        hint="Filesystem keeps a checkout with its worktrees; bb claims keeps bb's filing."
        value={values.workspaceOwnership as string}
        options={WORKSPACE_OWNERSHIP_OPTIONS}
        onChange={(value) => set({ workspaceOwnership: value })}
      />
      <Toggle
        label="Show unregistered worktrees"
        hint="Worktrees the repository records but bb has no environment for. Makes them adoptable with +."
        value={values.showUnregisteredWorktrees}
        onChange={(next) => set({ showUnregisteredWorktrees: next })}
      />
      <Toggle
        label="Group by repository"
        hint="One repository as one row, by the .git its workspaces share. Off is exactly bb's own list."
        value={values.groupByRepository}
        onChange={(next) => set({ groupByRepository: next })}
      />

      <div className="py-2.5">
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

type AppearanceSetter = (patch: Partial<Record<AppearanceKey, unknown>>) => void;

/**
 * A select row, in the host settings page's own layout.
 *
 * The row is what bb's own settings sections are: a label and its supporting
 * line on the left, the control on the right, `justify-between` with a 20px
 * gap. The measurements are not a guess — they are what the host's
 * `Configuration` block computes (`flex flex-row justify-between gap-5
 * items-start`, label `text-sm font-normal text-foreground`).
 *
 * The control is the registry's `Select`, not a `<select>`: it opens in bb's
 * own popover, keeps the host's keyboard behaviour, and renders as a sheet on a
 * compact viewport, none of which a native select does.
 */
function Choice({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-row items-start justify-between gap-5 py-2.5">
      <RowLabel label={label} hint={hint} />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          aria-label={label}
          className="h-7 w-44 shrink-0 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option} className="text-xs">
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * A boolean row: the same layout, with the registry's `Switch`.
 *
 * `role="switch"` and `aria-checked` come from that component, so the state is
 * announced as a state rather than as a checked box.
 */
function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-row items-start justify-between gap-5 py-2.5">
      <RowLabel label={label} hint={hint} htmlFor={id} />
      <Switch
        id={id}
        checked={value}
        aria-label={label}
        onCheckedChange={onChange}
        className="mt-0.5"
      />
    </div>
  );
}

/**
 * The left half of a settings row.
 *
 * Two sizes, both the host's: the label is `text-sm font-normal foreground`,
 * which is what bb's own field labels compute to; the supporting line under it
 * is one step down and muted.
 */
function RowLabel({
  label,
  hint,
  htmlFor,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
}) {
  return (
    <div className="min-w-0">
      <Label
        htmlFor={htmlFor}
        className="block text-sm font-normal leading-normal text-foreground"
      >
        {label}
      </Label>
      {hint === undefined ? null : (
        <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * What the row options add up to, as the row itself rather than as a sentence
 * about the row.
 *
 * This replaced one 60-word line that ran every choice together — "Compact rows
 * · two lines · worktree labels alias over branch · dot status · …" — which is
 * a paragraph nobody finishes. The same facts fit in a mock of one row, which
 * is also the only form in which "two lines" and "one line" mean anything to
 * someone who has not already seen both.
 */
function CurrentLayout({ preferences }: { preferences: NestPreferences }) {
  const oneLine = preferences.rowLayout === "one-line";
  const hover = preferences.rowDetails === "hover";
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/70 bg-surface-recessed/60 px-2 py-2">
      <span
        aria-hidden
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded text-[9px] font-semibold text-white"
        style={{ backgroundColor: preferences.colors.unread }}
      >
        E
      </span>
      <div className="min-w-0 flex-1 text-2xs leading-relaxed text-muted-foreground">
        <p className="truncate text-xs font-medium text-foreground">
          A thread title in the row
        </p>
        <p className="truncate">
          {preferences.statusDisplay === "dot" ? "●" : "◆"}{" "}
          {preferences.showProviderIcons ? "✦ " : ""}
          {hover || preferences.rowDetails === "row-no-branch" ? null : "main · "}
          {/* "In the row, no branch" drops the machine too: the worktree row
              above already names it. */}
          {preferences.showThreadLocation &&
          !hover &&
          preferences.rowDetails === "row"
            ? "this machine · "
            : ""}
          {preferences.showPullRequestMetadata ? "PR #12 · " : ""}
          {preferences.showRelativeTime ? "2h" : ""}
          {preferences.showChildCount ? " · 2" : ""}
        </p>
        {oneLine ? null : (
          <p className="truncate text-muted-foreground/70">
            {WORKTREE_LABEL_SUMMARY[preferences.worktreeLabel]}
            {" · children "}
            {preferences.defaultChildrenExpanded ? "expanded" : "collapsed"}
            {" · "}
            {preferences.pageSize} per page
          </p>
        )}
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
    <details
      data-nest-settings-fold=""
      className="group rounded-md border border-border/70 bg-surface-recessed/60"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-2xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
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
      <div className="border-t border-border/60 p-2">{children}</div>
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
        <p className="mt-1.5 text-2xs text-warning-foreground">
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
        <p id={errorId} className="mt-1.5 text-2xs text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

