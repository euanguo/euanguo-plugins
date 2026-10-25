import {
  Fragment,
  useId,
  useMemo,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  experimental_useSidebarThreadPullRequest as useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { ThreadRowMenu } from "@/components/inbox/thread-menu-items";
import { useRowReveal } from "@/components/inbox/row-actions";
import {
  ProviderGlyph,
  type ProviderGlyphInfo,
} from "@/components/inbox/provider-glyph";
import { StatusGlyph } from "@/components/inbox/status-glyph";
import {
  StatusOrTime,
  threadStatus,
} from "@/components/inbox/status-slot";
import { PullRequestMetadata, SubagentBadge } from "@/components/inbox/row-metadata";
import {
  FamilyStatusIcon,
  STATE_CHIP_CLASS,
  familyStatusColor,
} from "@/components/inbox/family-status";
import { DiscCluster } from "@/components/inbox/disc";
import { familyWaitingForAgents } from "@/lib/attention-state";
import { familyStatus, familyStatusPresentation } from "@/lib/family-status";
import type { FamilyStatusPresentation } from "@/lib/family-status";
import {
  branchHoldsThread,
  familyBranches,
  threadDisplayTitle,
  threadIsWorking,
  type FamilyBranch,
} from "@/lib/inbox";
import { resolveFamilyExpanded } from "@/lib/thread-management";
import type { RootSelectionIntent } from "@/lib/thread-management";
import type { NestPreferences } from "@/lib/preferences";
import { relativeTimeLabel } from "@/lib/relative-time";
import { resolveSnoozePresets } from "@/lib/lifecycle";
import { useNestViewState } from "@/components/inbox/view-state-context";
import { useThreadMenuActions } from "@/components/inbox/thread-menu-items";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import "./settle-button.css";
import "./snooze-button.css";
import "./pin-button.css";

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
  const childListId = useId();
  const attachChildListAutoAnimateRef = useListAutoAnimate<HTMLUListElement>();
  /**
   * When details live on hover, the row is a single column: title plus status,
   * nothing else. Everything suppressed here is still reachable from the hover
   * card, including the child count's own disclosure, which keeps its button in
   * the card rather than on the row.
   */
  const detailsOnHover = preferences.rowDetails === "hover";
  const showRowDetails = !detailsOnHover;
  /**
   * The row shares its branch with every other row under the same workspace, and
   * the worktree row above already names it — so this mode keeps the row's own
   * details and leaves the location out.
   */
  const omitsLocation = preferences.rowDetails === "row-no-branch";
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(
    null,
  );
  const viewState = useNestViewState();
  /**
   * The stored disclosure wins over the local one, and the preference is the
   * fallback: a family the user has never touched keeps following the setting,
   * while one they opened or closed by hand stays that way across reloads.
   */
  const storedOverride = viewState.familyOverride(thread.id);
  const effectiveOverride = storedOverride ?? expandedOverride;
  /**
   * The family as the tree it forms. `childThreads` is flat — every descendant
   * of this root — because that is the shape ordering and selection want; the
   * nesting is put back for drawing, so a child of a child is drawn under it
   * rather than beside it.
   */
  const branches = useMemo(
    () => familyBranches({ root: thread, children: [...childThreads] }),
    [thread, childThreads],
  );

  const expanded = resolveFamilyExpanded({
    childCount: childThreads.length,
    forceExpanded,
    override: effectiveOverride,
    defaultExpanded: preferences.defaultChildrenExpanded,
  });
  const toggleChildren = () => {
    setExpandedOverride(!expanded);
    viewState.setFamilyOverride(thread.id, !expanded);
  };
  const waitingForAgents = familyWaitingForAgents(childThreads);
  const childProviderIds = useMemo(
    () => [...new Set(childThreads.map((child) => child.providerId))].slice(0, 2),
    [childThreads],
  );
  const childProviderNames = childProviderIds
    .map(
      (providerId) =>
        providerInfoById.get(providerId)?.displayName ?? providerId,
    )
    .join(", ");
  const childDisclosureLabel = `${expanded ? "Hide" : "Show"} ${childThreads.length} child${childThreads.length === 1 ? " thread" : " threads"}${childProviderNames ? `; providers: ${childProviderNames}` : ""}`;
  const rootIsActive = thread.id === activeThreadId;
  const familyState = familyStatus([thread, ...childThreads], now);
  const hasRootMetadata =
    showRowDetails &&
    (thread.activity.backgroundAgents > 0 ||
      (preferences.showPullRequestMetadata && pullRequest != null) ||
      (childThreads.length > 0 && preferences.showChildCount) ||
      preferences.showProviderIcons);
  /**
   * The row's revealed actions, as one fact.
   *
   * The park pair and an unpinned pin are one set of controls that arrives
   * together or not at all: same gate, same moment. Asking "can this thread be
   * parked" is what decides whether the row offers actions at all, so a thread
   * that is working or has a hand raised shows neither — the pin it would
   * otherwise offer is in the row's menu, which is where the rest of a thread's
   * verbs live anyway. Written once so the two cannot drift apart.
   */
  const rootParkActionsAvailable =
    canPark && !selectionMode && showRowDetails;
  const rowActionsRevealed =
    rootParkActionsAvailable && reveal.revealed;
  /**
   * The pin, and when it is drawn.
   *
   * Pinned, it is a state rather than an action: it is drawn at rest, because
   * which threads are pinned is worth reading without pointing at a row, and it
   * does not take part in the reveal above.
   *
   * Unpinned, it is one of those actions, and behaves exactly like the pair it
   * arrives with — same conditions, and the same motion in `PIN_MOTION`.
   */
  const showRootPin = !selectionMode && (thread.isPinned || rowActionsRevealed);
  const showRootParkActions = rootParkActionsAvailable;
  const showRootTime =
    preferences.showRelativeTime && showRowDetails;
  const showRootRail =
    showRootPin || showRootParkActions || showRootTime || hasRootMetadata;
  /**
   * Whether the location — the branch, or the machine when there is no branch —
   * is drawn on the row at all.
   */
  const showsLocation =
    showRowDetails && preferences.showThreadLocation && !omitsLocation;
  /**
   * Whether the row's trailing cluster ends the title line, because there is no
   * branch line for it to end. Derived from the same fact as the branch line's
   * own condition, so the two cannot disagree and leave the cluster nowhere to
   * go — or a branch line with nothing in it.
   */
  const branchLineRenders =
    preferences.rowLayout === "two-line" && showsLocation;
  const clusterRidesTheTitle = !branchLineRenders;

  /**
   * Everything a card puts at the end of a line: the pin, the age or the park
   * buttons, the PR, the children chip, the provider mark, and the row menu.
   *
   * One cluster, not a rail of its own. bb's card ends its branch line with
   * exactly these, right aligned on the same line as the branch, which leaves
   * the title the full width of the card above it. A second column beside the
   * two lines spent width on a vertical run of glyphs and squeezed the title
   * into whatever was left.
   *
   * The pin leads the cluster, and holds that place in both states: it is drawn
   * whether or not the row is revealed, so pinning a thread does not move the
   * control that did it.
   */
  const rootTrailingCluster = showRootRail ? (
    <>
      {showRootPin ? (
        <PinButton
          pinned={thread.isPinned}
          onToggle={() => void actions.setPinned(thread.id, !thread.isPinned)}
        />
      ) : null}
      {showRootParkActions ? (
        <span
          data-nest-root-time=""
          className="relative flex h-4 w-10 shrink-0 items-center justify-end"
        >
          {showRootTime ? (
            <span
              className={cn(
                "flex items-center transition-opacity duration-150 motion-reduce:transition-none",
                rowActionsRevealed && "invisible",
              )}
            >
              <StatusOrTime thread={thread} now={now} />
            </span>
          ) : null}
          <span
            data-nest-park-actions=""
            className={cn(
              "absolute inset-y-0 right-0 flex items-center gap-0.5 transition-opacity duration-150 motion-reduce:transition-none",
              rowActionsRevealed ? "opacity-100" : "opacity-0",
            )}
          >
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
            <ParkButton
              tone="settle"
              label="Settle thread"
              icon="Archive"
              onActivate={onSettle}
            />
          </span>
        </span>
      ) : showRootTime ? (
        <span data-nest-root-time="" className="flex h-4 items-center">
          <StatusOrTime thread={thread} now={now} />
        </span>
      ) : null}
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
            "group/root @container relative flex min-w-0 items-center gap-x-2 rounded-md px-2.5 transition-colors duration-150 ease-out motion-reduce:transition-none",
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
                href="#"
                aria-label={threadDisplayTitle(thread)}
                aria-current={rootIsActive ? "page" : undefined}
                {...splitProps}
                onClick={(event) => {
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

function ChildThreadRow({
  thread,
  branches,
  provider,
  providerInfoById,
  activeThreadId,
  isActive,
  onNavigate,
  now,
  preferences,
}: {
  thread: PluginSidebarThread;
  /** This thread's own descendants, as the tree they form. */
  branches: readonly FamilyBranch[];
  provider?: ProviderGlyphInfo;
  /** Carried down so a grandchild draws the same glyph as its parent. */
  providerInfoById: ReadonlyMap<string, ProviderGlyphInfo>;
  /** The open thread, so a row leading to it is never the one held back. */
  activeThreadId: string | null;
  isActive: boolean;
  onNavigate: () => void;
  now: number;
  preferences: NestPreferences;
}) {
  const actions = useThreadActions();
  // `isAvailable` gates the affordance; `layout` only paints the pane tint.
  const { splitProps, isAvailable, layout } = useSidebarThreadSplit(thread.id);
  const viewState = useNestViewState();
  const attachNestedListAutoAnimateRef =
    useListAutoAnimate<HTMLUListElement>();
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const listId = useId();
  const needsYou = thread.hasPendingInteraction;
  const isWorking = !needsYou && threadIsWorking(thread);
  const showRowDetails = preferences.rowDetails !== "hover";
  /**
   * A child runs where its parent does, so its branch is the family's branch —
   * the same redundancy the "In the row, no branch" mode removes one level up.
   */
  const showChildLocation =
    showRowDetails &&
    preferences.showThreadLocation &&
    preferences.rowDetails !== "row-no-branch";
  const showChildTime = showRowDetails && preferences.showRelativeTime;
  const showChildProvider = showRowDetails && preferences.showProviderIcons;
  /**
   * This thread's own list, disclosed on its own terms.
   *
   * Same rules as the family's: the stored override wins, the preference is the
   * fallback. And the open chat is never the row held back — a row leading to
   * the thread being read draws its children whatever the setting says, which is
   * this list's version of the rule the paged lists follow.
   */
  const nestedExpanded =
    branches.some((branch) => branchHoldsThread(branch, activeThreadId)) ||
    resolveFamilyExpanded({
      childCount: branches.length,
      forceExpanded: false,
      override: viewState.familyOverride(thread.id) ?? expandedOverride,
      defaultExpanded: preferences.defaultChildrenExpanded,
    });
  const showChildRail =
    showChildTime || showChildProvider || branches.length > 0;
  /** The open row keeps its own tint: the open chat outranks a raised hand. */
  const needsYouRowTint = needsYou && !isActive && layout === null;

  return (
    <ThreadRowMenu thread={thread} splitAvailable={isAvailable}>
      <li className="relative list-none py-px">
        <span
          aria-hidden
          className={cn(
            "absolute -left-3 top-1/2 h-px w-3 transition-colors duration-150 ease-out motion-reduce:transition-none",
            !isWorking && "bg-sidebar-border",
          )}
          style={
            isWorking
              ? { backgroundColor: "var(--nest-status-working)" }
              : undefined
          }
        />
        <div
          className={cn(
            "group/child @container relative flex min-w-0 items-center gap-1.5 rounded-md px-1.5",
            "h-6",
            isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
            !isActive && layout !== null && "bg-sidebar-accent/25",
          )}
          style={
            needsYouRowTint ? { backgroundColor: NEEDS_YOU_ROW_TINT } : undefined
          }
        >
          {/* oxlint-disable-next-line jsx-a11y/anchor-is-valid -- bb's
              shortcut and split-drag contracts require an anchor. */}
          <a
            data-sidebar-thread-shortcut-target=""
            data-sidebar-thread-id={thread.id}
            href="#"
            aria-label={threadDisplayTitle(thread)}
            aria-current={isActive ? "page" : undefined}
            {...splitProps}
            onClick={(event) => {
              event.preventDefault();
              actions.open(thread.id, {
                split: event.metaKey || event.ctrlKey,
              });
              onNavigate();
            }}
            className="absolute inset-0 cursor-pointer rounded-md"
          />
          <ThreadStateGlyph thread={thread} />
          <div className="pointer-events-none relative min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                title={threadDisplayTitle(thread)}
                className={cn(
                  "min-w-0 flex-1 truncate text-xs text-foreground",
                )}
              >
                {threadDisplayTitle(thread)}
              </span>
            </div>
            {showChildLocation ? (
              <div className="mt-0.5 flex h-3.5 min-w-0 items-center gap-1.5 text-2xs">
                <ThreadLocation thread={thread} />
              </div>
            ) : null}
          </div>
          {showChildRail ? (
            <div className="relative z-10 flex shrink-0 items-center gap-1.5 leading-none">
              {needsYou ? (
                <ChildStatusFlag status={familyStatusPresentation("needs-you")} />
              ) : null}
              {isWorking ? (
                <ChildStatusFlag status={familyStatusPresentation("working")} />
              ) : null}
              {showChildTime ? (
                <span className="flex h-4 items-center font-mono tabular-nums text-2xs text-muted-foreground/60">
                  {relativeTimeLabel(thread.updatedAt, now)}
                </span>
              ) : null}
              {showChildProvider ? (
                <ProviderGlyph
                  providerId={thread.providerId}
                  provider={provider}
                />
              ) : null}
            </div>
          ) : null}
          {branches.length > 0 ? (
            <NestedDisclosure
              label={threadDisplayTitle(thread)}
              count={branches.length}
              expanded={nestedExpanded}
              controls={listId}
              onToggle={() => {
                const next = !nestedExpanded;
                setExpandedOverride(next);
                viewState.setFamilyOverride(thread.id, next);
              }}
            />
          ) : null}
        </div>
        {branches.length > 0 ? (
          <ul
            id={listId}
            ref={attachNestedListAutoAnimateRef}
            aria-label={`Agents for ${threadDisplayTitle(thread)}`}
            className={cn(
              "ml-3 flex flex-col transition-colors duration-150 ease-out motion-reduce:transition-none",
              nestedExpanded && "border-l-[1.5px] border-sidebar-border pl-2",
            )}
          >
            {nestedExpanded
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
        ) : null}
      </li>
    </ThreadRowMenu>
  );
}

/**
 * The right end of a card's line.
 *
 * `ml-auto` is what puts it there: the branch takes the width it needs and
 * truncates, and this keeps its natural width at the far end of the same line.
 * `z-10` lifts its controls above the row's full-bleed anchor, which is
 * otherwise the topmost thing on the row.
 */
function RootTrailingCluster({
  interactive,
  children,
}: {
  interactive: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "relative z-10 ml-auto flex shrink-0 items-center gap-1.5",
        // The line around this cluster is `pointer-events-none`, so the row's
        // full-bleed anchor stays the thing a click lands on. A control inside
        // has to opt back in, or it is decoration.
        interactive ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      {children}
    </span>
  );
}

/**
 * A child row's verdict, in words rather than a glyph.
 *
 * The shape is BB Sidebar's (`src/ChildThreadList.tsx`, `ChildStatusFlag`): a
 * small uppercase flag on a tinted ground. The tint is NOT bb's, though — bb
 * hard-codes Tailwind hues, and Nest's palette is the user's to choose, so the
 * ground is `bg-current/10` over the status's own colour, the same way
 * `FamilyStatusBadge` draws one. A hard-coded sky would ignore a custom palette.
 */
function ChildStatusFlag({ status }: { status: FamilyStatusPresentation }) {
  return (
    <span
      data-nest-child-status={status.kind}
      className="shrink-0 rounded bg-current/10 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-[0.08em]"
      style={{ color: familyStatusColor(status) }}
    >
      {status.label}
    </span>
  );
}

/**
 * The ground under a child row that is waiting on the user.
 *
 * Mixed from the palette for the same reason the flag above is: bb paints this
 * row amber, and a user who has recoloured "Stalled / waiting" would get an
 * amber row under a purple flag.
 */
const NEEDS_YOU_ROW_TINT = `color-mix(in srgb, ${familyStatusColor(
  familyStatusPresentation("needs-you"),
)} 12%, transparent)`;

/**
 * The card's disclosure: the children it holds, as a chip.
 *
 * BB Sidebar's `ChildThreadBadge` (`src/ChildThreadList.tsx`) is the shape — a
 * rounded chip carrying the children's dots, their count and a chevron, tinted
 * by the state the subtree is in. Nest keeps its provider glyphs inside it
 * (bb shows those elsewhere), and tints it from the palette rather than from
 * Tailwind hues, for the reason `ChildStatusFlag` gives.
 */
function ChildThreadChip({
  threads,
  status,
  expanded,
  controls,
  label,
  providerGlyphs,
  disabled,
  onToggle,
}: {
  threads: readonly PluginSidebarThread[];
  status: FamilyStatusPresentation;
  expanded: boolean;
  controls: string;
  label: string;
  providerGlyphs: ReactNode;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-nest-child-status={status.kind}
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        STATE_CHIP_CLASS,
        // The row's own group, for the chip's tooltip. Everything visible is the
        // shared ground above.
        "group/children relative",
        "outline-none transition-colors duration-150 ease-out hover:bg-current/20 focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none",
        disabled && "pointer-events-none",
      )}
      style={{ color: familyStatusColor(status) }}
    >
      <DiscCluster threads={threads} compact />
      <span className="tabular-nums">{threads.length}</span>
      {providerGlyphs}
      <Icon
        name="ChevronDown"
        className={cn(
          "size-3 transition-transform duration-150 ease-out motion-reduce:transition-none",
          expanded && "rotate-180",
        )}
        aria-hidden
      />
    </button>
  );
}

/**
 * The control that opens a child's own children.
 *
 * Ported from BB Sidebar (`src/ChildThreadList.tsx`,
 * `GrandchildDisclosureButton`). It sits after the row's click target rather
 * than inside it, so asking to see one more level never opens the thread by
 * accident, and it names its count because that is the whole of what it decides.
 */
function NestedDisclosure({
  label,
  count,
  expanded,
  controls,
  onToggle,
}: {
  label: string;
  count: number;
  expanded: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const noun = `child thread${count === 1 ? "" : "s"}`;
  const label2 = `${expanded ? "Hide" : "Show"} ${count} ${noun}`;
  return (
    <button
      type="button"
      title={`${label2} for ${label}`}
      aria-label={`${label2} for ${label}`}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className="relative z-10 mr-0.5 flex h-5 shrink-0 items-center gap-0.5 rounded px-1 font-mono text-2xs tabular-nums text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span>{count}</span>
      <Icon
        name={expanded ? "ChevronUp" : "ChevronDown"}
        className="size-3"
        aria-hidden
      />
    </button>
  );
}

function ThreadStateGlyph({
  thread,
  className,
}: {
  thread: PluginSidebarThread;
  className?: string;
}) {
  const status = threadStatus(thread);
  const label =
    status === null
      ? "Inactive: no active work in this child thread"
      : `${thread.indicatorLabel ?? status.label}: child thread status`;

  const glyph =
    status === null ? (
      <span
        aria-hidden
        className="size-2 rounded-full opacity-50"
        style={{
          backgroundColor:
            "var(--nest-status-inactive, var(--muted-foreground))",
        }}
      />
    ) : (
      <StatusGlyph indicator={status.indicator} label={null} />
    );

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      tabIndex={0}
      className={cn(
        "group/child-status flex size-3.5 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      {glyph}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 w-max max-w-[min(14rem,calc(100cqw-1rem))] translate-y-0.5 rounded-md border border-border bg-popover px-2 py-1.5 text-2xs leading-tight text-popover-foreground opacity-0 shadow-md transition-all duration-150 ease-out motion-reduce:transition-none group-hover/child-status:translate-y-0 group-hover/child-status:opacity-100 group-focus-visible/child-status:translate-y-0 group-focus-visible/child-status:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

function ThreadLocation({ thread }: { thread: PluginSidebarThread }) {
  const branch = thread.environment?.branchName;
  if (branch) {
    // A worktree's branch is a branch of the project; a thread running in the
    // project's own checkout is on the project's branch. The worktree row above
    // draws its branch line with the same two icons, so the mark means the same
    // thing at both levels.
    const displayKind = thread.environment?.workspaceDisplayKind;
    const isWorktree =
      displayKind === "managed-worktree" || displayKind === "unmanaged-worktree";
    return (
      <span
        title={`Branch: ${branch}`}
        // Carries its own size rather than inheriting: in the one-line layout
        // this sits in the title row, which has no type size of its own, and an
        // inherited 14px branch read as the largest thing on the row.
        className="flex min-w-0 flex-1 items-center gap-1 truncate text-2xs text-muted-foreground"
      >
        <Icon
          name={isWorktree ? "FolderGit" : "GitBranch"}
          aria-label={isWorktree ? "Worktree branch" : "Branch"}
          className="size-3 shrink-0 text-muted-foreground/60"
        />
        <span className="truncate font-mono">{branch}</span>
      </span>
    );
  }
  if (thread.host) {
    return (
      <span
        title={`Host: ${thread.host.name}`}
        className="min-w-0 flex-1 truncate text-2xs text-muted-foreground"
      >
        {thread.host.name}
      </span>
    );
  }
  return <span className="flex-1" />;
}

/**
 * The two park controls' own motion, in one place.
 *
 * Both lift their artwork and light a tinted ground, because they are a pair;
 * what happens next is what tells them apart, and it is the whole point of each
 * control. Settling is over — five sparkles, emerald. Snoozing is later — the
 * clock nods and three marks drift off it, violet, and deliberately quieter than
 * the five the settle spends. The colours are written down rather than read from
 * the palette; `snooze-button.css` says why, and why neither is the sky the
 * working state already uses.
 *
 * Every class here is a literal string so the build can see it.
 */
const PARK_TONES = {
  settle: {
    button: cn(
      "nest-settle group/settle relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md",
      "transition-colors duration-200 ease-out hover:text-emerald-700 dark:hover:text-emerald-300",
      "focus-visible:text-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500/50 dark:focus-visible:text-emerald-300",
      "motion-reduce:transition-none",
    ),
    ground: cn(
      "group-hover/settle:bg-emerald-500/15 group-hover/settle:shadow-[0_0_0_3px_rgb(16_185_129_/_0.08)] group-focus-visible/settle:bg-emerald-500/15",
      "motion-safe:group-hover/settle:-translate-y-0.5 motion-safe:group-focus-visible/settle:-translate-y-0.5 motion-safe:group-active/settle:translate-y-0 motion-safe:group-active/settle:scale-90 group-active/settle:bg-emerald-500/25",
    ),
    icon:
      "motion-safe:group-hover/settle:rotate-[-8deg] motion-safe:group-hover/settle:scale-110 motion-safe:group-focus-visible/settle:rotate-[-8deg] motion-safe:group-focus-visible/settle:scale-110",
  },
  snooze: {
    button: cn(
      "nest-snooze group/snooze relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md",
      "transition-colors duration-200 ease-out hover:text-violet-700 dark:hover:text-violet-300",
      "focus-visible:text-violet-700 focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:focus-visible:text-violet-300",
      "motion-reduce:transition-none",
    ),
    ground: cn(
      "group-hover/snooze:bg-violet-500/15 group-hover/snooze:shadow-[0_0_0_3px_rgb(139_92_246_/_0.08)] group-focus-visible/snooze:bg-violet-500/15",
      "motion-safe:group-hover/snooze:-translate-y-0.5 motion-safe:group-focus-visible/snooze:-translate-y-0.5 motion-safe:group-active/snooze:translate-y-0 motion-safe:group-active/snooze:scale-90 group-active/snooze:bg-violet-500/25",
    ),
    // The nod is a keyframe, not a transform: it plays once per hover and holds
    // its last frame, which a utility class cannot express. So this button's
    // icon carries no rotate or scale of its own to fight it.
    icon: "",
  },
} as const;

function ParkButton({
  tone,
  label,
  icon,
  onActivate,
}: {
  /** Which of the two park acts this is, and therefore which effect it plays. */
  tone: keyof typeof PARK_TONES;
  label: string;
  icon: Extract<IconName, "Archive" | "Clock">;
  onActivate: () => void;
}) {
  const { button, ground, icon: iconMotion } = PARK_TONES[tone];
  const scope = tone === "settle" ? "settle" : "snooze";
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      }}
      className={button}
    >
      {/* Move only the artwork so hovering an edge cannot move the hit area. */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none relative flex size-full items-center justify-center rounded-[inherit]",
          "transition-[background-color,box-shadow,transform] duration-200 ease-out motion-reduce:transition-none",
          ground,
        )}
      >
        <Icon
          name={icon}
          className={cn(
            "size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none",
            tone === "snooze" && "nest-snooze-hand",
            iconMotion,
          )}
        />
        {tone === "settle"
          ? [0, 1, 2, 3, 4].map((sparkle) => (
              <span
                key={sparkle}
                aria-hidden="true"
                className="nest-settle-sparkle"
              />
            ))
          : // The marks that drift off it. They take the button's own hover
            // tint through `currentColor`, so they cannot drift from the icon.
            [0, 1, 2].map((mark) => (
              <span
                key={mark}
                aria-hidden="true"
                className="nest-snooze-z"
              >
                z
              </span>
            ))}
      </span>
      <ControlTooltip label={label} scope={scope} />
    </button>
  );
}

/**
 * The pin, as a control rather than a mark.
 *
 * The state is the glyph — solid when the thread is pinned, outlined when it is
 * not — and the press is its toggle, so unpinning is one click on the thing that
 * says pinned. **The colour never carries the state.** It wears exactly what the
 * park buttons beside it wear, so the three read as one row of controls, and the
 * fill is what says which of the two states this one is in. An earlier version
 * drew the unpinned pin a shade lighter and it read as a *disabled* control
 * rather than as a different state of the same one.
 *
 * It is two controls wearing one glyph. **Unpinned it is an action**, one of the
 * three the row reveals under the pointer, and it moves like the other two —
 * same target, same lift, same tinted ground, and an effect of its own in
 * `pin-button.css`. **Pinned it is a state**, drawn at rest, and it moves like
 * nothing at all: a pin that is holding a thread in place should not dance when
 * the pointer passes over it.
 *
 * The 20px target is padding around a 14px glyph, and the 3px on the side facing
 * the next control would be read as space: the cluster's own gap is 6px, so the
 * glyph would sit 9px from the age — and 12px from the snooze button that takes
 * the age's place under the pointer — while the controls around it sit 6px and
 * 8px apart. So the button hands its own inset back on that one side. Trimming
 * the other side would change nothing at all: the cluster is right aligned, and
 * the leading edge of its first child is not what separates anything.
 */
const PIN_MOTION = {
  button: cn(
    "nest-pin group/pin cursor-pointer",
    "focus-visible:text-foreground",
    "focus-visible:ring-2 focus-visible:ring-ring",
  ),
  ground: cn(
    // The tint and its halo are declared in `pin-button.css`, not as a
    // `bg-current/10` variant: Tailwind compiles that variant to a *solid*
    // `background-color: currentColor`, which would be a grey disc where the
    // park pair's grounds are a 15% wash. The lift is a utility because it is
    // the one part that has to sit behind `motion-safe:`.
    "nest-pin-ground",
    "motion-safe:group-hover/pin:-translate-y-0.5 motion-safe:group-focus-visible/pin:-translate-y-0.5",
    "motion-safe:group-active/pin:translate-y-0 motion-safe:group-active/pin:scale-90",
  ),
} as const;

function PinButton({
  pinned,
  onToggle,
}: {
  pinned: boolean;
  onToggle: () => void;
}) {
  const label = pinned ? "Unpin thread" : "Pin thread";
  return (
    <button
      type="button"
      data-nest-pin={pinned ? "pinned" : "unpinned"}
      aria-label={label}
      // A toggle, not a one-way action: the button reports the state it holds.
      aria-pressed={pinned}
      onClick={(event) => {
        // The row's full-bleed anchor sits underneath, so both of these are
        // load-bearing: without them a pin also opens the thread.
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "relative z-10 -mr-[3px] flex size-5 shrink-0 items-center justify-center rounded-md",
        "transition-colors duration-150 ease-out motion-reduce:transition-none",
        "focus-visible:outline-none",
        pinned
          ? // A state, not an action: it never lifts, tints, presses or bites —
            // it answers the pointer with colour and nothing else.
            "hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          : cn("hover:text-foreground", PIN_MOTION.button),
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none relative flex size-full items-center justify-center rounded-[inherit]",
          // Move only the artwork, so hovering an edge cannot move the hit area.
          // The pinned pin has no ground to move at all.
          !pinned &&
            cn(
              "transition-[background-color,box-shadow,transform] duration-200 ease-out motion-reduce:transition-none",
              PIN_MOTION.ground,
            ),
        )}
      >
        <Icon
          name={pinned ? "PinFilled" : "Pin"}
          className={cn(
            "size-3.5",
            !pinned &&
              "nest-pin-seat transition-transform duration-200 ease-out motion-reduce:transition-none",
          )}
          aria-hidden
        />
        {pinned
          ? null
          : // The P's the pin leaves behind as it turns in: three of them, each
            // with its own delay and its own path — the construction the park
            // pair's effects use, and the shortest of the three. A letter, like
            // the snooze's `z`: that pair of marks says *which* act this is
            // without a legend, where a ring or a dot says only "something
            // happened here".
            [0, 1, 2].map((mark) => (
              <span key={mark} aria-hidden="true" className="nest-pin-mark">
                P
              </span>
            ))}
      </span>
      <ControlTooltip label={label} scope="pin" />
    </button>
  );
}

/**
 * One hover/focus label for the row's controls.
 *
 * Native `title` tooltips arrive on the platform's timer and cannot be styled,
 * so the pin, snooze and settle buttons use the same drawn bubble as the
 * provider glyph. Each control owns its group name, so a label never depends on
 * whichever ancestor happened to be hovered.
 */
function ControlTooltip({
  label,
  scope,
}: {
  label: string;
  scope: "pin" | "snooze" | "settle";
}) {
  return (
    <span
      role="tooltip"
      className={cn(
        "pointer-events-none absolute bottom-full right-0 z-40 mb-1 w-max max-w-[min(12rem,calc(100cqw-1rem))] translate-y-0.5 rounded-md border border-border bg-popover px-2 py-1 text-2xs text-popover-foreground opacity-0 shadow-md transition-all duration-150 ease-out motion-reduce:transition-none",
        scope === "pin" &&
          "group-hover/pin:translate-y-0 group-hover/pin:opacity-100 group-focus/pin:translate-y-0 group-focus/pin:opacity-100",
        scope === "snooze" &&
          "group-hover/snooze:translate-y-0 group-hover/snooze:opacity-100 group-focus/snooze:translate-y-0 group-focus/snooze:opacity-100",
        scope === "settle" &&
          "group-hover/settle:translate-y-0 group-hover/settle:opacity-100 group-focus/settle:translate-y-0 group-focus/settle:opacity-100",
      )}
    >
      {label}
    </span>
  );
}
