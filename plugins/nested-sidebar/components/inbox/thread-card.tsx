import {
  type DragEvent,
} from "react";
import {
  experimental_useSidebarThreadPullRequest as useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { cn } from "@/lib/utils";
import { ThreadRowMenu } from "@/components/inbox/thread-menu-items";
import { useRowReveal } from "@/components/inbox/row-actions";
import {
  ProviderGlyph,
  type ProviderGlyphInfo,
} from "@/components/inbox/provider-glyph";
import {
  ParkButton,
  PinButton,
  ThreadLocation,
} from "@/components/inbox/row-controls";
import {
  StatusOrTime,
} from "@/components/inbox/status-slot";
import { PullRequestMetadata, SubagentBadge } from "@/components/inbox/row-metadata";
import {
  FamilyStatusIcon,
} from "@/components/inbox/family-status";
import { ChildThreadRow } from "@/components/inbox/thread-child-row";
import {
  ChildThreadChip,
  RootTrailingCluster,
} from "@/components/inbox/thread-row-parts";
import { familyStatusPresentation } from "@/lib/family-status";
import {
  threadDisplayTitle,
} from "@/lib/inbox";
import type { RootSelectionIntent } from "@/lib/thread-management";
import type { NestPreferences } from "@/lib/preferences";
import { resolveSnoozePresets } from "@/lib/lifecycle";
import { useThreadCardModel } from "@/hooks/use-thread-card-model";

export function ThreadCard({
  thread,
  childThreads,
  providerInfoById,
  activeThreadId,
  canPark,
  forceExpanded,
  onNavigate,
  onSettle,
  onSnooze,
  now,
  selectionMode,
  selected,
  selectionDisabledReason,
  selectionHintId,
  onToggleSelected,
  reorderEnabled,
  reorderDisabledReason,
  onMoveByKeyboard,
  onReorderDragStart,
  onReorderDragOver,
  onReorderDrop,
  preferences,
}: {
  thread: PluginSidebarThread;
  childThreads: readonly PluginSidebarThread[];
  providerInfoById: ReadonlyMap<string, ProviderGlyphInfo>;
  activeThreadId: string | null;
  /** False while the root is working or blocked on the user. */
  canPark: boolean;
  /** Search results reveal their matching descendants. */
  forceExpanded: boolean;
  onNavigate: () => void;
  onSettle: () => void;
  onSnooze: (snoozedUntil: number) => void;
  /** Quantized clock, shared by every row in one render. */
  now: number;
  selectionMode: boolean;
  selected: boolean;
  selectionDisabledReason: string | null;
  selectionHintId: string;
  onToggleSelected: (intent: RootSelectionIntent) => void;
  reorderEnabled: boolean;
  reorderDisabledReason: string | null;
  onMoveByKeyboard: (direction: -1 | 1) => void;
  onReorderDragStart: (event: DragEvent<HTMLSpanElement>) => void;
  onReorderDragOver: (event: DragEvent<HTMLLIElement>) => void;
  onReorderDrop: (event: DragEvent<HTMLLIElement>) => void;
  preferences: NestPreferences;
}) {
  const actions = useThreadActions();
  const reveal = useRowReveal<HTMLDivElement>();
  /**
   * Two different questions, and neither answers the other.
   *
   * `isAvailable` is whether an open-in-split affordance may be drawn at all:
   * false on a compact viewport, when the user has turned splits off, and for a
   * thread the host does not know. `layout` is where this thread sits right now,
   * which is what a tint reads. Gating the affordance on `layout` offered "Open in
   * split" on viewports that cannot split, and withheld it from a thread that
   * could split but is simply not in a pane yet.
   */
  const { splitProps, isAvailable, layout } = useSidebarThreadSplit(thread.id);
  const { pullRequest } = useSidebarThreadPullRequest(thread.id);
  const model = useThreadCardModel({
    thread,
    childThreads,
    providerInfoById,
    activeThreadId,
    canPark,
    forceExpanded,
    now,
    selectionMode,
    preferences,
    revealRevealed: reveal.revealed,
    hasPullRequest: pullRequest != null,
  });
  const {
    attachChildListAutoAnimateRef,
    branchLineRenders,
    branches,
    childDisclosureLabel,
    childListId,
    childProviderIds,
    childProviderNames,
    clusterRidesTheTitle,
    expanded,
    familyState,
    hasRootMetadata,
    rootIsActive,
    rowActionsRevealed,
    showRootPin,
    showRootSettleAction,
    showRootSnoozeAction,
    showRootRail,
    showRootTime,
    showRowDetails,
    showsLocation,
    toggleChildren,
    waitingForAgents,
  } = model;

  /**
   * Everything a card puts at the end of a line: the pin, the age or the action
   * group, the PR, the children chip, and the provider mark.
   *
   * One cluster, not a rail of its own. bb's card ends its branch line with
   * exactly these, right aligned on the same line as the branch, which leaves
   * the title the full width of the card above it. A second column beside the
   * two lines spent width on a vertical run of glyphs and squeezed the title
   * into whatever was left.
   *
   * At rest, the age keeps only its intrinsic width. Under the pointer, the
   * enabled actions become one in-flow group: the title yields exactly the
   * width they consume, and each target remains a separate hit area.
   */
  const togglePin = () =>
    void actions.setPinned(thread.id, !thread.isPinned);
  const rootTrailingCluster = showRootRail ? (
    <>
      {rowActionsRevealed ? (
        <span
          data-nest-root-actions=""
          role="group"
          aria-label="Thread actions"
          className="flex shrink-0 items-center gap-0.5"
        >
          {showRootPin ? (
            <PinButton
              pinned={thread.isPinned}
              onToggle={togglePin}
              className="mr-0"
            />
          ) : null}
          {showRootSnoozeAction || showRootSettleAction ? (
            <span
              data-nest-park-actions=""
              className="flex items-center gap-0.5"
            >
              {showRootSnoozeAction ? (
                <ParkButton
                  tone="snooze"
                  label="Snooze until tomorrow"
                  icon="Clock"
                  onActivate={() => {
                    const tomorrow = resolveSnoozePresets(new Date()).find(
                      (preset) => preset.id === "tomorrow",
                    );
                    if (tomorrow) onSnooze(tomorrow.snoozedUntil);
                  }}
                />
              ) : null}
              {showRootSettleAction ? (
                <ParkButton
                  tone="settle"
                  label="Settle thread"
                  icon="Archive"
                  onActivate={onSettle}
                />
              ) : null}
            </span>
          ) : null}
        </span>
      ) : (
        <>
          {showRootPin ? (
            <PinButton
              pinned={thread.isPinned}
              onToggle={togglePin}
            />
          ) : null}
          {showRootTime ? (
            <span data-nest-root-time="" className="flex h-4 items-center">
              <StatusOrTime thread={thread} now={now} />
            </span>
          ) : null}
        </>
      )}
      {hasRootMetadata ? (
        <div
          data-nest-root-metadata=""
          className="flex h-4 min-w-0 items-center gap-1 whitespace-nowrap leading-none"
        >
          {showRowDetails &&
          preferences.showPullRequestMetadata &&
          pullRequest ? (
            <PullRequestMetadata
              pullRequest={pullRequest}
              interactive={!selectionMode}
            />
          ) : null}
          {/*
            Subagents are activity on this thread, not threads under it: the
            child count is a different number, so it is a different badge —
            drawn separately, and ahead of the disclosure that controls those
            children so the two cannot be read as one figure.
          */}
          {showRowDetails && thread.activity.backgroundAgents > 0 ? (
            <SubagentBadge count={thread.activity.backgroundAgents} />
          ) : null}
          {showRowDetails &&
          childThreads.length > 0 &&
          preferences.showChildCount ? (
            <span className="group/children relative flex items-center">
              <ChildThreadChip
                threads={childThreads}
                status={familyStatusPresentation(familyState.kind)}
                expanded={expanded}
                controls={childListId}
                label={
                  selectionMode
                    ? `${childThreads.length} child threads; exit selection mode to ${expanded ? "hide" : "show"}${childProviderNames ? `; providers: ${childProviderNames}` : ""}`
                    : childDisclosureLabel
                }
                providerGlyphs={
                  preferences.showProviderIcons ? (
                    <span className="flex items-center -space-x-0.5">
                      {childProviderIds.map((providerId) => (
                        <ProviderGlyph
                          key={providerId}
                          providerId={providerId}
                          provider={providerInfoById.get(providerId)}
                          className="size-3"
                          interactive={false}
                        />
                      ))}
                    </span>
                  ) : null
                }
                disabled={selectionMode}
                onToggle={toggleChildren}
              />
              <span
                role="tooltip"
                className="pointer-events-none absolute bottom-full right-0 z-30 mb-1 w-max max-w-[min(14rem,calc(100cqw-1rem))] translate-y-0.5 rounded-md border border-border bg-popover px-2 py-1.5 text-2xs leading-tight text-popover-foreground opacity-0 shadow-md transition-all duration-150 ease-out motion-reduce:transition-none group-hover/children:translate-y-0 group-hover/children:opacity-100 group-focus-visible/children:translate-y-0 group-focus-visible/children:opacity-100"
              >
                {childDisclosureLabel}
              </span>
            </span>
          ) : showRowDetails && preferences.showProviderIcons ? (
            <ProviderGlyph
              providerId={thread.providerId}
              provider={providerInfoById.get(thread.providerId)}
              className="size-3 opacity-75"
            />
          ) : null}
        </div>
      ) : null}
    </>
  ) : null;

  return (
    <ThreadRowMenu
      thread={thread}
      expanded={expanded}
      childCount={childThreads.length}
      canToggleChildren={childThreads.length > 0}
      onToggleChildren={toggleChildren}
      onSettle={onSettle}
      onSnooze={onSnooze}
      canPark={canPark}
      splitAvailable={isAvailable}
    >
      <li
        className="list-none"
        data-nest-family={thread.id}
        onDragOver={onReorderDragOver}
        onDrop={onReorderDrop}
      >
        {/* One card, no box around it: the row is a tint that moves with
            hover and with being open, the way bb's own list does it. An
            outlined family box on top of a row that also tints read as two
            nested panels. */}
        <div
          ref={reveal.ref}
          data-nest-root-card=""
          {...reveal.handlers}
          className={cn(
            "group/root @container relative flex min-w-0 items-center gap-x-1 rounded-md pl-1.5 pr-2.5 transition-colors duration-150 ease-out motion-reduce:transition-none",
          clusterRidesTheTitle ? "min-h-5" : "min-h-10",
          "py-1",
          rootIsActive
            ? "bg-sidebar-accent"
            : "hover:bg-sidebar-accent/60",
          // A thread open in another pane gets a weaker tint than the active
          // row, so the two states stay distinguishable.
          !rootIsActive && layout !== null && "bg-sidebar-accent/30",
        )}
      >
          {selectionMode ? (
            <button
              type="button"
              data-nest-selection-target={thread.id}
              aria-label={
                selectionDisabledReason === null
                  ? `${selected ? "Deselect" : "Select"} ${threadDisplayTitle(thread)}`
                  : `${threadDisplayTitle(thread)} cannot be selected: ${selectionDisabledReason}`
              }
              aria-pressed={
                selectionDisabledReason === null ? selected : undefined
              }
              aria-describedby={
                selectionDisabledReason === null ? selectionHintId : undefined
              }
              title={
                selectionDisabledReason ?? "Shift+click to select a range"
              }
              disabled={selectionDisabledReason !== null}
              onClick={(event) => {
                onToggleSelected({
                  selected: !selected,
                  shiftKey: event.shiftKey,
                });
              }}
              className={cn(
                "absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                selectionDisabledReason === null
                  ? "cursor-pointer"
                  : "cursor-not-allowed",
              )}
            />
          ) : (
            <>
              {/* The shortcut/split contract requires an anchor, while the
                  controls remain sibling buttons above it. */}
              {/* oxlint-disable-next-line jsx-a11y/anchor-is-valid -- bb's
                  shortcut and split-drag contracts require an anchor. */}
              <a
                data-sidebar-thread-shortcut-target=""
                data-sidebar-thread-id={thread.id}
                href={thread.href}
                aria-label={threadDisplayTitle(thread)}
                aria-current={rootIsActive ? "page" : undefined}
                {...splitProps}
                onClick={(event) => {
                  // The primary click is ours: it carries the split gesture and
                  // the drawer close. The href is the host's route, so
                  // middle-click and copy-link work without this handler.
                  event.preventDefault();
                  actions.open(thread.id, {
                    split: event.metaKey || event.ctrlKey,
                  });
                  onNavigate();
                }}
                className="absolute inset-0 cursor-pointer rounded-lg"
              />
            </>
          )}

          {selectionMode ? (
            <input
              type="checkbox"
              checked={selected}
              data-nest-select-root={thread.id}
              aria-label={
                selectionDisabledReason === null
                  ? `${selected ? "Deselect" : "Select"} ${threadDisplayTitle(thread)}`
                  : `${threadDisplayTitle(thread)} cannot be selected: ${selectionDisabledReason}`
              }
              aria-describedby={
                selectionDisabledReason === null ? selectionHintId : undefined
              }
              title={
                selectionDisabledReason ?? "Shift+click to select a range"
              }
              disabled={selectionDisabledReason !== null}
              onClick={(event) => {
                event.stopPropagation();
              }}
              onChange={(event) => {
                onToggleSelected({
                  selected: event.currentTarget.checked,
                  shiftKey:
                    "shiftKey" in event.nativeEvent &&
                    event.nativeEvent.shiftKey === true,
                });
              }}
              className={cn(
                "relative z-10 size-4 shrink-0 cursor-pointer rounded border accent-primary transition-colors duration-150 ease-out motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                selectionDisabledReason !== null &&
                  "cursor-not-allowed opacity-35",
              )}
            />
          ) : null}

          {selectionMode ? null : (
            <FamilyStatusIcon
              status={familyState}
              variant={preferences.statusDisplay}
              draggable={reorderEnabled}
              reorderHelp={
                reorderEnabled
                  ? "Drag this status marker to reorder. Press Alt+Up or Alt+Down to move the family."
                  : (reorderDisabledReason ?? "Reordering is unavailable.")
              }
              onDragStart={(event) => {
                event.stopPropagation();
                if (!reorderEnabled) {
                  event.preventDefault();
                  return;
                }
                onReorderDragStart(event);
              }}
              onKeyDown={(event) => {
                if (!event.altKey) return;
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  event.stopPropagation();
                  onMoveByKeyboard(event.key === "ArrowUp" ? -1 : 1);
                }
              }}
            />
          )}

          <div
            className={cn(
              "pointer-events-none relative min-w-0 flex-1",
              clusterRidesTheTitle
                ? "flex items-center gap-1.5"
                : "self-stretch py-0.5",
            )}
          >
            <div
              data-nest-root-title-row=""
              className={cn(
                "flex h-4 min-w-0 items-center gap-1.5",
                clusterRidesTheTitle && "flex-1",
              )}
            >
              <span
                title={threadDisplayTitle(thread)}
                className={cn(
                  // One type size for a title in both layouts. bb's own card
                  // sets the title at `text-sm` and lets it lead the card; a
                  // title that changed size with the layout would read as a
                  // different list.
                  "min-w-0 flex-1 truncate text-sm text-foreground",
                )}
              >
                {threadDisplayTitle(thread)}
              </span>
              {/* One-line layout: the branch rides beside the title, so the
                  row costs a single line of height. */}
              {preferences.rowLayout === "one-line" && showsLocation ? (
                <ThreadLocation thread={thread} />
              ) : null}
              {clusterRidesTheTitle ? (
                <RootTrailingCluster interactive={!selectionMode}>
                  {rootTrailingCluster}
                </RootTrailingCluster>
              ) : null}
            </div>
            {branchLineRenders ? (
              <div
                data-nest-root-detail-row=""
                className={cn(
                  "mt-0.5 flex h-4 min-w-0 items-center gap-1.5 text-2xs",
                  familyState.receded
                    ? "text-muted-foreground/55"
                    : "text-muted-foreground",
                )}
              >
                <ThreadLocation thread={thread} />
                {/* bb's card ends its branch line with everything that is not a
                    word: the age or the park buttons, the pin, the PR, the
                    children chip, the provider mark, the row menu. Right
                    aligned and on one line, so the title owns the full width
                    above it. */}
                <RootTrailingCluster interactive={!selectionMode}>
                  {rootTrailingCluster}
                </RootTrailingCluster>
              </div>
            ) : null}
          </div>

        </div>

        {/*
          The list stays mounted and its rows come and go inside it, so the
          disclosure plays the same per-row entry and exit a loaded page does.
          The connector line and its padding belong to the expanded state: on
          a zero-height list they would paint a stub of border under the row.
        */}
          <ul
            id={childListId}
            ref={attachChildListAutoAnimateRef}
            aria-label={`Agents for ${threadDisplayTitle(thread)}`}
            className={cn(
              "ml-[14px] transition-colors duration-150 ease-out motion-reduce:transition-none",
              expanded && "border-l-[1.5px] pb-0.5 pl-3",
              expanded &&
                (waitingForAgents
                  ? "border-current"
                  : "border-sidebar-border"),
            )}
            style={
              expanded && waitingForAgents
                ? { borderColor: "var(--nest-status-working)" }
                : undefined
            }
          >
            {expanded
              ? branches.map((branch) => (
                  <ChildThreadRow
                    key={branch.thread.id}
                    thread={branch.thread}
                    branches={branch.children}
                    provider={providerInfoById.get(branch.thread.providerId)}
                    providerInfoById={providerInfoById}
                    activeThreadId={activeThreadId}
                    isActive={branch.thread.id === activeThreadId}
                    onNavigate={onNavigate}
                    now={now}
                    preferences={preferences}
                  />
                ))
              : null}
          </ul>
      </li>
    </ThreadRowMenu>
  );
}
