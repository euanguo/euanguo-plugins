import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (targetState === null || !FEATURE_HUB_TAB_REF.experimental_target.validate(targetState.target)) {
      return;
    }
    setSection(targetState.target.section);
    if (typeof targetState.target.directory === "string") {
      setRequestedDir(targetState.target.directory);
    }
  }, [targetState?.sequence, targetState]);

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
  const tabs: {
    readonly id: FeatureHubSection;
    readonly label: string;
    readonly badge?: number;
  }[] = [
    { id: "overview", label: "Overview" },
    {
      id: "changes",
      label: "Changes",
      badge: gitSummary?.dirtyRepoCount ?? 0,
    },
    { id: "repos", label: "Repos", badge: members.length },
    { id: "decisions", label: "Decisions", badge: meta.draftCount },
  ];

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
                "flex items-center gap-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <span>{tab.label}</span>
              {tab.badge && tab.badge > 0 ? (
                <span className="rounded-full bg-foreground/10 px-1 text-[10px] tabular-nums">
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
            feature={feature}
            members={members}
            refLinks={refLinks}
            gitSummary={gitSummary}
            api={api}
          />
        ) : section === "changes" ? (
          <FeatureHubChanges
            featureId={feature.id}
            gitSummary={gitSummary}
            loadingStatus={gitStatusQuery.isLoading}
            onRefreshStatus={() => void gitStatusQuery.refetch()}
            requestedDirectory={requestedDir}
          />
        ) : section === "repos" ? (
          <FeatureHubRepos feature={feature} members={members} api={api} />
        ) : (
          <FeatureHubDecisions featureId={feature.id} api={api} />
        )}
      </div>
    </div>
  );
}
