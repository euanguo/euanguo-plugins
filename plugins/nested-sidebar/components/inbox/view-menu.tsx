import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
} from "@/components/ui/menu";
import {
  THREAD_FILTER_LABELS,
  THREAD_FILTER_PRESETS,
  type ThreadFilterPreset,
} from "@/lib/thread-management";
import {
  ORGANIZATION_LABELS,
  ORGANIZATION_MODES,
  DEFAULT_ORGANIZATION_MODE,
  validOrganizationMode,
  type OrganizationMode,
} from "@/lib/organization";
import {
  PROJECT_SORT_LABELS,
  PROJECT_SORT_MODES,
  THREAD_SORT_LABELS,
  THREAD_SORT_MODES,
  WORKTREE_SORT_LABELS,
  WORKTREE_SORT_MODES,
  validProjectSort,
  validThreadSort,
  validWorktreeSort,
  type ProjectSortMode,
  type ThreadSortMode,
  type WorktreeSortMode,
} from "@/lib/sort-modes";

/**
 * The view menu: how the tree below is drawn.
 *
 * It replaced a plain status filter, because filtering, sorting, and folding
 * are the same kind of decision and the sidebar has room for one control. Every
 * top-level row is a submenu, and each one reports its current value on the
 * trigger, so the menu does not have to be opened to read the tree's order.
 *
 * Display toggles (row layout, which metadata shows) stay in Settings:
 * they are `bb.settings`, which the frontend can read but not write, so a menu
 * item could not change them.
 */
export function ViewMenu({
  organizationMode,
  onOrganizationModeChange,
  filter,
  onFilterChange,
  projectSort,
  onProjectSortChange,
  threadSort,
  onThreadSortChange,
  worktreeSort,
  onWorktreeSortChange,
  onCollapseAll,
  onResetView,
}: {
  organizationMode: OrganizationMode;
  onOrganizationModeChange: (value: OrganizationMode) => void;
  filter: ThreadFilterPreset;
  onFilterChange: (value: ThreadFilterPreset) => void;
  projectSort: ProjectSortMode;
  onProjectSortChange: (value: ProjectSortMode) => void;
  threadSort: ThreadSortMode;
  onThreadSortChange: (value: ThreadSortMode) => void;
  worktreeSort: WorktreeSortMode;
  onWorktreeSortChange: (value: WorktreeSortMode) => void;
  onCollapseAll: () => void;
  onResetView: () => void;
}) {
  const filterLabel = THREAD_FILTER_LABELS[filter];
  const projectSortLabel = PROJECT_SORT_LABELS[projectSort];
  const threadSortLabel = THREAD_SORT_LABELS[threadSort];
  const worktreeSortLabel = WORKTREE_SORT_LABELS[worktreeSort];
  const organizationLabel = ORGANIZATION_LABELS[organizationMode];
  const active =
    organizationMode !== DEFAULT_ORGANIZATION_MODE ||
    filter !== "all" ||
    projectSort !== "manual" ||
    threadSort !== "manual" ||
    worktreeSort !== "manual";

  return (
    <Menu
      label="View options"
      trigger={
        <button
          type="button"
          aria-label={`View options. Organize ${organizationLabel}; filter ${filterLabel}; projects ${projectSortLabel}; threads ${threadSortLabel}; worktrees ${worktreeSortLabel}.`}
          title="View options"
          data-bb-icon-button=""
          className={cn(
            "relative flex size-6 items-center justify-center rounded-md text-muted-foreground",
            "hover:bg-sidebar-accent hover:text-foreground",
            // A fill, not a ring: the ring reads as a stray border on a 24px
            // square, and this trigger in particular keeps `:focus-visible`
            // after the menu closes, so the ring looked like a stuck outline.
            "focus-visible:outline-none focus-visible:bg-sidebar-accent focus-visible:text-foreground",
            active && "bg-primary/10 text-primary",
          )}
        >
          <Icon name="Sliders" className="size-3.5" aria-hidden />
          {active ? (
            <span
              aria-hidden
              className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary"
            />
          ) : null}
        </button>
      }
    >
      {/*
        Organize leads, because it is the only row here that changes what the
        tree *is* rather than how it is read. Everything below it is a lens over
        the same rows.
      */}
      <MenuSub label="Organize" icon="Layer" hint={organizationLabel}>
        <MenuRadioGroup
          value={organizationMode}
          onValueChange={(next) => {
            if (validOrganizationMode(next)) onOrganizationModeChange(next);
          }}
        >
          {ORGANIZATION_MODES.map((mode) => (
            <MenuRadioItem
              key={mode}
              value={mode}
              label={ORGANIZATION_LABELS[mode]}
            />
          ))}
        </MenuRadioGroup>
      </MenuSub>

      <MenuSub label="Filter" icon="Filter" hint={filterLabel}>
        <MenuRadioGroup
          value={filter}
          onValueChange={(next) => {
            if (THREAD_FILTER_PRESETS.includes(next as ThreadFilterPreset)) {
              onFilterChange(next as ThreadFilterPreset);
            }
          }}
        >
          {THREAD_FILTER_PRESETS.map((preset) => (
            <MenuRadioItem
              key={preset}
              value={preset}
              label={THREAD_FILTER_LABELS[preset]}
            />
          ))}
        </MenuRadioGroup>
      </MenuSub>

      <MenuSub label="Sort projects" icon="FolderTree" hint={projectSortLabel}>
        <MenuRadioGroup
          value={projectSort}
          onValueChange={(next) => {
            if (validProjectSort(next)) onProjectSortChange(next);
          }}
        >
          {PROJECT_SORT_MODES.map((mode) => (
            <MenuRadioItem
              key={mode}
              value={mode}
              label={PROJECT_SORT_LABELS[mode]}
            />
          ))}
        </MenuRadioGroup>
      </MenuSub>

      <MenuSub label="Sort threads" icon="ListTodo" hint={threadSortLabel}>
        <MenuRadioGroup
          value={threadSort}
          onValueChange={(next) => {
            if (validThreadSort(next)) onThreadSortChange(next);
          }}
        >
          {THREAD_SORT_MODES.map((mode) => (
            <MenuRadioItem
              key={mode}
              value={mode}
              label={THREAD_SORT_LABELS[mode]}
            />
          ))}
        </MenuRadioGroup>
      </MenuSub>

      <MenuSub label="Sort worktrees" icon="GitBranch" hint={worktreeSortLabel}>
        <MenuRadioGroup
          value={worktreeSort}
          onValueChange={(next) => {
            if (validWorktreeSort(next)) onWorktreeSortChange(next);
          }}
        >
          {WORKTREE_SORT_MODES.map((mode) => (
            <MenuRadioItem
              key={mode}
              value={mode}
              label={WORKTREE_SORT_LABELS[mode]}
            />
          ))}
        </MenuRadioGroup>
      </MenuSub>

      <MenuSeparator />
      <MenuItem icon="ChevronDown" label="Collapse all" onSelect={onCollapseAll} />
      <MenuItem
        icon="ArrowTurnBackward"
        label="Reset view"
        onSelect={onResetView}
      />
    </Menu>
  );
}
