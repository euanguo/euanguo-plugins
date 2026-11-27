import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { BadgeSwatch } from "@/components/ui/badge-swatch";
import { Button } from "@bb-ui/button";
import { Icon } from "@bb-ui/icon";
import { Input } from "@bb-ui/input";
import {
  type SettingsSetter,
  SettingsRowLabel,
  SettingsToggle,
} from "@/components/ui/settings-row";
import type { AppearanceValues } from "@/lib/domain/appearance";
import { MAX_PAGE_SIZE, MIN_PAGE_SIZE, resolvePageSize } from "@/lib/domain/paging";
import {
  type HarborPreferences,
  harborPreferenceStyle,
} from "@/lib/domain/preferences";
import {
  automaticProjectColor,
  projectBadgeLetter,
} from "@/lib/domain/project-colors";
import { cn } from "@/lib/ui/utils";
import type { harborRpcContract } from "@/server/contract";

export interface ThreadListPanelProps {
  values: AppearanceValues;
  preferences: HarborPreferences;
  setAppearance: SettingsSetter;
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

function SegmentedChoice<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <SettingsRowLabel label={label} hint={hint} />
      <div className="inline-flex shrink-0 items-center rounded-md border border-border/70 bg-muted/40 p-0.5">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (!active) onChange(option.value);
              }}
              className={cn(
                "rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PreviewStatusIndicator({
  mode,
  colorVar,
  label,
}: {
  mode: HarborPreferences["statusDisplay"];
  colorVar: string;
  label: string;
}) {
  if (mode === "icon") {
    return (
      <span
        aria-hidden="true"
        className="inline-flex shrink-0 items-center"
        style={{ color: colorVar }}
      >
        <Icon
          name={label === "working" ? "Loading" : "Clock"}
          className="size-3.5"
          aria-hidden
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: colorVar }}
    />
  );
}

function previewLocationText(
  mode: HarborPreferences["worktreeLabel"],
): string {
  switch (mode) {
    case "alias-over-branch":
      return "sandbox";
    case "alias-and-branch":
      return "sandbox · feat/retry-backoff";
    case "branch-only":
      return "feat/retry-backoff";
  }
}

function SidebarRowPreview({
  preferences,
}: {
  preferences: HarborPreferences;
}) {
  const sampleColor = automaticProjectColor("acme-app");
  const isDetailed = preferences.rowDensity === "detailed";
  const locationText = previewLocationText(preferences.worktreeLabel);

  return (
    <div
      data-testid="sidebar-row-preview"
      style={harborPreferenceStyle(preferences)}
      className="rounded-lg border border-border/70 bg-muted/20 p-3"
    >
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-medium uppercase tracking-wider">
          Live row preview
        </span>
        <span className="font-mono">
          {preferences.rowDensity} · {preferences.palettePreset}
        </span>
      </div>

      <div className="rounded-md border border-border/60 bg-background/90 px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          {preferences.autoProjectIcons ? (
            <BadgeSwatch
              backgroundColor={sampleColor}
              className="size-4 text-[9px]"
            >
              {projectBadgeLetter("acme-app")}
            </BadgeSwatch>
          ) : (
            <Icon name="FolderGit" className="size-3.5 text-muted-foreground" aria-hidden />
          )}
          <span>acme-app</span>
          <span className="text-muted-foreground/60">·</span>
          <span className="font-mono text-[10px]">
            {preferences.groupByRepository ? "grouped" : "flat"}
          </span>
        </div>

        <div className="group rounded px-1.5 py-1 hover:bg-muted/40">
          <div className="flex items-center gap-2">
            <PreviewStatusIndicator
              mode={preferences.statusDisplay}
              colorVar="var(--harbor-status-working)"
              label="working"
            />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              Add idempotent retry backoff to webhook worker
            </span>
            {preferences.showQuickActions ? (
              <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                <Icon name="Clock" className="size-3" aria-hidden />
                <Icon name="Archive" className="size-3" aria-hidden />
              </span>
            ) : null}
          </div>

          {isDetailed ? (
            <div className="mt-1 flex items-center gap-2 pl-4 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1 truncate font-mono">
                <Icon name="GitBranch" className="size-2.5 shrink-0" aria-hidden />
                {locationText}
              </span>
              <span className="text-muted-foreground/50">·</span>
              <span>3m</span>
              <span className="text-muted-foreground/50">·</span>
              <span style={{ color: "var(--harbor-pr-merged)" }}>PR #42</span>
            </div>
          ) : null}
        </div>

        {preferences.defaultChildrenExpanded ? (
          <div className="mt-0.5 ml-4 border-l border-border/60 pl-2.5">
            <div className="flex items-center gap-2 py-0.5 text-xs">
              <PreviewStatusIndicator
                mode={preferences.statusDisplay}
                colorVar="var(--harbor-status-waiting)"
                label="waiting"
              />
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                Verify integration tests in isolated worktree
              </span>
              {isDetailed ? (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/80">
                  1m
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ThreadListPanel({
  values,
  preferences,
  setAppearance,
}: ThreadListPanelProps) {
  const rpc = useRpc<typeof harborRpcContract>();
  const [pageSizeDraft, setPageSizeDraft] = useState(
    String(preferences.pageSize),
  );
  const [refreshingIcons, setRefreshingIcons] = useState(false);
  const [iconRefreshResult, setIconRefreshResult] = useState<string | null>(null);

  const refreshProjectIcons = async () => {
    setRefreshingIcons(true);
    setIconRefreshResult(null);
    try {
      const outcome = await rpc.call("refreshProjectIcons", {});
      const issues =
        outcome.diagnostics.length > 0
          ? ` · ${outcome.diagnostics.length} issue(s): ${outcome.diagnostics[0]}`
          : "";
      setIconRefreshResult(
        `${outcome.refreshed} refreshed · ${outcome.unchanged} unchanged${issues}`,
      );
    } catch (error) {
      setIconRefreshResult(
        error instanceof Error ? error.message : "Could not re-detect icons.",
      );
    } finally {
      setRefreshingIcons(false);
    }
  };

  useEffect(() => {
    setPageSizeDraft(String(preferences.pageSize));
  }, [preferences.pageSize]);

  const commitPageSize = (raw: string) => {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(parsed)) {
      setPageSizeDraft(String(preferences.pageSize));
      return;
    }
    const clamped = resolvePageSize(parsed);
    setPageSizeDraft(String(clamped));
    if (clamped !== preferences.pageSize) {
      setAppearance({ pageSize: clamped });
    }
  };

  return (
    <div className="space-y-6">
      <SidebarRowPreview preferences={preferences} />

      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Row Density & Layout
        </h3>
        <div className="divide-y divide-border/40">
          <SegmentedChoice
            label="Row density"
            hint="Compact fits more threads per screen; Detailed adds branch, PR, and timing metadata."
            value={preferences.rowDensity}
            options={[
              { value: "compact", label: "Compact" },
              { value: "detailed", label: "Detailed" },
            ]}
            onChange={(rowDensity) => setAppearance({ rowDensity })}
          />
          <SegmentedChoice
            label="Status indicator"
            hint="How thread run states appear beside each title."
            value={preferences.statusDisplay}
            options={[
              { value: "dot", label: "Color dot" },
              { value: "icon", label: "Icon" },
            ]}
            onChange={(statusDisplay) => setAppearance({ statusDisplay })}
          />
          <SegmentedChoice
            label="Worktree label"
            hint="How worktree aliases and branch names appear in detailed rows."
            value={preferences.worktreeLabel}
            options={[
              { value: "alias-over-branch", label: "Alias first" },
              { value: "alias-and-branch", label: "Both" },
              { value: "branch-only", label: "Branch only" },
            ]}
            onChange={(worktreeLabel) => setAppearance({ worktreeLabel })}
          />
          <SegmentedChoice
            label="Default subthreads"
            hint="Initial expansion state when threads have spawned child threads."
            value={values.defaultChildExpansion}
            options={[
              { value: "expanded", label: "Expanded" },
              { value: "collapsed", label: "Collapsed" },
            ]}
            onChange={(defaultChildExpansion) =>
              setAppearance({ defaultChildExpansion })
            }
          />
          <SettingsToggle
            label="Show quick actions"
            hint="Show pin, snooze, and settle action buttons on thread rows."
            value={preferences.showQuickActions}
            onChange={(showQuickActions) => setAppearance({ showQuickActions })}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <SettingsRowLabel
              htmlFor="harbor-page-size-input"
              label="Threads per page"
              hint={`Number of root threads shown per group (${MIN_PAGE_SIZE}–${MAX_PAGE_SIZE}).`}
            />
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-7 font-mono text-xs"
                aria-label="Decrease threads per page"
                disabled={preferences.pageSize <= MIN_PAGE_SIZE}
                onClick={() =>
                  commitPageSize(String(preferences.pageSize - 1))
                }
              >
                -
              </Button>
              <Input
                id="harbor-page-size-input"
                type="number"
                inputMode="numeric"
                min={MIN_PAGE_SIZE}
                max={MAX_PAGE_SIZE}
                value={pageSizeDraft}
                onChange={(event) => setPageSizeDraft(event.target.value)}
                onBlur={(event) => commitPageSize(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitPageSize(event.currentTarget.value);
                  }
                }}
                className="h-7 w-16 text-center font-mono text-xs"
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-7"
                aria-label="Increase threads per page"
                disabled={preferences.pageSize >= MAX_PAGE_SIZE}
                onClick={() =>
                  commitPageSize(String(preferences.pageSize + 1))
                }
              >
                <Icon name="Plus" className="size-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sidebar Behavior
        </h3>
        <div className="divide-y divide-border/40">
          <SettingsToggle
            label="Automatic project icons"
            hint="Generate monogram color badges when a project has no custom icon."
            value={preferences.autoProjectIcons}
            onChange={(autoProjectIcons) => setAppearance({ autoProjectIcons })}
          />
          <div className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-medium">Re-detect project icons</div>
              <div className="text-2xs text-muted-foreground">
                Re-read the icon file in every checkout now. Changed files
                replace their cached image; unchanged ones cost one stat.
              </div>
              {iconRefreshResult !== null ? (
                <div className="mt-1 text-2xs text-muted-foreground">
                  {iconRefreshResult}
                </div>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={refreshingIcons}
              onClick={() => void refreshProjectIcons()}
            >
              {refreshingIcons ? "Checking…" : "Re-detect"}
            </Button>
          </div>
          <SettingsToggle
            label="Group threads by repository"
            hint="Organize worktrees under shared Git repository sections."
            value={preferences.groupByRepository}
            onChange={(groupByRepository) =>
              setAppearance({ groupByRepository })
            }
          />
          <SettingsToggle
            label="Show unregistered worktrees"
            hint="Surface Git worktrees found on disk even before Harbor creates an environment."
            value={preferences.showUnregisteredWorktrees}
            onChange={(showUnregisteredWorktrees) =>
              setAppearance({ showUnregisteredWorktrees })
            }
          />
          <SegmentedChoice
            label="Workspace ownership"
            hint="Match worktrees by disk path or only workspaces explicitly claimed by bb."
            value={preferences.workspaceOwnership}
            options={[
              { value: "filesystem", label: "Filesystem" },
              { value: "claimed", label: "Claimed only" },
            ]}
            onChange={(workspaceOwnership) =>
              setAppearance({ workspaceOwnership })
            }
          />
          <SettingsToggle
            label="Show attention strip in title bar"
            hint="Display compact waiting or unread thread chips in the top app bar."
            value={preferences.showTitleAttention}
            onChange={(showTitleAttention) =>
              setAppearance({ showTitleAttention })
            }
          />
        </div>
      </section>
    </div>
  );
}
