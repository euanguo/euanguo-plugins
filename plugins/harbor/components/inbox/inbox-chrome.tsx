import type { ComponentProps } from "react";

import { GroupTabs } from "@/components/inbox/group-tabs";
import { PinnedSection } from "@/components/inbox/pinned-section";
import { SurfaceSwitch } from "@/components/inbox/surface-switch";
import type { FamilyStatusKind } from "@/lib/domain/family-status";
import type { SidebarSurface } from "@/lib/ui/view-state";
import { ViewMenu } from "@/components/inbox/view-menu";
import { Icon } from "@/components/ui/icon";
import type { useViewPreferences } from "@/hooks/use-view-preferences";
import type { GroupScope, GroupTab } from "@/lib/domain/groups";
import type { ThreadFilterPreset } from "@/lib/domain/thread-management";
import { cn } from "@/lib/ui/utils";
import { CHROME_EDGE_CLASS } from "@/components/inbox/inbox-layout";
import { TOGGLE_OFF_CLASS, TOGGLE_ON_CLASS } from "@/components/inbox/control-styles";

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
  /** How far down the tree draws; the selection tool is a thread tool. */
  readonly firstLevel: "threads" | "workspaces";
  /** Features or projects — the destination the whole list below belongs to. */
  readonly surface: SidebarSurface;
  readonly onSurfaceChange: (surface: SidebarSurface) => void;
  /** What the Features switch says: how many, and how they are doing. */
  readonly features: {
    readonly count: number;
    readonly statusKind: FamilyStatusKind | null;
  };
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
  firstLevel,
  surface,
  onSurfaceChange,
  features,
  pinned,
  tabs,
  view,
  selection,
}: InboxChromeProps) {
  const threadsMode = firstLevel === "threads";
  const projects = surface === "projects";
  return (
    <>
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </output>
      <SurfaceSwitch
        surface={surface}
        featureCount={features.count}
        featureStatus={features.statusKind}
        panelId={tabs.panelId}
        onChange={onSurfaceChange}
      />
      {projects ? (
        <div
          className={cn(
            "shrink-0",
            threadsMode && "max-h-[38vh] overflow-y-auto pb-1.5",
            CHROME_EDGE_CLASS,
          )}
        >
          {threadsMode ? <PinnedSection {...pinned} /> : null}
        </div>
      ) : null}
      {projects ? (
        <div className="shrink-0">
          <GroupTabs
            tabs={tabs.items}
            activeKey={tabs.activeKey}
            panelId={tabs.panelId}
            onSelect={tabs.onSelect}
            onManage={tabs.onManage}
            scopeStrip={view.preferences.scopeStrip}
          >
            {selection.active ? null : (
              <ViewMenu
                filter={view.filter}
                onFilterChange={view.onFilterChange}
                projectSort={view.preferences.projectSort}
                onProjectSortChange={view.preferences.setProjectSort}
                threadSort={view.preferences.threadSort}
                onThreadSortChange={view.preferences.setThreadSort}
                worktreeSort={view.preferences.worktreeSort}
                onWorktreeSortChange={view.preferences.setWorktreeSort}
                organizationMode={view.preferences.organizationMode}
                onOrganizationModeChange={view.preferences.setOrganizationMode}
                scopeStrip={view.preferences.scopeStrip}
                onScopeStripChange={view.preferences.setScopeStrip}
                onCollapseAll={view.onCollapseAll}
                onResetView={view.onReset}
              />
            )}
            {threadsMode ? (
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
                  "flex size-6 items-center justify-center rounded-md",
                  "focus-visible:outline-none disabled:opacity-50",
                  selection.active ? TOGGLE_ON_CLASS : TOGGLE_OFF_CLASS,
                )}
              >
                <Icon name="ListTodo" className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </GroupTabs>

          {threadsMode && selection.active ? (
            <SelectionBar selection={selection} />
          ) : null}

          {selection.message || selection.outcomes.length > 0 ? (
            <SelectionOutcome selection={selection} />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function SelectionBar({ selection }: { selection: InboxSelectionChrome }) {
  return (
    <div
      className={cn(
        "flex h-8 items-center gap-1 border-y border-sidebar-border/70 text-2xs",
        CHROME_EDGE_CLASS,
      )}
    >
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
      <span aria-hidden className="mx-0.5 h-3.5 w-px shrink-0 bg-sidebar-border" />
      <button
        type="button"
        aria-label={`Delete ${selection.selectedCount} selected thread families`}
        title="Delete selected permanently"
        disabled={selection.selectedCount === 0 || selection.busy}
        data-bb-icon-button=""
        onClick={selection.onRequestDelete}
        className={cn(
          "flex size-6 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40",
          selection.selectedCount > 0
            ? "text-destructive hover:bg-destructive/10"
            : "text-muted-foreground",
        )}
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
    <div
      className={cn(
        "border-b border-sidebar-border/70 py-1 text-2xs leading-snug text-muted-foreground",
        CHROME_EDGE_CLASS,
      )}
    >
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
