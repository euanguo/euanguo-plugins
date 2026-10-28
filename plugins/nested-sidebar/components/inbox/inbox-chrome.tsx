import type { ComponentProps } from "react";

import { GroupTabs } from "@/components/inbox/group-tabs";
import { PinnedSection } from "@/components/inbox/pinned-section";
import { ViewMenu } from "@/components/inbox/view-menu";
import { Icon } from "@/components/ui/icon";
import type { useViewPreferences } from "@/hooks/use-view-preferences";
import type { GroupScope, GroupTab } from "@/lib/groups";
import type { ThreadFilterPreset } from "@/lib/thread-management";
import { cn } from "@/lib/utils";

export interface InboxSelectionChrome {
  readonly active: boolean;
  readonly selectedCount: number;
  readonly selectableCount: number;
  readonly visibleCount: number;
  readonly busy: boolean;
  readonly hintId: string;
  readonly message: string | null;
  readonly outcomes: readonly {
    readonly id: string;
    readonly message: string;
    readonly failed: boolean;
  }[];
  readonly rootTitleById: ReadonlyMap<string, string>;
  readonly onBegin: () => void;
  readonly onSelectAll: () => void;
  readonly onClear: () => void;
  readonly onRequestDelete: () => void;
  readonly onCancel: () => void;
}

export interface InboxChromeProps {
  readonly announcement: string;
  readonly pinned: ComponentProps<typeof PinnedSection>;
  readonly tabs: {
    readonly items: readonly GroupTab[];
    readonly activeKey: string;
    readonly panelId: string;
    readonly onSelect: (scope: GroupScope) => void;
    readonly onManage: () => void;
  };
  readonly view: {
    readonly preferences: ReturnType<typeof useViewPreferences>;
    readonly filter: ThreadFilterPreset;
    readonly onFilterChange: (filter: ThreadFilterPreset) => void;
    readonly onCollapseAll: () => void;
    readonly onReset: () => void;
  };
  readonly selection: InboxSelectionChrome;
}

export function InboxChrome({
  announcement,
  pinned,
  tabs,
  view,
  selection,
}: InboxChromeProps) {
  return (
    <>
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </output>
      <div className="shrink-0 pl-1.5 pr-0.5">
        <PinnedSection {...pinned} />
      </div>
      <div className="shrink-0">
        <GroupTabs
          tabs={tabs.items}
          activeKey={tabs.activeKey}
          panelId={tabs.panelId}
          onSelect={tabs.onSelect}
          onManage={tabs.onManage}
        >
          {selection.active ? null : (
            <ViewMenu
              organizationMode={view.preferences.organizationMode}
              onOrganizationModeChange={
                view.preferences.setOrganizationMode
              }
              filter={view.filter}
              onFilterChange={view.onFilterChange}
              projectSort={view.preferences.projectSort}
              onProjectSortChange={view.preferences.setProjectSort}
              threadSort={view.preferences.threadSort}
              onThreadSortChange={view.preferences.setThreadSort}
              worktreeSort={view.preferences.worktreeSort}
              onWorktreeSortChange={view.preferences.setWorktreeSort}
              onCollapseAll={view.onCollapseAll}
              onResetView={view.onReset}
            />
          )}
          <button
            type="button"
            aria-label={
              selection.active ? "Thread selection active" : "Select threads"
            }
            title={
              selection.active ? "Thread selection active" : "Select threads"
            }
            disabled={selection.active}
            data-bb-icon-button=""
            onClick={selection.onBegin}
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-muted-foreground",
              "hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:bg-sidebar-accent focus-visible:text-foreground disabled:opacity-50",
              selection.active && "bg-primary/10 text-primary",
            )}
          >
            <Icon name="ListTodo" className="size-3.5" aria-hidden />
          </button>
        </GroupTabs>

        {selection.active ? (
          <SelectionBar selection={selection} />
        ) : null}

        {selection.message || selection.outcomes.length > 0 ? (
          <SelectionOutcome selection={selection} />
        ) : null}
      </div>
    </>
  );
}

function SelectionBar({ selection }: { selection: InboxSelectionChrome }) {
  return (
    <div className="flex h-8 items-center gap-1 border-y border-sidebar-border/70 px-2 text-2xs">
      <span id={selection.hintId} className="sr-only">
        Use Shift+click on another checkbox to select or deselect a range.
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        {selection.selectedCount} selected
      </span>
      <button
        type="button"
        disabled={selection.selectableCount === 0}
        title={`${Math.max(0, selection.visibleCount - selection.selectableCount)} visible protected`}
        onClick={selection.onSelectAll}
        className="h-6 rounded px-1.5 font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
      >
        All
      </button>
      <button
        type="button"
        disabled={selection.selectedCount === 0}
        onClick={selection.onClear}
        className="h-6 rounded px-1.5 font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
      >
        Clear
      </button>
      <button
        type="button"
        aria-label={`Delete ${selection.selectedCount} selected thread families`}
        title="Delete selected permanently"
        disabled={selection.selectedCount === 0 || selection.busy}
        data-bb-icon-button=""
        onClick={selection.onRequestDelete}
        className="flex size-6 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
      >
        <Icon
          name={selection.busy ? "Loading" : "Trash2"}
          className={cn(
            "size-3.5",
            selection.busy && "animate-spin motion-reduce:animate-none",
          )}
          aria-hidden
        />
      </button>
      <button
        type="button"
        aria-label="Cancel thread selection"
        title="Cancel selection"
        disabled={selection.busy}
        data-bb-icon-button=""
        onClick={selection.onCancel}
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
      >
        <Icon name="CircleX" className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function SelectionOutcome({
  selection,
}: {
  selection: InboxSelectionChrome;
}) {
  return (
    <div className="border-b border-sidebar-border/70 px-2.5 py-1 text-2xs leading-snug text-muted-foreground">
      {selection.message ? (
        <output aria-live="polite">{selection.message}</output>
      ) : null}
      {selection.outcomes.length > 0 ? (
        <ul className="mt-0.5 space-y-0.5" aria-label="Bulk delete outcomes">
          {selection.outcomes.map((outcome) => (
            <li
              key={`${outcome.id}:${outcome.message}`}
              className={cn("truncate", outcome.failed && "text-destructive")}
              title={`${selection.rootTitleById.get(outcome.id) ?? outcome.id}: ${outcome.message}`}
            >
              <span className="font-medium text-foreground/80">
                {selection.rootTitleById.get(outcome.id) ?? outcome.id}
              </span>
              {`: ${outcome.message}`}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
