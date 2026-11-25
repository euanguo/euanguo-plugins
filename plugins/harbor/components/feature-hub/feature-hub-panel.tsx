import { useEffect, useRef, useState } from "react";
import {
  type ExperimentalThreadTabProps,
  experimental_useFixedTabTarget as useFixedTabTarget,
} from "@get-bb/plugin-sdk/app";

import { FeatureHubChanges } from "@/components/feature-hub/feature-hub-changes";
import { FeatureHubDecisions } from "@/components/feature-hub/feature-hub-decisions";
import { FeatureHubOverview } from "@/components/feature-hub/feature-hub-overview";
import { FeatureHubRepos } from "@/components/feature-hub/feature-hub-repos";
import {
  FEATURE_HUB_TAB_REF,
  type FeatureHubSection,
  type FeatureHubTabTarget,
} from "@/components/feature-hub/hub-tab-ref";
import { useThreadFeature } from "@/components/feature-hub/use-thread-feature";
import { Icon } from "@/components/ui/icon";
import { useFeatureGitStatus } from "@/hooks/use-feature-cockpit";
import { cn } from "@/lib/ui/utils";

export function FeatureHubPanel({ environment }: ExperimentalThreadTabProps) {
  const { feature, members, refLinks, api } = useThreadFeature(environment);
  const targetState = useFixedTabTarget<FeatureHubTabTarget>(FEATURE_HUB_TAB_REF);
  const [section, setSection] = useState<FeatureHubSection>("overview");
  const [requestedDir, setRequestedDir] = useState<string | undefined>(undefined);

  const lastAppliedSeqRef = useRef<number>(-1);
  const prevFeatureIdRef = useRef<string | null>(feature?.id ?? null);

  useEffect(() => {
    const currentId = feature?.id ?? null;
    if (prevFeatureIdRef.current !== currentId) {
      prevFeatureIdRef.current = currentId;
      setRequestedDir(undefined);
    }
  }, [feature?.id]);

  useEffect(() => {
    if (
      targetState === null ||
      targetState.sequence === lastAppliedSeqRef.current ||
      !FEATURE_HUB_TAB_REF.experimental_target.validate(targetState.target)
    ) {
      return;
    }
    lastAppliedSeqRef.current = targetState.sequence;
    setSection(targetState.target.section);
    setRequestedDir(targetState.target.directory ?? undefined);
  }, [targetState]);

  const gitStatusQuery = useFeatureGitStatus(feature?.id ?? null, {
    enabled: feature !== null,
  });

  if (feature === null) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        Start or open a conversation inside a Harbor feature to inspect its Multi-Repo Hub.
      </div>
    );
  }

  const gitSummary = gitStatusQuery.data ?? null;
  const meta = api.metaOf(feature.id);
  const metaVersion = `${meta.decisionCount}:${meta.activeDecisionCount}:${meta.draftCount}:${meta.refCount}:${meta.openQuestionCount}:${meta.blockerCount}:${meta.hasRequirement ? 1 : 0}:${meta.acceptanceSet ? 1 : 0}:${meta.lastDecisionAt ?? 0}`;
  const tabs: {
    readonly id: FeatureHubSection;
    readonly label: string;
    readonly badge?: number;
    readonly warnBadge?: boolean;
    readonly badgeTitle?: string;
  }[] = [
    { id: "overview", label: "Overview" },
    {
      id: "changes",
      label: "Changes",
      badge: gitSummary?.dirtyRepoCount ?? 0,
    },
    { id: "repos", label: "Repos", badge: members.length },
    {
      id: "decisions",
      label: "Decisions",
      badge:
        meta.activeDecisionCount + meta.draftCount > 0
          ? meta.activeDecisionCount + meta.draftCount
          : meta.decisionCount,
      warnBadge: meta.draftCount > 0,
      badgeTitle:
        meta.draftCount > 0
          ? `${meta.draftCount} draft decision${meta.draftCount === 1 ? "" : "s"} awaiting confirmation`
          : undefined,
    },
  ];

  const refreshGit = () => {
    void gitStatusQuery.refetch();
  };

  return (
    <div data-harbor-feature-hub={feature.id} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon name="Layers" className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate text-xs font-semibold text-foreground">
            {feature.name}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {feature.slug}
        </span>
      </div>

      <div
        role="tablist"
        aria-label="Feature Hub sections"
        className="flex shrink-0 items-center gap-1 border-b border-border px-2.5 py-1"
      >
        {tabs.map((tab) => {
          const active = section === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSection(tab.id)}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                active
                  ? "bg-state-active font-semibold text-foreground shadow-xs ring-1 ring-border"
                  : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
              )}
            >
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 ? (
                <span
                  title={tab.badgeTitle}
                  className={cn(
                    "rounded-full px-1.5 text-[10px] tabular-nums",
                    tab.warnBadge ? "harbor-badge-warning" : "bg-foreground/10",
                  )}
                >
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {section === "overview" ? (
          <FeatureHubOverview
            key={feature.id}
            feature={feature}
            members={members}
            refLinks={refLinks}
            gitSummary={gitSummary}
            metaVersion={metaVersion}
            api={api}
          />
        ) : section === "changes" ? (
          <FeatureHubChanges
            key={feature.id}
            featureId={feature.id}
            gitSummary={gitSummary}
            loadingStatus={gitStatusQuery.isLoading}
            onRefreshStatus={refreshGit}
            requestedDirectory={requestedDir}
          />
        ) : section === "repos" ? (
          <FeatureHubRepos
            key={feature.id}
            feature={feature}
            members={members}
            gitSummary={gitSummary}
            api={api}
            onMutated={refreshGit}
          />
        ) : (
          <FeatureHubDecisions
            key={feature.id}
            featureId={feature.id}
            metaVersion={metaVersion}
            api={api}
          />
        )}
      </div>
    </div>
  );
}
