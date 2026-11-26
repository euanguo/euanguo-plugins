import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import {
  type SettingsSetter,
  SettingsRowLabel,
} from "@/components/ui/settings-row";
import { TruncateStart } from "@/components/ui/truncate-start";
import {
  useFeatureCockpitMutations,
  useFeaturePresets,
} from "@/hooks/use-feature-cockpit";
import { errorMessage } from "@/lib/domain/errors";
import {
  canonicalPresetName,
  type FeaturePreset,
  validPresetName,
} from "@/lib/domain/feature-presets";
import { featureRootParent } from "@/lib/domain/feature-root";
import type { Feature, FeatureMember } from "@/lib/domain/features";
import {
  DEFAULT_FEATURE_BASE_BRANCH,
  DEFAULT_FEATURE_BRANCH_TEMPLATE,
  type HarborPreferences,
  normalizeFeatureBranchTemplate,
  normalizeFeatureDefaultBase,
} from "@/lib/domain/preferences";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import {
  type AgentAccessTier,
  toolsForAccessTier,
} from "@/lib/domain/agent-access";
import { cn, formatHomePathForDisplay } from "@/lib/ui/utils";

export type { AgentAccessTier };

export interface AgentAccessSectionProps {
  tier: AgentAccessTier;
  busy?: boolean;
  error?: string | null;
  onChangeTier: (tier: AgentAccessTier) => void;
}

interface TierOption {
  readonly value: AgentAccessTier;
  readonly label: string;
  readonly description: string;
  readonly badgeText: string;
  readonly badgeVariant: "secondary" | "emphasis" | "outline";
  readonly icon: IconName;
}

const TIER_OPTIONS: readonly TierOption[] = [
  {
    value: "off",
    label: "Off",
    description:
      "Agents receive no Harbor MCP tools or Harbor system instructions.",
    badgeText: "0 context",
    badgeVariant: "secondary",
    icon: "CircleX",
  },
  {
    value: "read-only",
    label: "Read-only",
    description:
      "Agents can inspect sidebar structure, feature status, and repo diagnostics without mutating state.",
    badgeText: "Recommended",
    badgeVariant: "emphasis",
    icon: "Info",
  },
  {
    value: "full",
    label: "Full control",
    description:
      "Agents can create and modify features, sidebar groups, workspace aliases, and thread state.",
    badgeText: "Writes enabled",
    badgeVariant: "outline",
    icon: "SlidersHorizontal",
  },
];

export function AgentAccessSection({
  tier,
  busy = false,
  error = null,
  onChangeTier,
}: AgentAccessSectionProps) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Agent Access
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Control how much Harbor context and tooling agents receive on every
          turn.
        </p>
      </div>

      {error !== null && error.trim().length > 0 ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-2.5 sm:grid-cols-3">
        {TIER_OPTIONS.map((option) => {
          const active = option.value === tier;
          const allowedTools = toolsForAccessTier(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              disabled={busy}
              onClick={() => {
                if (!active) onChangeTier(option.value);
              }}
              className={cn(
                "flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
                active
                  ? "border-primary bg-primary/5"
                  : "border-border/70 bg-background/60 hover:border-border hover:bg-muted/30",
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Icon
                    name={option.icon}
                    className="size-3.5 text-muted-foreground"
                    aria-hidden
                  />
                  {option.label}
                </span>
                <Pill variant={option.badgeVariant} size="sm">
                  {option.badgeText}
                </Pill>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {option.description}
              </p>
              <span className="mt-auto text-[10px] font-medium text-muted-foreground/80">
                {allowedTools.length === 0
                  ? "0 tools"
                  : `${allowedTools.length} ${allowedTools.length === 1 ? "tool" : "tools"}`}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export interface AgentFeaturesPanelProps {
  agentTier: AgentAccessTier;
  agentBusy?: boolean;
  agentError?: string | null;
  onChangeAgentTier: (tier: AgentAccessTier) => void;
  preferences: HarborPreferences;
  setAppearance: SettingsSetter;
  features: readonly Feature[];
  members: readonly FeatureMember[];
  featuresReady: boolean;
}

export function AgentFeaturesPanel({
  agentTier,
  agentBusy = false,
  agentError = null,
  onChangeAgentTier,
  preferences,
  setAppearance,
  features,
  members,
  featuresReady,
}: AgentFeaturesPanelProps) {
  const [branchDraft, setBranchDraft] = useState(
    preferences.featureBranchTemplate,
  );
  const [baseDraft, setBaseDraft] = useState(preferences.featureDefaultBase);
  const [copiedRoot, setCopiedRoot] = useState<string | null>(null);

  const presetsQuery = useFeaturePresets(true);
  const { savePreset, deletePreset } = useFeatureCockpitMutations();
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyPresetId, setBusyPresetId] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);

  useEffect(() => {
    setBranchDraft(preferences.featureBranchTemplate);
  }, [preferences.featureBranchTemplate]);

  useEffect(() => {
    setBaseDraft(preferences.featureDefaultBase);
  }, [preferences.featureDefaultBase]);

  useEffect(() => {
    if (copiedRoot === null) return;
    const handle = setTimeout(() => setCopiedRoot(null), 1800);
    return () => clearTimeout(handle);
  }, [copiedRoot]);

  const featureCounts = useMemo(() => {
    let active = 0;
    let parked = 0;
    let archived = 0;
    const roots = new Set<string>();
    for (const feature of features) {
      if (feature.state === "active") active += 1;
      else if (feature.state === "parked") parked += 1;
      else archived += 1;
      if (feature.rootPath !== null && feature.rootPath.trim().length > 0) {
        roots.add(featureRootParent(feature.rootPath));
      }
    }
    return {
      active,
      parked,
      archived,
      roots: [...roots].sort(),
    };
  }, [features]);

  const commitBranchTemplate = (raw: string) => {
    const trimmed = raw.trim();
    const next = normalizeFeatureBranchTemplate(
      trimmed.length === 0 ? DEFAULT_FEATURE_BRANCH_TEMPLATE : trimmed,
    );
    if (next === null) {
      setBranchDraft(preferences.featureBranchTemplate);
      return;
    }
    setBranchDraft(next);
    if (next !== preferences.featureBranchTemplate) {
      setAppearance({ featureBranchTemplate: next });
    }
  };

  const commitBaseBranch = (raw: string) => {
    const next = normalizeFeatureDefaultBase(raw);
    if (next === null) {
      setBaseDraft(preferences.featureDefaultBase);
      return;
    }
    setBaseDraft(next);
    if (next !== preferences.featureDefaultBase) {
      setAppearance({ featureDefaultBase: next });
    }
  };

  const handleCopyRoot = async (rootPath: string) => {
    const ok = await copyWithAnnouncement(rootPath, "Feature root path");
    if (ok) setCopiedRoot(rootPath);
  };

  const startEditingPreset = (preset: FeaturePreset) => {
    setConfirmDeleteId(null);
    setPresetError(null);
    setEditingPresetId(preset.id);
    setPresetNameDraft(preset.name);
  };

  const commitPresetRename = async (preset: FeaturePreset) => {
    const nextName = canonicalPresetName(presetNameDraft);
    if (!validPresetName(nextName)) {
      setPresetError("Preset name must be 1–60 printable characters.");
      return;
    }
    if (nextName === preset.name) {
      setEditingPresetId(null);
      return;
    }
    setBusyPresetId(preset.id);
    setPresetError(null);
    try {
      await savePreset.mutate({
        id: preset.id,
        name: nextName,
        baseBranch: preset.baseBranch || null,
        repos: preset.repos.map((repo) => ({ ...repo })),
      });
      setEditingPresetId(null);
      await presetsQuery.refetch();
    } catch (err) {
      setPresetError(errorMessage(err, "Failed to rename feature preset"));
    } finally {
      setBusyPresetId(null);
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    setBusyPresetId(presetId);
    setPresetError(null);
    try {
      await deletePreset.mutate({ id: presetId });
      setConfirmDeleteId(null);
      await presetsQuery.refetch();
    } catch (err) {
      setPresetError(errorMessage(err, "Failed to delete feature preset"));
    } finally {
      setBusyPresetId(null);
    }
  };

  const presets = presetsQuery.data?.presets ?? [];

  return (
    <div className="space-y-8">
      <AgentAccessSection
        tier={agentTier}
        busy={agentBusy}
        error={agentError}
        onChangeTier={onChangeAgentTier}
      />

      <section className="space-y-2 border-t border-border/60 pt-6">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Feature Workspace Defaults
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Applied when creating new multi-repository features from the Feature
            Hub.
          </p>
        </div>

        <div className="divide-y divide-border/40">
          <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <SettingsRowLabel
              htmlFor="harbor-feature-branch-template"
              label="Default branch template"
              hint="Supports {slug}; defaults to feat/{slug}."
            />
            <div className="flex items-center gap-1.5">
              <Input
                id="harbor-feature-branch-template"
                value={branchDraft}
                onChange={(event) => setBranchDraft(event.target.value)}
                onBlur={(event) => commitBranchTemplate(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitBranchTemplate(event.currentTarget.value);
                  }
                }}
                placeholder={DEFAULT_FEATURE_BRANCH_TEMPLATE}
                className="h-7 w-48 font-mono text-xs"
              />
              {preferences.featureBranchTemplate !==
              DEFAULT_FEATURE_BRANCH_TEMPLATE ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    commitBranchTemplate(DEFAULT_FEATURE_BRANCH_TEMPLATE)
                  }
                >
                  Reset
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <SettingsRowLabel
              htmlFor="harbor-feature-default-base"
              label="Default base branch"
              hint="Leave blank to detect each repository's HEAD or default branch."
            />
            <div className="flex items-center gap-1.5">
              <Input
                id="harbor-feature-default-base"
                value={baseDraft}
                onChange={(event) => setBaseDraft(event.target.value)}
                onBlur={(event) => commitBaseBranch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitBaseBranch(event.currentTarget.value);
                  }
                }}
                placeholder="Auto-detect"
                className="h-7 w-48 font-mono text-xs"
              />
              {preferences.featureDefaultBase !==
              DEFAULT_FEATURE_BASE_BRANCH ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => commitBaseBranch(DEFAULT_FEATURE_BASE_BRANCH)}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3 border-t border-border/60 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Feature Workspaces
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Cross-repository feature directories managed on disk.
            </p>
          </div>
          {featuresReady ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill variant="secondary" size="sm">
                {featureCounts.active} active
              </Pill>
              <Pill variant="outline" size="sm">
                {featureCounts.parked} parked
              </Pill>
              <Pill variant="outline" size="sm">
                {featureCounts.archived} archived
              </Pill>
              <Pill variant="outline" size="sm">
                {members.length} worktrees
              </Pill>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Loading...</span>
          )}
        </div>

        {featureCounts.roots.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/70 px-3 py-3 text-xs text-muted-foreground">
            Feature folders are created under your bb data directory (
            <code>harbor-features/</code>) when you create your first feature.
          </p>
        ) : (
          <div className="divide-y divide-border/40 rounded-lg border border-border/60">
            {featureCounts.roots.map((rootPath) => {
              const display = formatHomePathForDisplay(rootPath);
              const copied = copiedRoot === rootPath;
              return (
                <div
                  key={rootPath}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon
                      name="FolderGit"
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <TruncateStart
                      title={rootPath}
                      className="font-mono text-xs text-foreground"
                    >
                      {display}
                    </TruncateStart>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => void handleCopyRoot(rootPath)}
                  >
                    {copied ? (
                      <>
                        <Icon name="Check" className="mr-1 size-3" aria-hidden />
                        Copied
                      </>
                    ) : (
                      <>
                        <Icon name="Copy" className="mr-1 size-3" aria-hidden />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-2.5 border-t border-border/60 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Saved Feature Presets
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Reusable multi-repo templates saved from Feature creation or
              Workspace imports.
            </p>
          </div>
          {presets.length > 0 ? (
            <Pill variant="secondary" size="sm">
              {presets.length}
            </Pill>
          ) : null}
        </div>

        {presetError !== null ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {presetError}
          </p>
        ) : null}

        {presetsQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading presets...</p>
        ) : presetsQuery.error !== null && presetsQuery.error !== undefined ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <span>
              {errorMessage(presetsQuery.error, "Failed to load feature presets")}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 text-[11px]"
              onClick={() => void presetsQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : presets.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
            No saved feature presets yet. Save a repository selection when
            creating a feature.
          </p>
        ) : (
          <div className="divide-y divide-border/40 rounded-lg border border-border/60">
            {presets.map((preset) => {
              const isEditing = editingPresetId === preset.id;
              const isConfirmingDelete = confirmDeleteId === preset.id;
              const isBusy = busyPresetId === preset.id;

              return (
                <div
                  key={preset.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  {isEditing ? (
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <Input
                        value={presetNameDraft}
                        aria-label={`Rename preset ${preset.name}`}
                        onChange={(event) =>
                          setPresetNameDraft(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void commitPresetRename(preset);
                          } else if (event.key === "Escape") {
                            setEditingPresetId(null);
                            setPresetError(null);
                          }
                        }}
                        className="h-7 max-w-xs text-xs"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => void commitPresetRename(preset)}
                        className="h-7 px-2 text-xs"
                      >
                        <Icon name="Check" className="mr-1 size-3" aria-hidden />
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={isBusy}
                        aria-label="Cancel preset rename"
                        onClick={() => {
                          setEditingPresetId(null);
                          setPresetError(null);
                        }}
                        className="size-7"
                      >
                        <Icon name="X" className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon
                          name="Layers"
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="truncate text-xs font-medium text-foreground">
                          {preset.name}
                        </span>
                        <Pill variant="outline" size="sm">
                          {preset.repos.length}{" "}
                          {preset.repos.length === 1 ? "repo" : "repos"}
                        </Pill>
                        {preset.baseBranch !== null &&
                        preset.baseBranch.length > 0 ? (
                          <Pill variant="secondary" size="sm">
                            {preset.baseBranch}
                          </Pill>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {isConfirmingDelete ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => setConfirmDeleteId(null)}
                              className="h-7 px-2 text-xs"
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={isBusy}
                              onClick={() => void handleDeletePreset(preset.id)}
                              className="h-7 px-2 text-xs"
                            >
                              {isBusy ? "Deleting..." : "Confirm"}
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={isBusy}
                              aria-label={`Rename preset ${preset.name}`}
                              onClick={() => startEditingPreset(preset)}
                              className="h-7 px-2 text-xs"
                            >
                              Rename
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              disabled={isBusy}
                              aria-label={`Delete preset ${preset.name}`}
                              onClick={() => {
                                setEditingPresetId(null);
                                setPresetError(null);
                                setConfirmDeleteId(preset.id);
                              }}
                              className="size-7 text-muted-foreground hover:text-destructive"
                            >
                              <Icon name="Trash2" className="size-3.5" aria-hidden />
                            </Button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
