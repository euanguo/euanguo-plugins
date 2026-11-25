import {
  type ExperimentalThreadContextCardProps,
  experimental_ThreadContextCardRow as ThreadContextCardRow,
  experimental_useAppPanel as useAppPanel,
} from "@get-bb/plugin-sdk/app";

import { FEATURE_HUB_TAB_REF } from "@/components/feature-hub/hub-tab-ref";
import { useThreadFeature } from "@/components/feature-hub/use-thread-feature";
import { useFeatureGitStatus } from "@/hooks/use-feature-cockpit";

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
              icon={isRef ? "BookOpen" : "FolderGit"}
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
            icon={isRef ? "BookOpen" : "FolderGit"}
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
