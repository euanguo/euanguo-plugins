import { useEffect, useRef, useState } from "react";

import { OverviewBriefSection } from "@/components/feature-hub/overview-brief-section";
import { OverviewParkSection } from "@/components/feature-hub/overview-park-section";
import { OverviewReferencesSection } from "@/components/feature-hub/overview-references-section";
import type { FeaturesApi } from "@/hooks/use-features";
import type { FeatureGitSummary } from "@/lib/domain/feature-git";
import { EMPTY_BRIEF, type FeatureBrief, type FeatureRef } from "@/lib/domain/feature-meta";
import type { Feature, FeatureMember, FeatureRefLink } from "@/lib/domain/features";

export function FeatureHubOverview({
  feature,
  members,
  refLinks,
  gitSummary,
  metaVersion,
  api,
}: {
  readonly feature: Feature;
  readonly members: readonly FeatureMember[];
  readonly refLinks: readonly FeatureRefLink[];
  readonly gitSummary: FeatureGitSummary | null;
  readonly metaVersion?: string;
  readonly api: FeaturesApi;
}) {
  const [brief, setBrief] = useState<FeatureBrief>(EMPTY_BRIEF);
  const [metaLoaded, setMetaLoaded] = useState(false);
  const [switchedFeature, setSwitchedFeature] = useState(true);
  const [refs, setRefs] = useState<readonly FeatureRef[]>([]);
  const loadedFeatureRef = useRef<string | null>(null);
  const { getMeta } = api;

  useEffect(() => {
    let cancelled = false;
    const switched = loadedFeatureRef.current !== feature.id;
    setSwitchedFeature(switched);
    if (switched) setMetaLoaded(false);
    void getMeta(feature.id)
      .then((meta) => {
        if (cancelled) return;
        loadedFeatureRef.current = feature.id;
        setBrief(meta.brief);
        setRefs(meta.refs);
        setMetaLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setBrief(EMPTY_BRIEF);
        setRefs([]);
        setMetaLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [getMeta, feature.id, metaVersion]);

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <OverviewParkSection feature={feature} api={api} />

      <div className="grid grid-cols-4 gap-1.5">
        <div className="rounded-md border border-border px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">Repos</div>
          <div className="text-sm font-semibold tabular-nums">
            {members.length}
            {refLinks.length > 0 ? (
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                ({refLinks.length} ref)
              </span>
            ) : null}
          </div>
        </div>
        <div className="rounded-md border border-border px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">Changes</div>
          <div className="text-sm font-semibold tabular-nums">
            {gitSummary ? (
              <>
                <span className="harbor-text-success">+{gitSummary.additions}</span>{" "}
                <span className="text-destructive">-{gitSummary.deletions}</span>
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
        <div className="rounded-md border border-border px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">Dirty</div>
          <div className="text-sm font-semibold tabular-nums">
            {gitSummary ? gitSummary.dirtyRepoCount : "—"}
          </div>
        </div>
        <div className="rounded-md border border-border px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">Unpushed</div>
          <div className="text-sm font-semibold tabular-nums">
            {gitSummary ? gitSummary.unpushedRepoCount : "—"}
          </div>
        </div>
      </div>

      <OverviewBriefSection
        featureId={feature.id}
        initialBrief={brief}
        metaLoaded={metaLoaded}
        switchedFeature={switchedFeature}
        onSave={api.saveBrief}
      />

      <OverviewReferencesSection
        featureId={feature.id}
        refs={refs}
        onRefsChange={setRefs}
        api={api}
      />
    </div>
  );
}
