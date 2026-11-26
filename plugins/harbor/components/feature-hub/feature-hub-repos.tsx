import { useEffect, useMemo, useState } from "react";
import { useSdk, type PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

import { RepositoryResults } from "@/components/inbox/repository-results";
import { RepositoryPicker } from "@/components/inbox/repository-picker";
import { RepoRoleBranchList } from "@/components/inbox/repo-role-branch-list";
import { Button } from "@bb-ui/button";
import { Icon } from "@bb-ui/icon";
import { Input } from "@bb-ui/input";
import { TruncateStart } from "@bb-ui/truncate-start";
import type {
  FeaturesApi,
  RepositoryPlan,
  RepositoryResult,
} from "@/hooks/use-features";
import { useWorkspacePaths } from "@/hooks/use-workspace-paths";
import { errorMessage } from "@/lib/domain/rpc-error";
import { validBranchName } from "@/lib/domain/feature-materialize";
import type { FeatureGitSummary } from "@/lib/domain/feature-git";
import {
  featureBranch,
  normalizeFeaturePath,
  type Feature,
  type FeatureMember,
} from "@/lib/domain/features";
import { cn, formatHomePathForDisplay } from "@/lib/ui/utils";

export function FeatureHubRepos({
  feature,
  members,
  gitSummary,
  api,
  requestedDirectory,
  onMutated,
}: {
  readonly feature: Feature;
  readonly members: readonly FeatureMember[];
  readonly gitSummary?: FeatureGitSummary | null;
  readonly api: FeaturesApi;
  readonly requestedDirectory?: { readonly directory: string; readonly seq: number } | string;
  readonly onMutated?: () => void;
}) {
  const sdk = useSdk();
  const workspacePaths = useWorkspacePaths();
  const [candidates, setCandidates] = useState<PluginSidebarProject[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<Record<string, "worktree" | "ref">>({});
  const [baseBranch, setBaseBranch] = useState("");
  const [plans, setPlans] = useState<ReadonlyMap<string, RepositoryPlan>>(new Map());
  const [results, setResults] = useState<readonly RepositoryResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [renamingDir, setRenamingDir] = useState<string | null>(null);
  const [branchDraft, setBranchDraft] = useState("");
  const [removing, setRemoving] = useState<{
    readonly directory: string;
    readonly message: string | null;
  } | null>(null);

  const requestedDirName =
    typeof requestedDirectory === "string"
      ? requestedDirectory
      : requestedDirectory?.directory;
  const suggestedBranch = featureBranch(feature.slug);
  const branchOf = (projectId: string) => branches[projectId] ?? suggestedBranch;

  useEffect(() => {
    setSelected([]);
    setBranches({});
    setRoles({});
    setBaseBranch("");
    setPlans(new Map());
    setResults(null);
    setRenamingDir(null);
    setRemoving(null);
  }, [feature.id]);

  useEffect(() => {
    let cancelled = false;
    const homes = new Set(Object.values(api.homeProjects));
    const currentDirs = new Set(members.map((m) => m.directory));
    const currentRepos = new Set(members.map((m) => m.repository));
    const currentRepoPaths = new Set(
      members.map((m) => normalizeFeaturePath(m.repositoryPath)),
    );
    setProjectsError(null);
    void sdk.projects
      .list({})
      .then((list) => {
        if (cancelled) return;
        const available: PluginSidebarProject[] = list
          .filter((p) => {
            if (p.kind === "personal" || homes.has(p.id)) return false;
            const pHost = workspacePaths.projects[p.id]?.sourceHostId;
            if (feature.hostId && pHost && pHost !== feature.hostId) return false;
            if (currentDirs.has(p.name) || currentRepos.has(p.name)) return false;
            const sourcePath = workspacePaths.projects[p.id]?.sourcePath;
            if (sourcePath && currentRepoPaths.has(normalizeFeaturePath(sourcePath))) {
              return false;
            }
            return true;
          })
          .map((p) => ({
            id: p.id,
            name: p.name,
            isPersonal: false,
            href: `/projects/${p.id}`,
            settingsHref: `/projects/${p.id}/settings`,
          }));
        setCandidates(available);
        const availableIds = new Set(available.map((item) => item.id));
        setSelected((prev) => prev.filter((id) => availableIds.has(id)));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setProjectsError(errorMessage(err, "Could not load repositories."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api.homeProjects, feature.hostId, members, sdk, workspacePaths.projects]);

  useEffect(() => {
    const missing = selected.filter((projectId) => !plans.has(projectId));
    if (missing.length === 0) return;
    let cancelled = false;
    void api
      .planRepositories(
        feature.id,
        missing.map((projectId) => {
          const role = roles[projectId] ?? "worktree";
          return {
            projectId,
            role,
            branch: role === "ref" ? null : (branches[projectId] ?? suggestedBranch).trim() || null,
            baseBranch: baseBranch.trim() || null,
          };
        }),
      )
      .then((answers) => {
        if (cancelled) return;
        setPlans((current) => {
          const next = new Map(current);
          for (const answer of answers) next.set(answer.projectId, answer);
          return next;
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(errorMessage(err, "Could not verify repository plan."));
      });
    return () => {
      cancelled = true;
    };
  }, [api, baseBranch, branches, feature.id, plans, roles, selected, suggestedBranch]);

  const pickerStatus = useMemo(() => {
    const lines = new Map<string, { text: string; tone: "muted" | "ok" | "bad" }>();
    for (const projectId of selected) {
      const plan = plans.get(projectId);
      const role = plan?.role ?? roles[projectId] ?? "worktree";
      lines.set(
        projectId,
        plan === undefined
          ? { text: "Checking…", tone: "muted" }
          : plan.outcome === "blocked"
            ? { text: plan.reason ?? "Cannot be added.", tone: "bad" }
            : role === "ref"
              ? { text: "Read-only symlink (no branch created).", tone: "ok" }
              : plan.outcome === "reuse"
                ? { text: `Already checked out here on ${plan.branch}.`, tone: "ok" }
                : {
                    text: plan.newBranch
                      ? `New branch ${plan.branch} from ${plan.base ?? "HEAD"}.`
                      : `Existing branch ${plan.branch}.`,
                    tone: "ok",
                  },
      );
    }
    return lines;
  }, [plans, roles, selected]);

  const branchError = selected
    .filter((projectId) => (roles[projectId] ?? "worktree") !== "ref")
    .map((projectId) => branchOf(projectId).trim())
    .find((value) => value.length > 0 && !validBranchName(value));
  const baseBranchInvalid =
    baseBranch.trim().length > 0 && !validBranchName(baseBranch.trim());
  const branchErrorText =
    branchError !== undefined
      ? `${branchError} is not a valid branch name.`
      : baseBranchInvalid
        ? `${baseBranch.trim()} is not a valid base branch name.`
        : null;

  const addable = selected.filter((projectId) => {
    const plan = plans.get(projectId);
    return plan !== undefined && plan.outcome !== "blocked";
  });

  const handleAdd = () => {
    if (addable.length === 0 || busy || branchErrorText !== null) return;
    setBusy(true);
    const base = baseBranch.trim() || null;
    void api
      .addRepositories(
        feature.id,
        addable.map((projectId) => {
          const role = roles[projectId] ?? "worktree";
          return {
            projectId,
            role,
            branch: role === "ref" ? null : branchOf(projectId).trim() || null,
            baseBranch: base,
          };
        }),
        base,
      )
      .then((answer) => {
        setResults(answer);
        setSelected([]);
        setBranches({});
        setRoles({});
        setPlans(new Map());
        const addedCount = answer.filter((item) => item.outcome !== "blocked").length;
        if (addedCount > 0) {
          toast.success(
            addedCount === 1
              ? "Added repository to feature."
              : `Added ${addedCount} repositories to feature.`,
          );
        }
        onMutated?.();
      })
      .catch((err: unknown) =>
        toast.error(errorMessage(err, "Could not add repositories.")),
      )
      .finally(() => setBusy(false));
  };

  const handleRenameBranch = (directory: string) => {
    const clean = branchDraft.trim();
    if (!clean || !validBranchName(clean) || busy) return;
    setBusy(true);
    void api
      .renameMemberBranch(feature.id, directory, clean)
      .then((res) => {
        if (res.ok) {
          setRenamingDir(null);
          toast.success(`Renamed branch in ${directory}.`);
          onMutated?.();
        } else {
          toast.error(res.reason ?? "Could not rename branch.");
        }
      })
      .catch((err: unknown) =>
        toast.error(errorMessage(err, "Could not rename branch.")),
      )
      .finally(() => setBusy(false));
  };

  const handleRemoveMember = (member: FeatureMember, force: boolean) => {
    if (busy) return;
    setBusy(true);
    const run =
      member.role === "ref"
        ? api.removeReferenceRepo(feature.id, member.directory)
        : api.removeRepository(feature.id, member.directory, force);
    void run
      .then((removed) => {
        if (removed) {
          setRemoving(null);
          toast.success(`Removed ${member.directory}.`);
          onMutated?.();
        } else {
          toast.error(`Could not remove ${member.directory}.`);
        }
      })
      .catch((err: unknown) => {
        const message = errorMessage(err, "Could not remove member.");
        if (!force && member.role !== "ref") {
          setRemoving({ directory: member.directory, message });
        }
        toast.error(message);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-foreground">
            Attached Repositories ({members.length})
          </h3>
          <span className="font-mono text-[10px] text-muted-foreground">
            default {suggestedBranch}
          </span>
        </div>
        {members.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-2xs text-muted-foreground">
            No repositories attached yet. Pick one below or start a feature thread to plan.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {members.map((member) => {
              const isRef = member.role === "ref";
              const isSub = member.role === "submodule";
              const gitRepo = gitSummary?.repos.find((r) => r.directory === member.directory);
              const dirtyFiles = gitRepo ? gitRepo.changedFiles + gitRepo.untrackedFiles : 0;
              const ahead = gitRepo?.aheadCommits ?? 0;
              const trimmedDraft = branchDraft.trim();
              const branchDraftInvalid =
                renamingDir === member.directory &&
                trimmedDraft.length > 0 &&
                !validBranchName(trimmedDraft);
              const isRemoving = removing?.directory === member.directory;
              return (
                <li
                  key={member.path}
                  className={cn(
                    "grid gap-1.5 rounded-md border px-2.5 py-2",
                    requestedDirName === member.directory
                      ? "border-foreground/40 bg-accent/25"
                      : "border-border",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Icon
                        name={isRef ? "Link" : "FolderGit"}
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="truncate font-medium text-foreground">
                        {member.directory}
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {isRef ? "Ref · Read-only" : isSub ? "Submodule" : "Worktree"}
                      </span>
                      {!isRef && dirtyFiles > 0 ? (
                        <span className="harbor-text-warning shrink-0 text-[10px] tabular-nums">
                          ● {dirtyFiles}
                        </span>
                      ) : null}
                      {!isRef && ahead > 0 ? (
                        <span className="harbor-text-info shrink-0 text-[10px] tabular-nums">
                          ↑{ahead}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {!isRef && !isSub ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-2xs"
                          disabled={busy}
                          onClick={() => {
                            setRenamingDir(member.directory);
                            setBranchDraft(member.branch ?? "");
                          }}
                        >
                          Branch
                        </Button>
                      ) : null}
                      {!isSub ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-2xs text-muted-foreground hover:border-destructive/40 hover:text-destructive"
                          disabled={busy}
                          onClick={() =>
                            isRef
                              ? handleRemoveMember(member, false)
                              : setRemoving({
                                  directory: member.directory,
                                  message:
                                    dirtyFiles > 0
                                      ? `${member.directory} has ${dirtyFiles} uncommitted ${dirtyFiles === 1 ? "file" : "files"}.`
                                      : null,
                                })
                          }
                        >
                          {isRef ? "Unlink" : "Remove"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="min-w-0 font-mono text-2xs text-muted-foreground">
                    {isRef ? (
                      <span className="block truncate" title={member.repositoryPath}>
                        Target: {formatHomePathForDisplay(member.repositoryPath)}
                      </span>
                    ) : (
                      <TruncateStart title={member.branch ?? "detached"}>
                        {`Branch: ${member.branch ?? "detached"}`}
                      </TruncateStart>
                    )}
                  </div>
                  {renamingDir === member.directory ? (
                    <div className="grid gap-1 pt-1">
                      <div className="flex items-center gap-1.5">
                        <Input
                          autoFocus
                          value={branchDraft}
                          maxLength={200}
                          disabled={busy}
                          onChange={(e) => setBranchDraft(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              handleRenameBranch(member.directory);
                            } else if (e.key === "Escape") {
                              setRenamingDir(null);
                            }
                          }}
                          className="h-6 flex-1 font-mono text-2xs"
                        />
                        <Button
                          size="sm"
                          className="h-6 px-2 text-2xs"
                          disabled={busy || trimmedDraft.length === 0 || branchDraftInvalid}
                          onClick={() => handleRenameBranch(member.directory)}
                        >
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-2xs"
                          onClick={() => setRenamingDir(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                      {branchDraftInvalid ? (
                        <p className="text-[10px] text-destructive">
                          Invalid git branch name (no spaces, &quot;..&quot;, or trailing &quot;/&quot;).
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {isRemoving ? (
                    <div className="flex min-w-0 items-start gap-2 rounded-md bg-destructive/10 px-2 py-1.5">
                      <p className="min-w-0 flex-1 text-2xs text-destructive">
                        {removing.message ??
                          "Its worktree is removed and its threads are archived. The branch is kept."}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 shrink-0 px-2 text-2xs"
                        disabled={busy}
                        onClick={() => setRemoving(null)}
                      >
                        Keep
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-6 shrink-0 px-2 text-2xs"
                        disabled={busy}
                        onClick={() => handleRemoveMember(member, removing.message !== null)}
                      >
                        {removing.message === null ? "Remove" : "Force remove"}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {results === null ? null : <RepositoryResults results={results} />}

      {/* Multi-select Add repositories with preflight plan & Worktree/Ref toggle */}
      <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-2.5">
        <div className="grid gap-0.5">
          <span className="text-2xs font-medium text-foreground">
            Add repositories or read-only references
          </span>
          <p className="text-[11px] text-muted-foreground">
            Tick repositories to preflight branch and worktree status before adding.
          </p>
        </div>
        {projectsError !== null ? (
          <p className="text-2xs text-destructive">{projectsError}</p>
        ) : candidates.length === 0 ? (
          <p className="text-2xs text-muted-foreground">
            Every available project is already in this feature.
          </p>
        ) : (
          <div className="grid gap-2">
            <RepositoryPicker
              projects={candidates}
              selected={selected}
              onChange={(next) => {
                setSelected(next);
                setPlans(
                  (current) =>
                    new Map([...current].filter(([projectId]) => next.includes(projectId))),
                );
                setBranches((current) =>
                  Object.fromEntries(
                    Object.entries(current).filter(([projectId]) => next.includes(projectId)),
                  ),
                );
              }}
              status={pickerStatus}
              disabled={busy}
              maxHeightClassName="max-h-44"
            />
            {selected.length > 0 ? (
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-2xs text-muted-foreground">Base branch:</span>
                  <Input
                    value={baseBranch}
                    maxLength={200}
                    placeholder="default HEAD (or e.g. main)"
                    disabled={busy}
                    onChange={(e) => {
                      setBaseBranch(e.currentTarget.value);
                      setPlans(new Map());
                    }}
                    className="h-6 flex-1 font-mono text-2xs"
                  />
                </div>
                <RepoRoleBranchList
                  projectIds={selected}
                  projects={candidates}
                  roles={roles}
                  getBranch={branchOf}
                  placeholderBranch={suggestedBranch || "branch"}
                  disabled={busy}
                  onRoleChange={(projectId, choice) => {
                    setRoles((prev) => ({ ...prev, [projectId]: choice }));
                    setPlans((current) => {
                      const next = new Map(current);
                      next.delete(projectId);
                      return next;
                    });
                  }}
                  onBranchChange={(projectId, value) => {
                    setBranches((prev) => ({ ...prev, [projectId]: value }));
                    setPlans((current) => {
                      const next = new Map(current);
                      next.delete(projectId);
                      return next;
                    });
                  }}
                />
                {branchErrorText ? (
                  <p className="text-[10px] text-destructive">{branchErrorText}</p>
                ) : null}
                <Button
                  size="sm"
                  className="h-7 text-2xs disabled:opacity-60"
                  disabled={busy || addable.length === 0 || branchErrorText !== null}
                  onClick={handleAdd}
                >
                  {busy
                    ? "Adding…"
                    : addable.length <= 1
                      ? "Add repository"
                      : `Add ${addable.length} repositories`}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
