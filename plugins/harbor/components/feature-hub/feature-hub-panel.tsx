import { useEffect, useMemo, useRef, useState } from "react";
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
  buildHubTargetKey,
  resolveHubSection,
  type FeatureHubSection,
  type FeatureHubTabTarget,
} from "@/components/feature-hub/hub-tab-ref";
import { useThreadFeature } from "@/components/feature-hub/use-thread-feature";
import { Icon } from "@bb-ui/icon";
import { useFeatureGitStatus } from "@/hooks/use-feature-cockpit";
import { useFeatures } from "@/hooks/use-features";
import { cn } from "@/lib/ui/utils";

export interface FeatureHubContentProps {
  readonly featureId: string;
  readonly initialSection?: FeatureHubSection;
  readonly initialDirectory?: string | null;
  readonly targetSeq?: number;
  readonly hideHeader?: boolean;
  readonly onClose?: () => void;
}

export function FeatureHubContent({
  featureId,
  initialSection,
  initialDirectory,
  targetSeq,
  hideHeader = false,
  onClose,
}: FeatureHubContentProps) {
  const api = useFeatures();
  const feature = api.byId.get(featureId) ?? null;

  const members = useMemo(
    () => api.members.filter((member) => member.featureId === featureId),
    [api.members, featureId],
  );
  const refLinks = useMemo(
    () => api.refLinks.filter((link) => link.featureId === featureId),
    [api.refLinks, featureId],
  );

  const [section, setSection] = useState<FeatureHubSection>(() =>
    resolveHubSection(initialSection),
  );
  const [requestedDir, setRequestedDir] = useState<
    { readonly directory: string; readonly seq: number } | undefined
  >(() =>
    initialDirectory
      ? { directory: initialDirectory, seq: targetSeq ?? 0 }
      : undefined,
  );

  const prevFeatureIdRef = useRef<string>(featureId);
  const lastTargetKeyRef = useRef<string>(
    buildHubTargetKey({ featureId, section: initialSection, directory: initialDirectory, targetSeq }),
  );
  const internalSeqRef = useRef(0);

  useEffect(() => {
    const nextKey = buildHubTargetKey({
      featureId,
      section: initialSection,
      directory: initialDirectory,
      targetSeq,
    });
    const featureSwitched = prevFeatureIdRef.current !== featureId;
    if (featureSwitched) {
      prevFeatureIdRef.current = featureId;
      lastTargetKeyRef.current = nextKey;
      setSection(resolveHubSection(initialSection));
      setRequestedDir(
        initialDirectory
          ? { directory: initialDirectory, seq: targetSeq ?? 0 }
          : undefined,
      );
      return;
    }
    if (nextKey !== lastTargetKeyRef.current) {
      lastTargetKeyRef.current = nextKey;
      if (initialSection !== undefined) {
        setSection(resolveHubSection(initialSection));
      }
      if (initialDirectory) {
        internalSeqRef.current += 1;
        setRequestedDir({
          directory: initialDirectory,
          seq: targetSeq ?? internalSeqRef.current,
        });
      }
    }
  }, [featureId, initialDirectory, initialSection, targetSeq]);

  const gitStatusQuery = useFeatureGitStatus(feature?.id ?? null, {
    enabled: feature !== null,
  });

  if (feature === null) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        Feature is no longer available.
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

  const openSection = (nextSection: FeatureHubSection, directory?: string | null) => {
    setSection(nextSection);
    if (directory) {
      internalSeqRef.current += 1;
      setRequestedDir({ directory, seq: internalSeqRef.current });
    }
  };

  return (
    <div data-harbor-feature-hub={feature.id} className="flex h-full min-h-0 flex-col">
      {hideHeader ? null : (
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
      )}

      <div
        role="tablist"
        aria-label="Feature Hub sections"
        className="flex shrink-0 items-center gap-1 border-b border-border px-2.5 py-1.5"
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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          role="tabpanel"
          hidden={section !== "overview"}
          className={cn(
            "min-h-0 flex-1 flex-col overflow-y-auto",
            section === "overview" ? "flex" : "hidden",
          )}
        >
          <FeatureHubOverview
            key={feature.id}
            feature={feature}
            members={members}
            refLinks={refLinks}
            gitSummary={gitSummary}
            metaVersion={metaVersion}
            api={api}
          />
        </div>
        <div
          role="tabpanel"
          hidden={section !== "changes"}
          className={cn(
            "min-h-0 flex-1 flex-col overflow-y-auto",
            section === "changes" ? "flex" : "hidden",
          )}
        >
          <FeatureHubChanges
            key={feature.id}
            featureId={feature.id}
            gitSummary={gitSummary}
            loadingStatus={gitStatusQuery.isLoading}
            active={section === "changes"}
            onRefreshStatus={refreshGit}
            requestedDirectory={requestedDir}
            onOpenRepos={(dir) => openSection("repos", dir)}
            onClose={onClose}
          />
        </div>
        <div
          role="tabpanel"
          hidden={section !== "repos"}
          className={cn(
            "min-h-0 flex-1 flex-col overflow-y-auto",
            section === "repos" ? "flex" : "hidden",
          )}
        >
          <FeatureHubRepos
            key={feature.id}
            feature={feature}
            members={members}
            gitSummary={gitSummary}
            api={api}
            requestedDirectory={requestedDir}
            onMutated={refreshGit}
          />
        </div>
        <div
          role="tabpanel"
          hidden={section !== "decisions"}
          className={cn(
            "min-h-0 flex-1 flex-col overflow-y-auto",
            section === "decisions" ? "flex" : "hidden",
          )}
        >
          <FeatureHubDecisions
            key={feature.id}
            featureId={feature.id}
            metaVersion={metaVersion}
            api={api}
          />
        </div>
      </div>
    </div>
  );
}

export function FeatureHubPanel({ environment }: ExperimentalThreadTabProps) {
  const { feature } = useThreadFeature(environment);
  const targetState = useFixedTabTarget<FeatureHubTabTarget>(FEATURE_HUB_TAB_REF);

  if (feature === null) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        Start or open a conversation inside a Harbor feature to inspect its Multi-Repo Hub.
      </div>
    );
  }

  const validTarget =
    targetState !== null &&
    FEATURE_HUB_TAB_REF.experimental_target.validate(targetState.target)
      ? targetState.target
      : null;

  return (
    <FeatureHubContent
      featureId={feature.id}
      initialSection={validTarget?.section}
      initialDirectory={validTarget?.directory ?? null}
      targetSeq={targetState?.sequence}
    />
  );
}
