import { useEffect, useId, useState } from "react";
import { useSdk, type PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import { RepositoryPicker } from "@/components/inbox/repository-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogActions, Field } from "@/components/ui/control";
import { ConfirmDialogFooter } from "@/components/ui/confirm-dialog-footer";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDialogTask } from "@/hooks/use-dialog-task";
import {
  useFeatureCockpitMutations,
  useFeaturePresets,
} from "@/hooks/use-feature-cockpit";
import type { FeaturesApi, RepositoryResult } from "@/hooks/use-features";
import { asciiSlug, featureBranch, validFeatureSlug, type Feature } from "@/lib/domain/features";
import { validBranchName } from "@/lib/domain/feature-materialize";
import type { FeaturePreset } from "@/lib/domain/feature-presets";
import { cn } from "@/lib/ui/utils";

/**
 * Naming a piece of work, applying saved multi-repo templates or `.code-workspace`
 * imports, and choosing worktree vs read-only reference roles per repository.
 */
export function FeatureCreateDialog({
  open,
  projects,
  onClose,
  onCreate,
  onCreated,
}: {
  open: boolean;
  projects: readonly PluginSidebarProject[];
  onClose: () => void;
  onCreate: FeaturesApi["create"];
  onCreated: (feature: Feature, startConversation: boolean) => void;
}) {
  const startChatId = useId();
  const sdk = useSdk();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [repositories, setRepositories] = useState<string[]>([]);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<Record<string, "worktree" | "ref">>({});
  const [start, setStart] = useState(true);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [workspacePath, setWorkspacePath] = useState("");
  const [hosts, setHosts] = useState<{ id: string; name: string }[]>([]);
  const [selectedHostId, setSelectedHostId] = useState("");
  const [unmatchedPaths, setUnmatchedPaths] = useState<string[]>([]);
  const task = useDialogTask<unknown>();
  const presetsQuery = useFeaturePresets(open);
  const { savePreset, deletePreset, importWorkspace } = useFeatureCockpitMutations();
  const busy = task.busy;
  const error = task.error;
  const [results, setResults] = useState<{
    feature: Feature;
    repositories: readonly RepositoryResult[];
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setSlug("");
    setBaseBranch("");
    setRepositories([]);
    setBranches({});
    setRoles({});
    setStart(true);
    setSavingPreset(false);
    setPresetName("");
    setImportOpen(false);
    setWorkspacePath("");
    setUnmatchedPaths([]);
    task.reset();
    setResults(null);
  }, [open]);

  useEffect(() => {
    if (!open || !importOpen) return;
    let cancelled = false;
    void sdk.hosts
      .list()
      .then((list) => {
        if (cancelled) return;
        const simplified = list.map((host) => ({ id: host.id, name: host.name }));
        setHosts(simplified);
        const firstHost = simplified[0];
        if (firstHost !== undefined) {
          setSelectedHostId((prev) => prev || firstHost.id);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [importOpen, open, sdk]);

  const suggested = asciiSlug(name);
  const effectiveSlug =
    slug.trim().length > 0 ? slug.trim() : suggested.length >= 2 ? suggested : null;
  const slugError =
    slug.trim().length > 0 && !validFeatureSlug(slug.trim())
      ? "Lowercase letters, digits and single dashes."
      : null;
  const suggestedBranch = effectiveSlug === null ? "" : featureBranch(effectiveSlug);
  const branchOf = (projectId: string) => branches[projectId] ?? suggestedBranch;
  const branchError = repositories
    .filter((projectId) => (roles[projectId] ?? "worktree") !== "ref")
    .map((projectId) => branchOf(projectId).trim())
    .find((value) => value.length > 0 && !validBranchName(value));
  const branchErrorText =
    branchError === undefined
      ? null
      : `${branchError} is not a valid branch name.`;

  const applyPreset = (preset: FeaturePreset) => {
    const known = new Set(projects.map((p) => p.id));
    const kept = preset.repos.filter((repo) => known.has(repo.projectId));
    setRepositories(kept.map((repo) => repo.projectId));
    setBaseBranch(preset.baseBranch ?? "");
    const nextRoles: Record<string, "worktree" | "ref"> = {};
    const nextBranches: Record<string, string> = {};
    const templateSlug = effectiveSlug ?? asciiSlug(preset.name);
    for (const repo of kept) {
      nextRoles[repo.projectId] = repo.role;
      if (repo.branchTemplate) {
        nextBranches[repo.projectId] = templateSlug
          ? repo.branchTemplate.replaceAll("{slug}", templateSlug)
          : repo.branchTemplate;
      }
    }
    setRoles(nextRoles);
    setBranches(nextBranches);
  };

  const handleSavePreset = () => {
    const clean = presetName.trim();
    if (clean.length === 0 || repositories.length === 0) return;
    void task.run(async () => {
      await savePreset.mutate({
        name: clean,
        baseBranch: baseBranch.trim() || null,
        repos: repositories.map((projectId) => ({
          projectId,
          role: roles[projectId] ?? "worktree",
          branchTemplate: branches[projectId]?.trim() || null,
        })),
      });
      setSavingPreset(false);
      setPresetName("");
      await presetsQuery.refetch();
    }, "Could not save preset.");
  };

  const handleImportWorkspace = () => {
    const cleanPath = workspacePath.trim();
    if (cleanPath.length === 0 || selectedHostId.length === 0) return;
    void task.run(async () => {
      const imported = await importWorkspace.mutate({
        hostId: selectedHostId,
        filePath: cleanPath,
      });
      if (name.trim().length === 0 && imported.name.trim().length > 0) {
        setName(imported.name);
      }
      setRepositories(imported.matched.map((item) => item.projectId));
      setUnmatchedPaths([...imported.unmatchedPaths]);
      setImportOpen(false);
    }, "Could not import .code-workspace file.");
  };

  const create = () => {
    if (name.trim().length === 0 || slugError !== null || branchErrorText !== null || busy) return;
    void task.run(async () => {
      const base = baseBranch.trim() || null;
      const created = await onCreate({
        name: name.trim(),
        slug: slug.trim().length > 0 ? slug.trim() : null,
        baseBranch: base,
        repositories: repositories.map((projectId) => {
          const role = roles[projectId] ?? "worktree";
          return {
            projectId,
            role,
            branch:
              role === "ref"
                ? null
                : branches[projectId]?.trim() || null,
            baseBranch: base,
          };
        }),
      });
      if (created.repositories.some((result) => result.outcome === "blocked")) {
        setResults(created);
        return;
      }
      onCreated(created.feature, start);
    }, "That did not work.");
  };

  if (results !== null) {
    return (
      <Modal
        open={open}
        onClose={() => onCreated(results.feature, false)}
        title={`Created ${results.feature.name}`}
        subtitle="Some repositories could not be added."
        icon="Layers"
        width="32rem"
        footer={
          <DialogActions>
            <Button variant="ghost" size="sm" onClick={() => onCreated(results.feature, false)}>
              Close
            </Button>
            <Button size="sm" onClick={() => onCreated(results.feature, start)}>
              {start ? "Start conversation" : "Done"}
            </Button>
          </DialogActions>
        }
      >
        <RepositoryResults results={results.repositories} />
      </Modal>
    );
  }

  const presets = presetsQuery.data?.presets ?? [];

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="New feature"
      subtitle="One piece of work across repositories, in one folder you can talk in."
      icon="Layers"
      busy={busy}
      width="34rem"
      footer={
        <ConfirmDialogFooter
          cancelLabel="Cancel"
          submitLabel={
            busy
              ? repositories.length > 0
                ? "Checking out…"
                : "Creating…"
              : "Create feature"
          }
          busy={busy}
          disabled={
            name.trim().length === 0 ||
            slugError !== null ||
            branchErrorText !== null
          }
          onSubmit={create}
          onCancel={onClose}
        />
      }
    >
      <div className="grid gap-3">
        <Field label="Name" error={error}>
          <Input
            autoFocus
            value={name}
            maxLength={60}
            placeholder="What are you working on?"
            disabled={busy}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                create();
              }
            }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Branch and folder name" error={slugError}>
            <Input
              value={slug}
              maxLength={40}
              placeholder={suggested.length >= 2 ? suggested : "generated"}
              disabled={busy}
              onChange={(event) => setSlug(event.currentTarget.value.toLowerCase())}
              className="font-mono text-2xs"
            />
          </Field>
          <Field label="Base branch (optional)">
            <Input
              value={baseBranch}
              maxLength={200}
              placeholder="e.g. main"
              disabled={busy}
              onChange={(event) => setBaseBranch(event.currentTarget.value)}
              className="font-mono text-2xs"
            />
          </Field>
        </div>
        <p className="-mt-1.5 text-2xs text-muted-foreground">
          {effectiveSlug === null
            ? name.trim().length === 0
              ? "Enter a feature name to preview the suggested branch and folder slug."
              : "No Latin letters found for an auto slug; a short random slug will be generated unless specified."
            : (
                <>
                  Suggested branch{" "}
                  <span className="font-mono text-foreground/80">{suggestedBranch}</span>; worktrees
                  branch from {baseBranch.trim() || "default HEAD"}.
                </>
              )}
        </p>

        {/* Presets & .code-workspace import toolbar */}
        <div className="grid gap-1.5 rounded-md border border-border/80 bg-muted/20 p-2">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="text-2xs font-medium text-muted-foreground">
              Templates &amp; Workspaces
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-2xs"
                disabled={busy}
                onClick={() => setImportOpen((v) => !v)}
              >
                Import .code-workspace
              </Button>
              {repositories.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-2xs"
                  disabled={busy}
                  onClick={() => setSavingPreset((v) => !v)}
                >
                  Save preset
                </Button>
              ) : null}
            </div>
          </div>
          {presets.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className="inline-flex items-center rounded border border-border bg-background/60 text-2xs"
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => applyPreset(preset)}
                    className="px-2 py-0.5 text-foreground hover:bg-accent/50"
                    title={`Apply preset (${preset.repos.length} repos)`}
                  >
                    {preset.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete preset ${preset.name}`}
                    disabled={busy}
                    onClick={() => {
                      void deletePreset
                        .mutate({ id: preset.id })
                        .then(() => presetsQuery.refetch());
                    }}
                    className="px-1 py-0.5 text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {savingPreset ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={presetName}
                maxLength={60}
                placeholder="Preset name (e.g. Commerce Stack)"
                disabled={busy}
                onChange={(e) => setPresetName(e.currentTarget.value)}
                className="h-6 flex-1 text-2xs"
              />
              <Button
                type="button"
                size="sm"
                className="h-6 px-2 text-2xs"
                disabled={busy || presetName.trim().length === 0}
                onClick={handleSavePreset}
              >
                Save
              </Button>
            </div>
          ) : null}
          {importOpen ? (
            <div className="grid gap-1.5 pt-1">
              <div className="flex items-center gap-1.5">
                {hosts.length > 1 ? (
                  <Select
                    value={selectedHostId}
                    disabled={busy}
                    onValueChange={(value) => setSelectedHostId(value)}
                  >
                    <SelectTrigger className="h-6 w-auto min-w-24 border-foreground/20! bg-background/80! px-1.5 text-2xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {hosts.map((host) => (
                        <SelectItem key={host.id} value={host.id} className="text-2xs">
                          {host.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                <Input
                  value={workspacePath}
                  placeholder="/repos/stack.code-workspace"
                  disabled={busy}
                  onChange={(e) => setWorkspacePath(e.currentTarget.value)}
                  className="h-6 flex-1 font-mono text-2xs"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-6 px-2 text-2xs"
                  disabled={busy || workspacePath.trim().length === 0}
                  onClick={handleImportWorkspace}
                >
                  Load
                </Button>
              </div>
            </div>
          ) : null}
          {unmatchedPaths.length > 0 ? (
            <div className="harbor-ref-banner flex items-start gap-1.5 rounded border px-2 py-1 text-2xs">
              <Icon name="AlertCircle" className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span>
                Unmatched workspace folders skipped: {unmatchedPaths.join(", ")}
              </span>
            </div>
          ) : null}
        </div>

        <Field label="Repositories (optional)">
          <div className="grid min-w-0 gap-2">
            <RepositoryPicker
              projects={projects}
              selected={repositories}
              onChange={(next) => {
                setRepositories(next);
                setBranches((current) =>
                  Object.fromEntries(
                    Object.entries(current).filter(([projectId]) => next.includes(projectId)),
                  ),
                );
              }}
              disabled={busy}
              maxHeightClassName="max-h-36"
            />
            {repositories.length === 0 ? null : (
              <ul className="grid max-h-32 gap-1.5 overflow-y-auto rounded-md border border-border px-2 py-1.5">
                {repositories.map((projectId) => {
                  const project = projects.find((candidate) => candidate.id === projectId);
                  const role = roles[projectId] ?? "worktree";
                  return (
                    <li
                      key={projectId}
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)] items-center gap-1.5"
                    >
                      <span className="truncate text-2xs font-medium text-foreground/90">
                        {project?.name ?? projectId}
                      </span>
                      <div className="inline-flex rounded border border-border bg-muted/40 p-0.5 text-[10px]">
                        {(["worktree", "ref"] as const).map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setRoles((prev) => ({ ...prev, [projectId]: choice }))
                            }
                            className={cn(
                              "rounded-sm px-1.5 py-0.5 transition-colors",
                              role === choice
                                ? "bg-state-active font-medium text-foreground shadow-xs"
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
                          onChange={(event) =>
                            setBranches((current) => ({
                              ...current,
                              [projectId]: event.currentTarget.value,
                            }))
                          }
                          className="h-6 min-w-0 font-mono text-2xs"
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
        <label
          htmlFor={startChatId}
          className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
        >
          <Checkbox
            id={startChatId}
            checked={start}
            disabled={busy}
            onCheckedChange={(value) => setStart(value === true)}
          />
          Start a conversation in it
        </label>
      </div>
    </Modal>
  );
}

/** What happened to each repository, one line each. */
export function RepositoryResults({ results }: { results: readonly RepositoryResult[] }) {
  return (
    <ul className="grid gap-1.5">
      {results.map((result) => (
        <li key={result.projectId} className="flex min-w-0 items-start gap-2 text-xs">
          <Icon
            name={result.outcome === "blocked" ? "AlertCircle" : "Check"}
            className={cn(
              "mt-0.5 size-3.5 shrink-0",
              result.outcome === "blocked" ? "text-destructive" : "text-muted-foreground",
            )}
            aria-hidden
          />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="break-words text-foreground">{result.repository || result.projectId}</span>
            <span className="break-words text-2xs text-muted-foreground">
              {result.outcome === "blocked"
                ? result.reason
                : result.role === "ref"
                  ? `${result.outcome === "reused" ? "Already linked" : "Linked"} read-only reference.`
                  : `${result.outcome === "reused" ? "Already there" : "Checked out"} on ${result.branch}. ${result.setup.join(" ")}`}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
