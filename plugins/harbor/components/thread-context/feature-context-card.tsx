import {
  experimental_DetailRow as DetailRow,
  type ExperimentalThreadContextCardProps,
  type ExperimentalThreadInfoProps,
  experimental_InfoList as InfoList,
  experimental_InfoListRow as InfoListRow,
  experimental_InfoSection as InfoSection,
  experimental_ThreadContextCardRow as ThreadContextCardRow,
  experimental_useAppPanel as useAppPanel,
} from "@get-bb/plugin-sdk/app";

import { FEATURE_HUB_TAB_REF } from "@/components/feature-hub/hub-tab-ref";
import { useThreadFeature } from "@/components/feature-hub/use-thread-feature";
import { Icon } from "@/components/ui/icon";
import { useFeatureGitStatus } from "@/hooks/use-feature-cockpit";
import { cn } from "@/lib/ui/utils";

export function FeatureContextCardSummaryRow({
  environment,
}: ExperimentalThreadContextCardProps) {
  const { feature, members } = useThreadFeature(environment);
  const panel = useAppPanel();
  const gitStatus = useFeatureGitStatus(feature?.id ?? null, {
    enabled: feature !== null,
  });

  if (feature === null) return null;

  const summary = gitStatus.data;
  const trailing =
    summary !== undefined
      ? summary.additions > 0 || summary.deletions > 0
        ? `+${summary.additions} −${summary.deletions}`
        : `${summary.repos.length} ${summary.repos.length === 1 ? "repo" : "repos"} · Clean`
      : `${members.length} ${members.length === 1 ? "repo" : "repos"}`;

  return (
    <ThreadContextCardRow
      icon="Layers"
      label={feature.state === "parked" ? `${feature.name} (Parked)` : feature.name}
      trailing={trailing}
      title="Open Feature Hub workbench"
      onClick={() =>
        panel.openTab({
          tab: FEATURE_HUB_TAB_REF,
          target: { section: "overview", directory: null },
        })
      }
    />
  );
}

export function FeatureContextCardReposSection({
  environment,
}: ExperimentalThreadContextCardProps) {
  const { feature, members } = useThreadFeature(environment);
  const panel = useAppPanel();
  const gitStatus = useFeatureGitStatus(feature?.id ?? null, {
    enabled: feature !== null,
  });

  if (feature === null) return null;

  const repos = gitStatus.data?.repos;
  if (repos && repos.length > 0) {
    return (
      <>
        {repos.map((repo) => {
          const isRef = repo.role === "ref";
          const trailing = isRef
            ? "Ref · Read-only"
            : repo.additions > 0 || repo.deletions > 0
              ? `+${repo.additions} −${repo.deletions}`
              : (repo.aheadCommits ?? 0) > 0
                ? `↑${repo.aheadCommits}`
                : "Clean";
          return (
            <ThreadContextCardRow
              key={repo.directory}
              icon={isRef ? "Link" : "FolderGit"}
              label={
                repo.branch && !isRef
                  ? `${repo.directory} (${repo.branch})`
                  : repo.directory
              }
              trailing={trailing}
              title={`Inspect ${repo.directory} in Feature Hub`}
              onClick={() =>
                panel.openTab({
                  tab: FEATURE_HUB_TAB_REF,
                  target: {
                    section: repo.clean && !isRef ? "repos" : "changes",
                    directory: repo.directory,
                  },
                })
              }
            />
          );
        })}
      </>
    );
  }

  if (members.length === 0) return null;

  return (
    <>
      {members.map((member) => {
        const isRef = member.role === "ref";
        return (
          <ThreadContextCardRow
            key={member.directory}
            icon={isRef ? "Link" : "FolderGit"}
            label={member.directory}
            trailing={isRef ? "Ref · Read-only" : (member.branch ?? "detached")}
            title={`Open ${member.directory} in Feature Hub`}
            onClick={() =>
              panel.openTab({
                tab: FEATURE_HUB_TAB_REF,
                target: { section: "repos", directory: member.directory },
              })
            }
          />
        );
      })}
    </>
  );
}

/** Info tab detail row counterpart to {@link FeatureContextCardSummaryRow}. */
export function FeatureInfoSummaryRow({ environment }: ExperimentalThreadInfoProps) {
  const { feature, members } = useThreadFeature(environment);
  const panel = useAppPanel();
  const gitStatus = useFeatureGitStatus(feature?.id ?? null, {
    enabled: feature !== null,
  });

  if (feature === null) return null;

  const summary = gitStatus.data;
  const detailText =
    summary !== undefined
      ? summary.dirtyRepoCount > 0
        ? `${summary.repos.length} repos · ${summary.dirtyRepoCount} dirty (+${summary.additions}/-${summary.deletions})`
        : `${summary.repos.length} ${summary.repos.length === 1 ? "repo" : "repos"} · Clean`
      : `${members.length} ${members.length === 1 ? "repo" : "repos"}`;

  return (
    <DetailRow icon="Layers" label="Feature">
      <button
        type="button"
        onClick={() =>
          panel.openTab({
            tab: FEATURE_HUB_TAB_REF,
            target: { section: "overview", directory: null },
          })
        }
        className="flex min-w-0 items-center gap-1.5 text-left text-xs text-foreground underline-offset-2 hover:underline"
      >
        <span className="truncate font-medium">
          {feature.state === "parked" ? `${feature.name} (Parked)` : feature.name}
        </span>
        <span className="shrink-0 text-muted-foreground">· {detailText}</span>
      </button>
    </DetailRow>
  );
}

/** Info tab collapsible section counterpart to {@link FeatureContextCardReposSection}. */
export function FeatureInfoReposSection({ environment }: ExperimentalThreadInfoProps) {
  const { feature, members } = useThreadFeature(environment);
  const panel = useAppPanel();
  const gitStatus = useFeatureGitStatus(feature?.id ?? null, {
    enabled: feature !== null,
  });

  if (feature === null) return null;

  const repos = gitStatus.data?.repos;
  const items =
    repos && repos.length > 0
      ? repos.map((repo) => ({
          key: repo.directory,
          isRef: repo.role === "ref",
          name: repo.directory,
          context: repo.role === "ref" ? "read-only symlink" : (repo.branch ?? undefined),
          trailing:
            repo.role === "ref"
              ? "Ref"
              : repo.additions > 0 || repo.deletions > 0
                ? `+${repo.additions} −${repo.deletions}`
                : (repo.aheadCommits ?? 0) > 0
                  ? `↑${repo.aheadCommits}`
                  : "Clean",
          section: (repo.clean && repo.role !== "ref" ? "repos" : "changes") as
            | "repos"
            | "changes",
        }))
      : members.map((member) => ({
          key: member.directory,
          isRef: member.role === "ref",
          name: member.directory,
          context: member.role === "ref" ? "read-only symlink" : (member.branch ?? undefined),
          trailing: member.role === "ref" ? "Ref" : "Ready",
          section: "repos" as const,
        }));

  if (items.length === 0) return null;

  return (
    <InfoSection label="Feature repositories" count={items.length}>
      <InfoList
        items={items}
        getKey={(item) => item.key}
        renderItem={(item) => (
          <InfoListRow
            leading={
              <Icon
                name={item.isRef ? "Link" : "FolderGit"}
                className="size-3 text-muted-foreground"
                aria-hidden
              />
            }
            leadingLabel={item.isRef ? "Read-only reference" : "Worktree"}
            name={item.name}
            context={item.context}
            trailing={
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                  item.trailing === "Clean"
                    ? "bg-emerald-500/10 text-emerald-500"
                    : item.trailing === "Ref"
                      ? "bg-muted text-muted-foreground"
                      : "bg-amber-500/10 text-amber-500",
                )}
              >
                {item.trailing}
              </span>
            }
            onSelect={() =>
              panel.openTab({
                tab: FEATURE_HUB_TAB_REF,
                target: { section: item.section, directory: item.name },
              })
            }
          />
        )}
      />
    </InfoSection>
  );
}
