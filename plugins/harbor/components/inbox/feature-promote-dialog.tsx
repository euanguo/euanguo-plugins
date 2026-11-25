import { useEffect, useMemo, useState } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import { RepositoryResults } from "@/components/inbox/feature-create-dialog";
import { RepositoryPicker } from "@/components/inbox/repository-picker";
import { Button } from "@/components/ui/button";
import { ConfirmDialogFooter } from "@/components/ui/confirm-dialog-footer";
import { DialogActions, DialogError, Field } from "@/components/ui/control";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useDialogTask } from "@/hooks/use-dialog-task";
import type {
  FeaturesApi,
  RepositoryResult,
} from "@/hooks/use-features";
import { asciiSlug, validFeatureSlug, type Feature } from "@/lib/domain/features";
import { validBranchName } from "@/lib/domain/feature-materialize";
import { cn } from "@/lib/ui/utils";

function humanizeWorkspaceName(raw: string): string {
  const cleaned = raw
    .replace(/^bb\//u, "")
    .replace(/[-_]thr_[a-z0-9]+$/u, "")
    .trim();
  return cleaned.length > 0 ? cleaned : raw;
}

export function FeaturePromoteDialog({
  open,
  source,
  projects,
  onPromote,
  onPromoted,
  onClose,
}: {
  readonly open: boolean;
  readonly source: {
    readonly environmentId: string;
    readonly workspaceLabel: string;
    readonly branch: string | null;
    readonly projectId: string;
  } | null;
  readonly projects: readonly PluginSidebarProject[];
  readonly onPromote: FeaturesApi["promote"];
  readonly onPromoted: (feature: Feature) => void;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [baseBranch, setBaseBranch] = useState("");
  const [repositories, setRepositories] = useState<string[]>([]);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<Record<string, "worktree" | "ref">>({});
  const [results, setResults] = useState<{
    feature: Feature;
    repositories: readonly RepositoryResult[];
  } | null>(null);
  const task = useDialogTask<unknown>();

  useEffect(() => {
    if (!open || source === null) return;
    const readable = humanizeWorkspaceName(source.workspaceLabel);
    setName(readable);
    setSlug(asciiSlug(readable).slice(0, 40));
    setSlugTouched(false);
    setBaseBranch("");
    setRepositories([]);
    setBranches({});
    setRoles({});
    setResults(null);
    task.reset();
  }, [open, source?.environmentId]);

  const candidates = useMemo(
    () =>
      projects.filter(
        (project) => source === null || project.id !== source.projectId,
      ),
    [projects, source],
  );

  if (!open || source === null) return null;

  const slugError =
    slug.trim().length > 0 && !validFeatureSlug(slug.trim())
      ? "Lowercase letters, digits and single dashes."
      : null;
  const branchError = repositories
    .filter((id) => (roles[id] ?? "worktree") !== "ref")
    .map((id) => branches[id]?.trim() ?? "")
    .find((val) => val.length > 0 && !validBranchName(val));
  const branchErrorText =
    branchError === undefined
      ? null
      : `${branchError} is not a valid branch name.`;

  const submit = () => {
    if (
      task.busy ||
      name.trim().length === 0 ||
      slugError !== null ||
      branchErrorText !== null
    ) {
      return;
    }
    void task.run(async () => {
      const outcome = await onPromote({
        environmentId: source.environmentId,
        name: name.trim(),
        slug: slug.trim() || null,
        baseBranch: baseBranch.trim() || null,
        additionalRepositories: repositories.map((projectId) => {
          const role = roles[projectId] ?? "worktree";
          return {
            projectId,
            role,
            branch:
              role === "ref"
                ? null
                : branches[projectId]?.trim() || null,
            baseBranch: baseBranch.trim() || null,
          };
        }),
      });
      if (outcome.repositories.some((item) => item.outcome === "blocked")) {
        setResults(outcome);
        return;
      }
      onPromoted(outcome.feature);
    }, "Could not promote workspace.");
  };

  if (results !== null) {
    return (
      <Modal
        open
        onClose={() => onPromoted(results.feature)}
        title={`Promoted to ${results.feature.name}`}
        subtitle="Some sibling repositories could not be attached."
        icon="Layers"
        width="32rem"
        footer={
          <DialogActions>
            <Button size="sm" onClick={() => onPromoted(results.feature)}>
              Done
            </Button>
          </DialogActions>
        }
      >
        <RepositoryResults results={results.repositories} />
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!task.busy) onClose();
      }}
      title="Promote to multi-repo feature"
      subtitle="Keep existing threads intact and bring sibling repositories alongside this worktree."
      icon="Layers"
      busy={task.busy}
      width="32rem"
      footer={
        <ConfirmDialogFooter
          cancelLabel="Cancel"
          submitLabel={task.busy ? "Promoting…" : "Promote to Feature"}
          busy={task.busy}
          disabled={
            name.trim().length === 0 ||
            slugError !== null ||
            branchErrorText !== null
          }
          onSubmit={submit}
          onCancel={onClose}
        />
      }
    >
      <div className="grid gap-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs">
          <Icon name="FolderGit" className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-foreground">
              {source.workspaceLabel}
            </p>
            <p className="whitespace-normal text-2xs leading-snug text-muted-foreground">
              {source.branch ? `Branch ${source.branch} · ` : ""}Existing conversation history preserved
            </p>
          </div>
        </div>
        <Field label="Feature name">
          <Input
            autoFocus
            value={name}
            maxLength={60}
            disabled={task.busy}
            onChange={(event) => {
              const nextName = event.currentTarget.value;
              setName(nextName);
              if (!slugTouched) {
                setSlug(asciiSlug(nextName).slice(0, 40));
              }
            }}
          />
        </Field>
        <Field label="Folder slug" error={slugError}>
          <Input
            value={slug}
            maxLength={40}
            disabled={task.busy}
            className="font-mono text-2xs"
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.currentTarget.value.toLowerCase());
            }}
          />
        </Field>
        <Field label="Base branch (optional)">
          <Input
            value={baseBranch}
            maxLength={200}
            disabled={task.busy}
            placeholder="e.g. main"
            className="font-mono text-2xs"
            onChange={(event) => setBaseBranch(event.currentTarget.value)}
          />
        </Field>
        <Field label="Bring sibling repositories along (optional)">
          <div className="grid gap-2">
            <p className="-mt-1 text-2xs text-muted-foreground">
              Checked repositories can be attached as writable Worktrees or read-only Refs.
            </p>
            <RepositoryPicker
              projects={candidates}
              selected={repositories}
              onChange={(next) => setRepositories(next)}
              disabled={task.busy}
              maxHeightClassName="max-h-36"
            />
            {repositories.length === 0 ? null : (
              <ul className="grid max-h-28 gap-1.5 overflow-y-auto rounded-md border border-border px-2 py-1.5">
                {repositories.map((projectId) => {
                  const project = candidates.find((p) => p.id === projectId);
                  const role = roles[projectId] ?? "worktree";
                  return (
                    <li key={projectId} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)] items-center gap-1.5">
                      <span className="truncate text-2xs text-muted-foreground">
                        {project?.name ?? projectId}
                      </span>
                      <div className="inline-flex rounded border border-border p-0.5 text-[10px]">
                        {(["worktree", "ref"] as const).map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            disabled={task.busy}
                            onClick={() =>
                              setRoles((prev) => ({ ...prev, [projectId]: choice }))
                            }
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
                          value={branches[projectId] ?? ""}
                          maxLength={200}
                          disabled={task.busy}
                          placeholder={source.branch ?? "auto"}
                          className="h-6 min-w-0 font-mono text-2xs"
                          onChange={(event) =>
                            setBranches((prev) => ({
                              ...prev,
                              [projectId]: event.currentTarget.value,
                            }))
                          }
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {branchErrorText === null ? null : (
              <p className="text-2xs text-destructive">{branchErrorText}</p>
            )}
          </div>
        </Field>
        {task.error === null ? null : <DialogError>{task.error}</DialogError>}
      </div>
    </Modal>
  );
}
