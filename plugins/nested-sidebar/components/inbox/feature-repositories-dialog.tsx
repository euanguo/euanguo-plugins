import { useEffect, useMemo, useState } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import { RepositoryResults } from "@/components/inbox/feature-create-dialog";
import { RepositoryPicker } from "@/components/inbox/repository-picker";
import { Button } from "@/components/ui/button";
import { DialogActions, Field } from "@/components/ui/control";
import { Modal } from "@/components/ui/modal";
import type { FeaturesApi, RepositoryPlan, RepositoryResult } from "@/hooks/use-features";
import {
  featureBranch,
  normalizeFeaturePath,
  type Feature,
  type FeatureMember,
} from "@/lib/features";

/**
 * What a feature contains, and the way to change it.
 *
 * The list on top is read from the folder, so it shows a worktree an agent
 * created by hand as readily as one made here. Below it, repositories not yet in
 * the feature can be ticked; each ticked one is checked against git straight
 * away and says, on its own row, what would happen — the branch it gets, or why
 * it cannot be added.
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
  const [plans, setPlans] = useState<ReadonlyMap<string, RepositoryPlan>>(new Map());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<readonly RepositoryResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ directory: string; message: string | null } | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setPlans(new Map());
    setResults(null);
    setError(null);
    setRemoving(null);
  }, [open, feature?.id]);

  const inFeature = useMemo(
    () => new Set(members.map((member) => normalizeFeaturePath(member.repositoryPath))),
    [members],
  );
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
        missing.map((projectId) => ({ projectId, branch: null })),
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
        if (!cancelled) setError(messageOf(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [api, feature, open, plans, selected]);

  const status = useMemo(() => {
    const lines = new Map<string, { text: string; tone: "muted" | "ok" | "bad" }>();
    for (const projectId of selected) {
      const plan = plans.get(projectId);
      lines.set(
        projectId,
        plan === undefined
          ? { text: "Checking…", tone: "muted" }
          : plan.outcome === "blocked"
            ? { text: plan.reason ?? "Cannot be added.", tone: "bad" }
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
  }, [plans, selected]);

  const addable = selected.filter((projectId) => {
    const plan = plans.get(projectId);
    return plan !== undefined && plan.outcome !== "blocked";
  });

  const add = () => {
    if (feature === null || addable.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    api
      .addRepositories(
        feature.id,
        addable.map((projectId) => ({ projectId, branch: null })),
      )
      .then((answer) => {
        setResults(answer);
        setSelected([]);
        setPlans(new Map());
      })
      .catch((failure: unknown) => setError(messageOf(failure)))
      .finally(() => setBusy(false));
  };

  const remove = (directory: string, force: boolean) => {
    if (feature === null || busy) return;
    setBusy(true);
    api
      .removeRepository(feature.id, directory, force)
      .then(() => setRemoving(null))
      .catch((failure: unknown) => setRemoving({ directory, message: messageOf(failure) }))
      .finally(() => setBusy(false));
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
          New ones start on <span className="font-mono">{featureBranch(feature.slug)}</span>
        </>
      }
      icon="FolderGit"
      busy={busy}
      width="34rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Done
          </Button>
          <Button size="sm" disabled={busy || addable.length === 0} onClick={add}>
            {busy && addable.length > 0
              ? "Checking out…"
              : addable.length <= 1
                ? "Add repository"
                : `Add ${addable.length} repositories`}
          </Button>
        </DialogActions>
      }
    >
      <div className="grid gap-4">
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
                  className="grid gap-1 border-b border-border/60 px-2 py-1.5 last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                      {member.directory}
                    </span>
                    <span className="min-w-0 max-w-[45%] truncate font-mono text-2xs text-muted-foreground">
                      {member.branch ?? "detached"}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setRemoving({ directory: member.directory, message: null })}
                    >
                      Remove
                    </Button>
                  </div>
                  {removing?.directory === member.directory ? (
                    <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-2 py-1.5">
                      <p className="min-w-0 flex-1 text-2xs text-destructive">
                        {removing.message ??
                          "Its worktree is removed and its threads are archived. The branch is kept."}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setRemoving(null)}
                      >
                        Keep
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
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
          <RepositoryPicker
            projects={candidates}
            selected={selected}
            onChange={setSelected}
            status={status}
            disabled={busy}
          />
        </Field>
      </div>
    </Modal>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "That did not work.";
}
