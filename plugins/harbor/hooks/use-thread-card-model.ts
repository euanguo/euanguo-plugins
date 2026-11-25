import { useCallback, useId, useMemo, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import type { ProviderGlyphInfo } from "@/components/inbox/provider-glyph";
import { useHarborViewState } from "@/components/inbox/view-state-context";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { familyWaitingForAgents } from "@/lib/domain/attention-state";
import { familyStatus } from "@/lib/domain/family-status";
import { familyBranches } from "@/lib/domain/inbox";
import type { HarborPreferences } from "@/lib/domain/preferences";
import { resolveFamilyExpanded } from "@/lib/domain/thread-management";

export function useThreadCardModel(input: {
  readonly thread: PluginSidebarThread;
  readonly childThreads: readonly PluginSidebarThread[];
  readonly providerInfoById: ReadonlyMap<string, ProviderGlyphInfo>;
  readonly activeThreadId: string | null;
  readonly canPark: boolean;
  readonly forceExpanded: boolean;
  readonly now: number;
  readonly selectionMode: boolean;
  readonly preferences: HarborPreferences;
  readonly revealRevealed: boolean;
  readonly hasPullRequest: boolean;
}) {
  const { thread, childThreads, preferences } = input;
  const childListId = useId();
  const attachChildListAutoAnimateRef =
    useListAutoAnimate<HTMLUListElement>();
  const showRowDetails = preferences.rowDetails !== "hover";
  const omitsLocation = preferences.rowDetails === "row-no-branch";
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(
    null,
  );
  const viewState = useHarborViewState();
  const storedOverride = viewState.familyOverride(thread.id);
  const branches = useMemo(
    () => familyBranches({ root: thread, children: [...childThreads] }),
    [childThreads, thread],
  );
  const expanded = resolveFamilyExpanded({
    childCount: childThreads.length,
    forceExpanded: input.forceExpanded,
    override: storedOverride ?? expandedOverride,
    defaultExpanded: preferences.defaultChildrenExpanded,
  });
  const toggleChildren = useCallback(() => {
    setExpandedOverride(!expanded);
    viewState.setFamilyOverride(thread.id, !expanded);
  }, [expanded, thread, viewState]);
  const childProviderIds = useMemo(
    () => [...new Set(childThreads.map((child) => child.providerId))].slice(0, 2),
    [childThreads],
  );
  const childProviderNames = childProviderIds
    .map(
      (providerId) =>
        input.providerInfoById.get(providerId)?.displayName ?? providerId,
    )
    .join(", ");
  const childDisclosureLabel = `${expanded ? "Hide" : "Show"} ${childThreads.length} child${childThreads.length === 1 ? " thread" : " threads"}${childProviderNames ? `; providers: ${childProviderNames}` : ""}`;
  const familyThreads = useMemo(
    () => [thread, ...childThreads],
    [thread, childThreads],
  );
  const familyState = useMemo(
    () => familyStatus(familyThreads, input.now),
    [familyThreads, input.now],
  );
  const hasRootMetadata =
    showRowDetails &&
    (thread.activity.backgroundAgents > 0 ||
      (preferences.showPullRequestMetadata && input.hasPullRequest) ||
      (childThreads.length > 0 && preferences.showChildCount) ||
      preferences.showProviderIcons);
  const rootQuickActionsAvailable =
    input.canPark &&
    !input.selectionMode &&
    showRowDetails &&
    (preferences.showPinAction ||
      preferences.showSnoozeAction ||
      preferences.showSettleAction);
  const rowActionsRevealed =
    rootQuickActionsAvailable && input.revealRevealed;
  const showRootPin =
    !input.selectionMode &&
    preferences.showPinAction &&
    (thread.isPinned || rowActionsRevealed);
  const showRootSnoozeAction =
    rowActionsRevealed && preferences.showSnoozeAction;
  const showRootSettleAction =
    rowActionsRevealed && preferences.showSettleAction;
  const showRootTime =
    preferences.showRelativeTime && showRowDetails;
  const showRootRail =
    showRootPin ||
    rootQuickActionsAvailable ||
    showRootTime ||
    hasRootMetadata;
  const showsLocation =
    showRowDetails && preferences.showThreadLocation && !omitsLocation;
  const branchLineRenders =
    preferences.rowLayout === "two-line" && showsLocation;

  const waitingForAgents = useMemo(
    () => familyWaitingForAgents(childThreads),
    [childThreads],
  );

  return useMemo(
    () => ({
      attachChildListAutoAnimateRef,
      branchLineRenders,
      branches,
      childDisclosureLabel,
      childListId,
      childProviderIds,
      childProviderNames,
      clusterRidesTheTitle: !branchLineRenders,
      expanded,
      familyState,
      hasRootMetadata,
      omitsLocation,
      rootIsActive: thread.id === input.activeThreadId,
      rowActionsRevealed,
      showRootPin,
      showRootRail,
      showRootSettleAction,
      showRootSnoozeAction,
      showRootTime,
      showRowDetails,
      showsLocation,
      toggleChildren,
      waitingForAgents,
    }),
    [
      attachChildListAutoAnimateRef,
      branchLineRenders,
      branches,
      childDisclosureLabel,
      childListId,
      childProviderIds,
      childProviderNames,
      expanded,
      familyState,
      hasRootMetadata,
      omitsLocation,
      input.activeThreadId,
      rowActionsRevealed,
      showRootPin,
      showRootRail,
      showRootSettleAction,
      showRootSnoozeAction,
      showRootTime,
      showRowDetails,
      showsLocation,
      toggleChildren,
      waitingForAgents,
    ],
  );
}
