import { useId } from "react";
import { Input } from "@/components/ui/input";
import { BadgeSwatch } from "@/components/ui/badge-swatch";
import {
  SettingsChoice,
  SettingsRowLabel,
  SettingsToggle,
} from "@/components/ui/settings-row";
import {
  CHILD_EXPANSION_OPTIONS,
  ROW_DETAIL_OPTIONS,
  ROW_LAYOUT_OPTIONS,
  STATUS_DISPLAY_OPTIONS,
  WORKTREE_LABEL_OPTIONS,
  type NestPreferences,
} from "@/lib/domain/preferences";
import { MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/lib/domain/paging";
import type { AppearanceValues } from "@/lib/domain/appearance";
import type { WorkspaceLabelMode } from "@/lib/domain/workspace";
import type { SettingsSetter } from "@/components/ui/settings-row";

const WORKTREE_LABEL_SUMMARY: Readonly<Record<WorkspaceLabelMode, string>> = {
  "alias-over-branch": "alias over branch",
  "alias-and-branch": "alias + branch",
  "alias-only": "alias only",
  "branch-only": "branch only",
};

export function ThreadListPanel({
  preferences,
  values,
  set,
}: {
  preferences: NestPreferences;
  values: AppearanceValues;
  set: SettingsSetter;
}) {
  const pageSizeId = useId();
  return (
    <div>
      <div className="pb-4">
        <CurrentLayout preferences={preferences} />
      </div>
      <div className="space-y-4">
        <SettingsChoice
          label="Row layout"
          hint="Only applies when the branch or host is shown."
          value={values.rowLayout as string}
          options={ROW_LAYOUT_OPTIONS}
          onChange={(value) => set({ rowLayout: value })}
        />
        <SettingsChoice
          label="Details"
          hint="Where the branch, provider, PR, age and child count live."
          value={values.rowDetails as string}
          options={ROW_DETAIL_OPTIONS}
          onChange={(value) => set({ rowDetails: value })}
        />
        <SettingsChoice
          label="Worktree label"
          hint="How an alias and a branch share the worktree row."
          value={values.worktreeLabel as string}
          options={WORKTREE_LABEL_OPTIONS}
          onChange={(value) => set({ worktreeLabel: value })}
        />
        <SettingsChoice
          label="Status marker"
          hint="A dot is quieter; an icon is distinct per state."
          value={values.statusDisplay as string}
          options={STATUS_DISPLAY_OPTIONS}
          onChange={(value) => set({ statusDisplay: value })}
        />
        <SettingsChoice
          label="Child threads"
          hint="Search still reveals matching children."
          value={values.defaultChildExpansion as string}
          options={CHILD_EXPANSION_OPTIONS}
          onChange={(value) => set({ defaultChildExpansion: value })}
        />
        <div className="flex flex-row items-start justify-between gap-5 py-2">
          <SettingsRowLabel
            label="Rows per page"
            hint="Drawn at first, and added by each Load more."
            htmlFor={pageSizeId}
          />
          <Input
            id={pageSizeId}
            type="number"
            min={MIN_PAGE_SIZE}
            max={MAX_PAGE_SIZE}
            value={String(values.pageSize)}
            aria-label="Rows per page"
            className="h-7 w-16 shrink-0 text-right text-xs"
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (Number.isFinite(next)) set({ pageSize: next });
            }}
          />
        </div>
      </div>

      <div className="border-t border-border/80 pt-4">
        <p className="pb-1 text-2xs font-medium uppercase tracking-wide text-subtle-foreground">
          Show in the row
        </p>
        <div className="space-y-4">
          <SettingsToggle
            label="Branch or host"
            value={values.showThreadLocation}
            onChange={(next) => set({ showThreadLocation: next })}
          />
          <SettingsToggle
            label="Provider icons"
            value={values.showProviderIcons}
            onChange={(next) => set({ showProviderIcons: next })}
          />
          <SettingsToggle
            label="Parent PR metadata"
            value={values.showPullRequestMetadata}
            onChange={(next) => set({ showPullRequestMetadata: next })}
          />
          <SettingsToggle
            label="Child thread count"
            value={values.showChildCount}
            onChange={(next) => set({ showChildCount: next })}
          />
          <SettingsToggle
            label="Relative time"
            value={values.showRelativeTime}
            onChange={(next) => set({ showRelativeTime: next })}
          />
          <div className="border-t border-border/70 pt-4">
            <p className="pb-1 text-2xs font-medium uppercase tracking-wide text-subtle-foreground">
              Thread actions
            </p>
            <div className="space-y-4">
              <SettingsToggle
                label="Pin action"
                hint="Show the quick pin control on thread rows."
                value={values.showPinAction}
                onChange={(next) => set({ showPinAction: next })}
              />
              <SettingsToggle
                label="Snooze action"
                hint="Show the one-day snooze control when a thread can be parked."
                value={values.showSnoozeAction}
                onChange={(next) => set({ showSnoozeAction: next })}
              />
              <SettingsToggle
                label="Settle action"
                hint="Show the settle control when a thread can be parked."
                value={values.showSettleAction}
                onChange={(next) => set({ showSettleAction: next })}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * What the row options add up to, as the row itself rather than as a sentence
 * about the row.
 *
 * This replaced one 60-word line that ran every choice together — "Compact rows
 * · two lines · worktree labels alias over branch · dot status · …" — which is
 * a paragraph nobody finishes. The same facts fit in a mock of one row, which
 * is also the only form in which "two lines" and "one line" mean anything to
 * someone who has not already seen both.
 */
function CurrentLayout({ preferences }: { preferences: NestPreferences }) {
  const oneLine = preferences.rowLayout === "one-line";
  const hover = preferences.rowDetails === "hover";
  return (
    <div className="flex items-start gap-2 rounded border border-border/70 px-2 py-2">
      <BadgeSwatch
        backgroundColor={preferences.colors.unread}
        foregroundColor="#FFFFFF"
        className="mt-0.5 size-4 rounded border-black/20 text-[9px]"
      >
        E
      </BadgeSwatch>
      <div className="min-w-0 flex-1 text-2xs leading-relaxed text-muted-foreground">
        <p className="truncate text-xs font-medium text-foreground">
          A thread title in the row
        </p>
        <p className="truncate">
          {preferences.statusDisplay === "dot" ? "●" : "◆"}{" "}
          {preferences.showProviderIcons ? "✦ " : ""}
          {hover || preferences.rowDetails === "row-no-branch" ? null : "main · "}
          {/* "In the row, no branch" drops the machine too: the worktree row
              above already names it. */}
          {preferences.showThreadLocation &&
          !hover &&
          preferences.rowDetails === "row"
            ? "this machine · "
            : ""}
          {preferences.showPullRequestMetadata ? "PR #12 · " : ""}
          {preferences.showRelativeTime ? "2h" : ""}
          {preferences.showChildCount ? " · 2" : ""}
        </p>
        {oneLine ? null : (
          <p className="truncate text-muted-foreground/70">
            {WORKTREE_LABEL_SUMMARY[preferences.worktreeLabel]}
            {" · children "}
            {preferences.defaultChildrenExpanded ? "expanded" : "collapsed"}
            {" · "}
            {preferences.pageSize} per page
          </p>
        )}
      </div>
    </div>
  );
}
