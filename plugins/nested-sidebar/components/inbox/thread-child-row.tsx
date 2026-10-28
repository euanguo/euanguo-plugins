import { useId, useState } from "react";
import {
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import { ProviderGlyph, type ProviderGlyphInfo } from "@/components/inbox/provider-glyph";
import {
  ThreadLocation,
  ThreadStateGlyph,
} from "@/components/inbox/row-controls";
import { familyStatusColor } from "@/components/inbox/family-status";
import { ThreadRowMenu } from "@/components/inbox/thread-menu-items";
import { useNestViewState } from "@/components/inbox/view-state-context";
import { Icon } from "@/components/ui/icon";
import { useListAutoAnimate } from "@/hooks/use-list-auto-animate";
import { useThreadActions } from "@/hooks/use-thread-actions";
import {
  branchHoldsThread,
  threadDisplayTitle,
  threadIsWorking,
  type FamilyBranch,
} from "@/lib/inbox";
import { familyStatusPresentation } from "@/lib/family-status";
import type { FamilyStatusPresentation } from "@/lib/family-status";
import type { NestPreferences } from "@/lib/preferences";
import { relativeTimeLabel } from "@/lib/relative-time";
import { resolveFamilyExpanded } from "@/lib/thread-management";
import { cn } from "@/lib/utils";

export function ChildThreadRow({
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
  branches: readonly FamilyBranch[];
  provider?: ProviderGlyphInfo;
  providerInfoById: ReadonlyMap<string, ProviderGlyphInfo>;
  activeThreadId: string | null;
  isActive: boolean;
  onNavigate: () => void;
  now: number;
  preferences: NestPreferences;
}) {
  const actions = useThreadActions();
  const { splitProps, isAvailable, layout } = useSidebarThreadSplit(thread.id);
  const viewState = useNestViewState();
  const attachNestedListAutoAnimateRef =
    useListAutoAnimate<HTMLUListElement>();
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const listId = useId();
  const needsYou = thread.hasPendingInteraction;
  const isWorking = !needsYou && threadIsWorking(thread);
  const showRowDetails = preferences.rowDetails !== "hover";
  const showChildLocation =
    showRowDetails &&
    preferences.showThreadLocation &&
    preferences.rowDetails !== "row-no-branch";
  const showChildTime = showRowDetails && preferences.showRelativeTime;
  const showChildProvider = showRowDetails && preferences.showProviderIcons;
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
          <a
            data-sidebar-thread-shortcut-target=""
            data-sidebar-thread-id={thread.id}
            href={thread.href}
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
                className="min-w-0 flex-1 truncate text-xs text-foreground"
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

const NEEDS_YOU_ROW_TINT = `color-mix(in srgb, ${familyStatusColor(
  familyStatusPresentation("needs-you"),
)} 12%, transparent)`;

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
