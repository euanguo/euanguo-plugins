import { useEffect, useMemo, useState } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import { RepositoryResults } from "@/components/inbox/feature-create-dialog";
import { RepositoryPicker } from "@/components/inbox/repository-picker";
import { Button } from "@/components/ui/button";
import { ConfirmDialogFooter } from "@/components/ui/confirm-dialog-footer";
import { Field } from "@/components/ui/control";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { TruncateStart } from "@/components/ui/truncate-start";
import { useDialogTask } from "@/hooks/use-dialog-task";
import { errorMessage } from "@/lib/domain/errors";
import type { FeaturesApi, RepositoryPlan, RepositoryResult } from "@/hooks/use-features";
import { validBranchName } from "@/lib/domain/feature-materialize";
import {
  featureBranch,
  normalizeFeaturePath,
  type Feature,
  type FeatureMember,
} from "@/lib/domain/features";
import { cn } from "@/lib/ui/utils";

/**
 * What a feature contains, and the way to change it.
 *
 * The list on top is read from the folder, so it shows a worktree an agent
 * created by hand as readily as one made here. Below it, repositories not yet in
 * the feature can be ticked; each ticked one is checked against git straight
 * away and says, on its own row, what would happen — the branch it gets, or why
 * it cannot be added.
 *
 * Branches are per repository. The feature's slug suggests one, but any
 * repository may take its own convention or an existing branch, and a member's
 * branch can be renamed in place — the worktree and its commits follow.
 */
export function FeatureRepositoriesDialog({
  open,
  feature,
  members,
  projects,
  paths,
  api,
  onClose,
}: {
  open: boolean;
  feature: Feature | null;
  members: readonly FeatureMember[];
  projects: readonly PluginSidebarProject[];
  /** projectId -> the project's checkout path, to tell which are already in. */
  paths: ReadonlyMap<string, string | null>;
  api: FeaturesApi;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  /** Branches typed for repositories about to be added, keyed by project id. */
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<Record<string, "worktree" | "ref">>({});
  const [baseBranch, setBaseBranch] = useState("");
  /** The member whose branch is being renamed, and the draft. */
  const [editing, setEditing] = useState<{ directory: string; value: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [plans, setPlans] = useState<ReadonlyMap<string, RepositoryPlan>>(new Map());
  const [results, setResults] = useState<readonly RepositoryResult[] | null>(null);
  const task = useDialogTask<unknown>();
  const busy = task.busy;
  const error = task.error;
  const [removing, setRemoving] = useState<{ directory: string; message: string | null } | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setBranches({});
    setRoles({});
    setBaseBranch("");
    setEditing(null);
    setRenameError(null);
    setPlans(new Map());
    setResults(null);
    task.reset();
    setRemoving(null);
  }, [open, feature?.id]);

  const inFeature = useMemo(
    () => new Set(members.map((member) => normalizeFeaturePath(member.repositoryPath))),
    [members],
  );
  const suggestedBranch = feature !== null ? featureBranch(feature.slug) : "";
  const branchOf = (projectId: string) => branches[projectId] ?? suggestedBranch;
  const branchError = selected
    .filter((projectId) => (roles[projectId] ?? "worktree") !== "ref")
    .map((projectId) => branchOf(projectId).trim())
    .find((value) => value.length > 0 && !validBranchName(value));
  const branchErrorText =
    branchError === undefined ? null : `${branchError} is not a valid branch name.`;

  const candidates = useMemo(
    () =>
      projects.filter((project) => {
        const path = paths.get(project.id);
        return path === null || path === undefined
          ? true
          : !inFeature.has(normalizeFeaturePath(path));
      }),
    [inFeature, paths, projects],
  );

  // Every newly ticked repository is asked about once; the answer stays while
  // it stays ticked, so ticking and unticking does not re-run git.
  useEffect(() => {
    if (!open || feature === null) return;
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
            branch: role === "ref" ? null : branchOf(projectId).trim() || null,
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
      .catch((failure: unknown) => {
        if (!cancelled) task.setError(errorMessage(failure, "That did not work."));
      });
    return () => {
      cancelled = true;
    };
  }, [api, feature, open, plans, selected]);

  const status = useMemo(() => {
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

  const addable = selected.filter((projectId) => {
    const plan = plans.get(projectId);
    return plan !== undefined && plan.outcome !== "blocked";
  });

  const add = () => {
    if (feature === null || addable.length === 0 || busy || branchErrorText !== null) return;
    void task.run(async () => {
      const base = baseBranch.trim() || null;
      const answer = await api.addRepositories(
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
      );
      setResults(answer);
      setSelected([]);
      setBranches({});
      setRoles({});
      setPlans(new Map());
    }, "That did not work.");
  };

  const unlinkRef = (directory: string) => {
    if (feature === null || busy) return;
    void task.run(async () => {
      await api.removeReferenceRepo(feature.id, directory);
    }, "Could not unlink reference.");
  };

  const rename = (directory: string, value: string) => {
    if (feature === null || busy) return;
    setRenameError(null);
    void task.run(async () => {
      try {
        const result = await api.renameMemberBranch(feature.id, directory, value.trim());
        if (result.ok) setEditing(null);
        else setRenameError(result.reason ?? "That did not work.");
      } catch (failure: unknown) {
        setRenameError(errorMessage(failure, "That did not work."));
      }
    }, "That did not work.");
  };

  const remove = (directory: string, force: boolean) => {
    if (feature === null || busy) return;
    void task.run(async () => {
      try {
        await api.removeRepository(feature.id, directory, force);
        setRemoving(null);
      } catch (failure: unknown) {
        setRemoving({ directory, message: errorMessage(failure, "That did not work.") });
      }
    }, "That did not work.");
  };

  if (feature === null) return null;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={`Repositories in ${feature.name}`}
      subtitle={
        <>
          Suggested branch <span className="font-mono">{suggestedBranch}</span>; each repository
          may use its own
        </>
      }
      icon="FolderGit"
      busy={busy}
      width="34rem"
      footer={
        <ConfirmDialogFooter
          cancelLabel="Done"
          submitLabel={
            busy && addable.length > 0
              ? "Checking out…"
              : addable.length <= 1
                ? "Add repository"
                : `Add ${addable.length} repositories`
          }
          busy={busy}
          disabled={addable.length === 0}
          onSubmit={add}
          onCancel={onClose}
        />
      }
    >
      <div className="grid min-w-0 gap-4">
        <section className="grid gap-1.5" aria-label="In this feature">
          <p className="text-xs text-muted-foreground">In this feature</p>
          {members.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-2 py-2 text-2xs text-muted-foreground">
              None yet. A conversation in the feature can still plan the work, and an agent there can add repositories itself.
            </p>
          ) : (
            <ul className="rounded-md border border-border">
              {members.map((member) => (
                <li
                  key={member.path}
                  className="grid min-w-0 gap-1 border-b border-border/60 px-2 py-1.5 last:border-b-0"
                >
                  {/* One line: name, a branch that keeps its tail, and the two
                      actions together on the right. Every part except the
                      actions can shrink, so a long branch truncates instead of
                      widening the row. */}
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 max-w-[35%] truncate text-xs text-foreground">
                      {member.directory}
                    </span>
                    {member.role === "ref" ? (
                      <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                          Ref · Read-only
                        </span>
                      </span>
                    ) : (
                      <TruncateStart
                        title={member.branch ?? "detached"}
                        className="min-w-0 flex-1 font-mono text-2xs text-muted-foreground"
                      >
                        {member.branch ?? "detached"}
                      </TruncateStart>
                    )}
                    <div className="flex shrink-0 items-center gap-1">
                      {member.role === "ref" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-2xs"
                          disabled={busy}
                          onClick={() => unlinkRef(member.directory)}
                        >
                          Unlink
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-2xs"
                            disabled={busy}
                            onClick={() => {
                              setRenameError(null);
                              setEditing({ directory: member.directory, value: member.branch ?? "" });
                            }}
                          >
                            Branch
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-2xs"
                            disabled={busy}
                            onClick={() => setRemoving({ directory: member.directory, message: null })}
                          >
                            Remove
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {editing?.directory === member.directory ? (
                    <div className="flex min-w-0 items-start gap-2">
                      <Input
                        autoFocus
                        value={editing.value}
                        maxLength={200}
                        aria-label={`Branch for ${member.directory}`}
                        disabled={busy}
                        onChange={(event) =>
                          setEditing({ directory: member.directory, value: event.currentTarget.value })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            rename(member.directory, editing.value);
                          }
                          if (event.key === "Escape") setEditing(null);
                        }}
                        className="h-6 min-w-0 flex-1 font-mono text-2xs"
                      />
                      <Button
                        size="sm"
                        className="shrink-0"
                        disabled={busy || editing.value.trim().length === 0}
                        onClick={() => rename(member.directory, editing.value)}
                      >
                        Rename
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        disabled={busy}
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                  {renameError === null ? null : editing?.directory === member.directory ? (
                    <p className="text-2xs text-destructive">{renameError}</p>
                  ) : null}
                  {removing?.directory === member.directory ? (
                    <div className="flex min-w-0 items-start gap-2 rounded-md bg-destructive/10 px-2 py-1.5">
                      <p className="min-w-0 flex-1 text-2xs text-destructive">
                        {removing.message ??
                          "Its worktree is removed and its threads are archived. The branch is kept."}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        disabled={busy}
                        onClick={() => setRemoving(null)}
                      >
                        Keep
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="shrink-0"
                        disabled={busy}
                        onClick={() => remove(member.directory, removing.message !== null)}
                      >
                        {removing.message === null ? "Remove" : "Remove anyway"}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        {results === null ? null : <RepositoryResults results={results} />}
        <Field label="Add repositories" error={error}>
          <div className="grid min-w-0 gap-2">
            <p className="-mt-1 text-2xs text-muted-foreground">
              Select repositories to attach as writable Worktrees or read-only Refs.
            </p>
            <RepositoryPicker
              projects={candidates}
              selected={selected}
              onChange={(next) => {
                setSelected(next);
                setPlans((current) => {
                  const kept = new Map(
                    [...current].filter(([projectId]) => next.includes(projectId)),
                  );
                  return kept;
                });
                setBranches((current) =>
                  Object.fromEntries(
                    Object.entries(current).filter(([projectId]) => next.includes(projectId)),
                  ),
                );
              }}
              status={status}
              disabled={busy}
              maxHeightClassName="max-h-44"
            />
            {selected.length === 0 ? null : (
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-2xs text-muted-foreground">Base branch:</span>
                  <Input
                    value={baseBranch}
                    maxLength={200}
                    placeholder="default HEAD (or e.g. main)"
                    disabled={busy}
                    onChange={(event) => {
                      setBaseBranch(event.currentTarget.value);
                      setPlans(new Map());
                    }}
                    className="h-6 flex-1 font-mono text-2xs"
                  />
                </div>
                <ul className="grid gap-1.5 rounded-md border border-border px-2 py-1.5">
                  {selected.map((projectId) => {
                    const project = candidates.find((candidate) => candidate.id === projectId);
                    const role = roles[projectId] ?? "worktree";
                    return (
                      <li
                        key={projectId}
                        className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)] items-center gap-1.5"
                      >
                        <span className="truncate text-2xs text-muted-foreground">
                          {project?.name ?? projectId}
                        </span>
                        <div className="inline-flex rounded border border-border p-0.5 text-[10px]">
                          {(["worktree", "ref"] as const).map((choice) => (
                            <button
                              key={choice}
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setRoles((prev) => ({ ...prev, [projectId]: choice }));
                                setPlans((current) => {
                                  const next = new Map(current);
                                  next.delete(projectId);
                                  return next;
                                });
                              }}
                              className={cn(
                                "rounded-sm px-1.5 py-0.5",
                                role === choice
                                  ? "bg-accent text-foreground"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {choice === "ref" ? "Ref" : "Worktree"}
                            </button>
                          ))}
                        </div>
                        {role === "ref" ? (
                          <div className="flex justify-end">
                            <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                              Read-only symlink
                            </span>
                          </div>
                        ) : (
                          <Input
                            value={branchOf(projectId)}
                            maxLength={200}
                            aria-label={`Branch for ${project?.name ?? projectId}`}
                            placeholder={suggestedBranch || "branch"}
                            disabled={busy}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setBranches((current) => ({ ...current, [projectId]: value }));
                              setPlans((current) => {
                                const next = new Map(current);
                                next.delete(projectId);
                                return next;
                              });
                            }}
                            className="h-6 min-w-0 font-mono text-2xs"
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {branchErrorText === null ? null : (
              <p className="text-2xs text-destructive">{branchErrorText}</p>
            )}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
