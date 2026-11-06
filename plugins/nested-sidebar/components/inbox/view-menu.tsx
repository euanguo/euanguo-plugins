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
  // The organization axis is not counted: the switch at the bottom of the list
  // shows it at all times, so a dot here would be a second answer to a question
  // already on screen.
  const active =
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
          aria-label={`View options. Filter ${filterLabel}; projects ${projectSortLabel}; threads ${threadSortLabel}; worktrees ${worktreeSortLabel}.`}
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
