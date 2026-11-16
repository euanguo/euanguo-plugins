import { useRef, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { GroupBadge } from "@/components/ui/group-badge";
import { cn } from "@/lib/ui/utils";
import { CHROME_EDGE_CLASS } from "@/components/inbox/inbox-layout";
import { ScrollStrip } from "@/components/ui/scroll-strip";
import { StatusDot } from "@/components/inbox/family-status";
import { familyStatusPresentation } from "@/lib/domain/family-status";
import type { ScopeStripMode } from "@/lib/domain/scope-strip";
import { useScopeStripFit } from "@/hooks/use-scope-strip-fit";
import {
  groupScopeKey,
  type GroupScope,
  type GroupTab,
} from "@/lib/domain/groups";

/**
 * The label layout of one tab, shared by the strip and the layer that measures
 * it. The two have to agree on what a label costs — including the status dot —
 * or the measurement decides for a strip that is not the one being drawn.
 */
const LABEL_TAB_CLASS =
  "flex h-6.5 max-w-[9rem] items-center gap-1.5 rounded-md px-1.5 text-2xs";

const COMPACT_TAB_CLASS =
  "relative flex size-6 items-center justify-center rounded-md px-1 text-2xs";

/**
 * The horizontal scope strip above the tree.
 *
 * It is a scope selector, not a second tree: picking a group narrows what the
 * tree below draws, and projects are still the first level inside it.
 *
 * Sizing is deliberate. These are the coarsest destination in the sidebar, so
 * they are one step larger than the rows beneath them (`h-7` / `text-xs`
 * against the rows' `text-2xs` metadata) — which also makes the strip the
 * natural reading order: scope, then project, then thread.
 *
 * The strip scrolls sideways rather than wrapping, because with many groups a
 * wrapped strip would push the actual thread list off screen. It hands that
 * scrolling to `ScrollStrip`, which keeps the bar hidden and fades whichever
 * edge still hides a tab, so the strip's height never changes.
 *
 * With many groups and a narrow sidebar the names stop fitting, and the strip
 * falls back to a letter tile per scope. Which of the two is drawn is decided in
 * `useScopeStripFit` from a layer that always lays the names out, so the answer
 * does not depend on what is on screen — and the user can rule the fallback out
 * entirely by asking for names (`scopeStrip`).
 */
export function GroupTabs({
  tabs,
  activeKey,
  panelId,
  onSelect,
  onManage,
  scopeStrip,
  leading,
  children,
}: {
  tabs: readonly GroupTab[];
  activeKey: string;
  onSelect: (scope: GroupScope) => void;
  onManage: () => void;
  /** Whether the strip may fall back to tiles, or must keep the names. */
  scopeStrip: ScopeStripMode;
  /**
   * Trailing controls for the strip. The project count and these actions used
   * to sit on their own "PROJECTS" row below the tabs, which repeated what the
   * tab counts already say; folding them in here gives the thread list that
   * row back.
   */
  /**
   * Drawn before the tabs. The feature view has no scope strip, so this is
   * where its feature selector sits.
   */
  leading?: ReactNode;
  children?: ReactNode;
  /** Id of the element the tabs control — the tree below the strip. */
  panelId: string;
}) {
  const stripBox = useRef<HTMLDivElement>(null);
  const stripProbe = useRef<HTMLDivElement>(null);
  const layout = useScopeStripFit({
    box: stripBox,
    probe: stripProbe,
    enabled: scopeStrip === "auto",
  });
  const compact = layout === "compact";
  const tabId = (key: string) => `${panelId}-tab-${encodeURIComponent(key)}`;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1 pb-1",
        CHROME_EDGE_CLASS,
      )}
    >
      {leading}
      <div ref={stripBox} className="relative min-w-0 flex-1">
        <ScrollStrip
          role="tablist"
          aria-label="Project groups"
          className="flex w-full items-center gap-1 overflow-x-auto"
        >
          {tabs.map((tab) => {
            const key = groupScopeKey(tab.scope);
            const selected = key === activeKey;
            return (
              <span key={key} className="shrink-0">
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  // A `role="tab"` without a `tabpanel` to point at is a tab
                  // with no panel: screen readers announce it as an unassociated
                  // control and the arrow-key model has nowhere to go. The tree
                  // below is that panel — the strip narrows what it draws — so
                  // the two are wired together rather than left as loose roles.
                  aria-controls={panelId}
                  id={tabId(key)}
                  onClick={() => onSelect(tab.scope)}
                  title={tab.label}
                  data-bb-icon-button={compact ? "" : undefined}
                  className={cn(
                    compact ? COMPACT_TAB_CLASS : LABEL_TAB_CLASS,
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    selected
                      ? "bg-sidebar-accent text-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  {compact ? (
                    <>
                      <GroupBadge
                        name={tab.label}
                        seed={key}
                        className="size-4 text-[0.625rem]"
                      />
                      {tab.statusKind === null ? null : (
                        <span className="absolute right-0.5 top-0.5 flex shrink-0 items-center">
                          <StatusDot
                            status={familyStatusPresentation(tab.statusKind)}
                          />
                        </span>
                      )}
                    </>
                  ) : (
                    <TabLabel tab={tab} />
                  )}
                </button>
              </span>
            );
          })}
        </ScrollStrip>
        {/*
         * The width the names ask for, laid out off to the side and never seen.
         * It draws the same tab labels whether the strip is showing names or
         * tiles, which is what lets the strip decide from a number that its own
         * rendering cannot move.
         */}
        <div
          aria-hidden
          className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
        >
          <div ref={stripProbe} className="flex w-max items-center gap-1">
            {tabs.map((tab) => (
              <span key={groupScopeKey(tab.scope)} className={LABEL_TAB_CLASS}>
                <TabLabel tab={tab} />
              </span>
            ))}
          </div>
        </div>
      </div>
      {children === undefined ? null : (
        <span className="flex shrink-0 items-center gap-0.5">{children}</span>
      )}
      <button
        type="button"
        aria-label="Manage groups"
        title="Manage groups"
        onClick={onManage}
        data-bb-icon-button=""
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground",
          "hover:bg-sidebar-accent hover:text-foreground",
          "focus-visible:outline-none focus-visible:bg-sidebar-accent focus-visible:text-foreground",
        )}
      >
        <Icon name="Folder02" className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** One tab's label and its activity dot, as it is drawn when names fit. */
function TabLabel({ tab }: { tab: GroupTab }) {
  return (
    <>
      <span className="truncate">{tab.label}</span>
      {tab.statusKind === null ? null : (
        <span className="flex shrink-0 items-center">
          <StatusDot status={familyStatusPresentation(tab.statusKind)} />
        </span>
      )}
    </>
  );
}
