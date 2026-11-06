import { useEffect, useState } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import { Modal } from "@/components/ui/modal";
import { DialogActions, Field } from "@/components/ui/control";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Feature } from "@/lib/features";

type Plan =
  | {
      outcome: "create" | "reuse" | "blocked";
      path: string;
      branch: string;
      repositoryName: string;
      reason: string | null;
    }
  | { error: string };

/**
 * Adding one repository's worktree to a feature.
 *
 * The plan is read before the button is enabled, because the common answer is a
 * refusal: a branch is checked out in one worktree at a time, and a person
 * should see where it is held before agreeing to anything.
 */
export function FeatureMaterializeDialog({
  open,
  feature,
  projects,
  onClose,
  onPlan,
  onCreate,
}: {
  open: boolean;
  feature: Feature | null;
  projects: readonly PluginSidebarProject[];
  onClose: () => void;
  onPlan: (featureId: string, projectId: string) => Promise<Plan>;
  onCreate: (
    featureId: string,
    projectId: string,
  ) => Promise<{
    outcome: "created" | "reused" | "blocked";
    path: string | null;
    branch: string | null;
    reason: string | null;
  }>;
}) {
  const [projectId, setProjectId] = useState<string>("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProjectId(projects[0]?.id ?? "");
    setPlan(null);
    setMessage(null);
  }, [open, projects]);

  useEffect(() => {
    if (!open || feature === null || projectId.length === 0) return;
    let cancelled = false;
    setPlan(null);
    setMessage(null);
    void onPlan(feature.id, projectId).then((next) => {
      if (!cancelled) setPlan(next);
    });
    return () => {
      cancelled = true;
    };
  }, [open, feature, projectId, onPlan]);

  const create = () => {
    if (feature === null || projectId.length === 0) return;
    setBusy(true);
    onCreate(feature.id, projectId)
      .then((result) => {
        setMessage(
          result.outcome === "blocked"
            ? (result.reason ?? "That did not work.")
            : result.outcome === "reused"
              ? `Already there, added to the feature: ${result.path ?? ""}`
              : `Created ${result.path ?? ""}`,
        );
      })
      .catch(() => setMessage("That did not work."))
      .finally(() => setBusy(false));
  };

  const blocked =
    plan === null || "error" in plan || plan.outcome === "blocked";

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={feature === null ? "Add repository" : `Add a repository to ${feature.name}`}
      subtitle="Creates one worktree in the feature directory, on a branch named after the feature."
      icon="FolderGit"
      busy={busy}
      width="34rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Close
          </Button>
          <Button size="sm" disabled={busy || blocked} onClick={create}>
            {plan !== null && "outcome" in plan && plan.outcome === "reuse"
              ? "Add existing worktree"
              : "Create worktree"}
          </Button>
        </DialogActions>
      }
    >
      <div className="grid gap-3">
        <Field label="Repository">
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.currentTarget.value)}
            className="h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="rounded-md border border-border px-2 py-1.5 text-xs">
          {plan === null ? (
            <p className="text-muted-foreground">Reading the repository…</p>
          ) : "error" in plan ? (
            <p className="text-destructive">{plan.error}</p>
          ) : (
            <dl className="grid gap-0.5">
              <div className="flex gap-2">
                <dt className="w-12 shrink-0 text-muted-foreground">Branch</dt>
                <dd className="min-w-0 flex-1 break-all font-mono text-2xs">
                  {plan.branch}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-12 shrink-0 text-muted-foreground">Folder</dt>
                <dd className="min-w-0 flex-1 break-all font-mono text-2xs">
                  {plan.path}
                </dd>
              </div>
              <p
                className={cn(
                  "mt-1",
                  plan.outcome === "blocked"
                    ? "text-destructive"
                    : plan.outcome === "reuse"
                      ? "text-muted-foreground"
                      : "text-primary",
                )}
              >
                {plan.outcome === "blocked"
                  ? plan.reason
                  : plan.outcome === "reuse"
                    ? "This worktree already exists. It will only be added to the feature."
                    : "Ready to create."}
              </p>
            </dl>
          )}
        </div>

        {message === null ? null : (
          <p className="text-xs text-muted-foreground">{message}</p>
        )}
      </div>
    </Modal>
  );
}
