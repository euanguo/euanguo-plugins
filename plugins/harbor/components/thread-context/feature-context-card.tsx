import {
  experimental_DetailRow as DetailRow,
  type ExperimentalThreadContextCardProps,
  type ExperimentalThreadInfoProps,
  experimental_ThreadContextCardRow as ThreadContextCardRow,
  experimental_useAppPanel as useAppPanel,
} from "@get-bb/plugin-sdk/app";

import { FEATURE_HUB_TAB_REF } from "@/components/feature-hub/hub-tab-ref";
import { useThreadFeature } from "@/components/feature-hub/use-thread-feature";
import { useFeatureGitStatus } from "@/hooks/use-feature-cockpit";

interface FeatureSummaryViewModel {
  readonly featureLabel: string;
  readonly repoSummary: string;
  readonly tooltip: string;
  readonly openHub: () => void;
}

function useThreadFeatureSummary(
  environment: ExperimentalThreadContextCardProps["environment"],
): FeatureSummaryViewModel | null {
  const { feature, members } = useThreadFeature(environment);
  const panel = useAppPanel();
  const gitStatus = useFeatureGitStatus(feature?.id ?? null, {
    enabled: feature !== null,
  });

  if (feature === null) return null;

  const featureLabel =
    feature.state === "parked" ? `${feature.name} (Parked)` : feature.name;
  const summary = gitStatus.data;
  const repoCount = summary !== undefined ? summary.repos.length : members.length;
  const repoCountLabel = `${repoCount} ${repoCount === 1 ? "repo" : "repos"}`;
  const repoSummary =
    summary === undefined
      ? repoCountLabel
      : summary.dirtyRepoCount > 0
        ? `${repoCountLabel} · ${summary.dirtyRepoCount} dirty`
        : `${repoCountLabel} · Clean`;
  const tooltip =
    summary !== undefined &&
    summary.dirtyRepoCount > 0 &&
    (summary.additions > 0 || summary.deletions > 0)
      ? `Open Feature Hub (+${summary.additions} −${summary.deletions})`
      : "Open Feature Hub workbench";

  return {
    featureLabel,
    repoSummary,
    tooltip,
    openHub: () =>
      panel.openTab({
        tab: FEATURE_HUB_TAB_REF,
        target: { section: "overview", directory: null },
      }),
  };
}

function FeatureSummaryChip({
  summary,
}: {
  readonly summary: FeatureSummaryViewModel;
}) {
  return (
    <button
      type="button"
      title={summary.tooltip}
      onClick={summary.openHub}
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-left text-xs text-foreground transition-colors hover:bg-state-hover"
    >
      <span className="truncate font-medium">{summary.featureLabel}</span>
      <span className="shrink-0 text-muted-foreground">
        · {summary.repoSummary} · Open Hub
      </span>
    </button>
  );
}

export function FeatureContextCardSummaryRow({
  environment,
}: ExperimentalThreadContextCardProps) {
  const summary = useThreadFeatureSummary(environment);
  if (summary === null) return null;

  return (
    <ThreadContextCardRow
      icon="Layers"
      label={`Feature: ${summary.featureLabel}`}
      trailing={`${summary.repoSummary} · Open Hub`}
      title={summary.tooltip}
      onClick={summary.openHub}
    />
  );
}

/** Info tab detail row counterpart to {@link FeatureContextCardSummaryRow}. */
export function FeatureInfoSummaryRow({
  environment,
}: ExperimentalThreadInfoProps) {
  const summary = useThreadFeatureSummary(environment);
  if (summary === null) return null;

  return (
    <DetailRow icon="Layers" label="Feature">
      <FeatureSummaryChip summary={summary} />
    </DetailRow>
  );
}
