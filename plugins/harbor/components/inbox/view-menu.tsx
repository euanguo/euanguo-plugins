import { Icon } from "@bb-ui/icon";
import { cn } from "@/lib/ui/utils";
import { TOGGLE_OFF_CLASS, TOGGLE_ON_CLASS } from "@/components/inbox/control-styles";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
} from "@/components/ui/menu";
import {
  ORGANIZATION_LABELS,
  ORGANIZATION_MODES,
  validOrganizationMode,
  type OrganizationMode,
  type SidebarMode,
} from "@/lib/domain/organization";
import {
  SCOPE_STRIP_LABELS,
  SCOPE_STRIP_MODES,
  validScopeStripMode,
  type ScopeStripMode,
} from "@/lib/domain/scope-strip";
import {
  THREAD_FILTER_LABELS,
  THREAD_FILTER_PRESETS,
  type ThreadFilterPreset,
} from "@/lib/domain/thread-management";
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
} from "@/lib/domain/sort-modes";

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
  sidebarMode,
  hostCount,
  filter,
  onFilterChange,
  projectSort,
  onProjectSortChange,
  threadSort,
  onThreadSortChange,
  worktreeSort,
  onWorktreeSortChange,
  organizationMode,
  onOrganizationModeChange,
  scopeStrip,
  onScopeStripChange,
  groupByRepository,
  onGroupByRepositoryChange,
  showUnregisteredWorktrees,
  onShowUnregisteredWorktreesChange,
  onCollapseAll,
  onResetView,
}: {
  sidebarMode: SidebarMode;
  hostCount: number;
  filter: ThreadFilterPreset;
  onFilterChange: (value: ThreadFilterPreset) => void;
  projectSort: ProjectSortMode;
  onProjectSortChange: (value: ProjectSortMode) => void;
  threadSort: ThreadSortMode;
  onThreadSortChange: (value: ThreadSortMode) => void;
  worktreeSort: WorktreeSortMode;
  onWorktreeSortChange: (value: WorktreeSortMode) => void;
  organizationMode: OrganizationMode;
  onOrganizationModeChange: (value: OrganizationMode) => void;
  scopeStrip: ScopeStripMode;
  onScopeStripChange: (value: ScopeStripMode) => void;
  groupByRepository: boolean;
  onGroupByRepositoryChange: (enabled: boolean) => void;
  showUnregisteredWorktrees: boolean;
  onShowUnregisteredWorktreesChange: (enabled: boolean) => void;
  onCollapseAll: () => void;
  onResetView: () => void;
}) {
  const threadsMode = sidebarMode === "threads";
  const showMachineOption = hostCount > 1;
  const organizationModes = ORGANIZATION_MODES.filter(
    (mode) => mode !== "machine" || showMachineOption,
  );
  const showGroupByMenu = showMachineOption || organizationMode !== "project";
  const filterLabel = THREAD_FILTER_LABELS[filter];
  const projectSortLabel = PROJECT_SORT_LABELS[projectSort];
  const threadSortLabel = THREAD_SORT_LABELS[threadSort];
  const worktreeSortLabel = WORKTREE_SORT_LABELS[worktreeSort];
  const organizationLabel = ORGANIZATION_LABELS[organizationMode];
  const scopeStripLabel = SCOPE_STRIP_LABELS[scopeStrip];
  const active =
    filter !== "all" ||
    projectSort !== "manual" ||
    (threadsMode && threadSort !== "manual") ||
    worktreeSort !== "manual" ||
    organizationMode !== "project" ||
    scopeStrip !== "auto" ||
    groupByRepository ||
    showUnregisteredWorktrees;

  return (
    <Menu
      label="View options"
      trigger={
        <button
          type="button"
          aria-label={`View options. Filter ${filterLabel}; projects ${projectSortLabel};${threadsMode ? ` threads ${threadSortLabel};` : ""} worktrees ${worktreeSortLabel}; group tabs ${scopeStripLabel}.`}
          title="View options"
          data-bb-icon-button=""
          className={cn(
            "relative flex size-6 items-center justify-center rounded-md",
            // A fill, not a ring: the ring reads as a stray border on a 24px
            // square, and this trigger in particular keeps `:focus-visible`
            // after the menu closes, so the ring looked like a stuck outline.
            "focus-visible:outline-none",
            active ? TOGGLE_ON_CLASS : TOGGLE_OFF_CLASS,
          )}
        >
          <Icon name="SlidersHorizontal" className="size-3.5" aria-hidden />
          {active ? (
            <span
              aria-hidden
              className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary"
            />
          ) : null}
        </button>
      }
    >
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

      <MenuSub label="Sort projects" icon="ArrowUpDown" hint={projectSortLabel}>
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

      {threadsMode ? (
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
      ) : null}

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

      {showGroupByMenu ? (
        <MenuSub label="Group by" icon="Layers" hint={organizationLabel}>
          <MenuRadioGroup
            value={organizationMode}
            onValueChange={(next) => {
              if (validOrganizationMode(next)) onOrganizationModeChange(next);
            }}
          >
            {organizationModes.map((mode) => (
              <MenuRadioItem
                key={mode}
                value={mode}
                label={ORGANIZATION_LABELS[mode]}
              />
            ))}
          </MenuRadioGroup>
        </MenuSub>
      ) : null}

      <MenuSub label="Group tabs" icon="Layers" hint={scopeStripLabel}>
        <MenuRadioGroup
          value={scopeStrip}
          onValueChange={(next) => {
            if (validScopeStripMode(next)) onScopeStripChange(next);
          }}
        >
          {SCOPE_STRIP_MODES.map((mode) => (
            <MenuRadioItem
              key={mode}
              value={mode}
              label={SCOPE_STRIP_LABELS[mode]}
            />
          ))}
        </MenuRadioGroup>
      </MenuSub>

      <MenuSeparator />
      <MenuCheckboxItem
        label="Group by repository"
        checked={groupByRepository}
        onSelect={() => onGroupByRepositoryChange(!groupByRepository)}
      />
      <MenuCheckboxItem
        label="Show untracked worktrees"
        checked={showUnregisteredWorktrees}
        onSelect={() =>
          onShowUnregisteredWorktreesChange(!showUnregisteredWorktrees)
        }
      />

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
