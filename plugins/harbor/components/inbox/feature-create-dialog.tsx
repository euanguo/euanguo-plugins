import { useEffect, useId, useState } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import { FeatureCreatePresetBar } from "@/components/inbox/feature-create-preset-bar";
import { FeatureCreateWorkspaceImport } from "@/components/inbox/feature-create-workspace-import";
import { RepositoryPicker } from "@/components/inbox/repository-picker";
import { RepositoryResultsModal } from "@/components/inbox/repository-results";
import { RepoRoleBranchList } from "@/components/inbox/repo-role-branch-list";
import { Checkbox } from "@bb-ui/checkbox";
import { ConfirmDialogFooter } from "@/components/ui/confirm-dialog-footer";
import { Field } from "@/components/ui/control";
import { Input } from "@bb-ui/input";
import { Modal } from "@/components/ui/modal";
import { useDialogTask } from "@/hooks/use-dialog-task";
import { useFeatureCockpitMutations, useFeaturePresets } from "@/hooks/use-feature-cockpit";
import type { FeaturesApi, RepositoryResult } from "@/hooks/use-features";
import { asciiSlug, featureBranch, validFeatureSlug, type Feature } from "@/lib/domain/features";
import { validBranchName } from "@/lib/domain/feature-materialize";
import type { FeaturePreset } from "@/lib/domain/feature-presets";

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
  const [unmatchedPaths, setUnmatchedPaths] = useState<string[]>([]);
  const task = useDialogTask<unknown>();
  const presetsQuery = useFeaturePresets(open);
  const { savePreset, deletePreset, importWorkspace } = useFeatureCockpitMutations();
  const busy = task.busy;
  const [results, setResults] = useState<{ feature: Feature; repositories: readonly RepositoryResult[] } | null>(null);

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

  const suggested = asciiSlug(name);
  const effectiveSlug = slug.trim().length > 0 ? slug.trim() : suggested.length >= 2 ? suggested : null;
  const slugError =
    slug.trim().length > 0 && !validFeatureSlug(slug.trim()) ? "Lowercase letters, digits and single dashes." : null;
  const suggestedBranch = effectiveSlug === null ? "" : featureBranch(effectiveSlug);
  const branchOf = (projectId: string) => branches[projectId] ?? suggestedBranch;
  const branchError = repositories
    .filter((id) => (roles[id] ?? "worktree") !== "ref")
    .map((id) => branchOf(id).trim())
    .find((v) => v.length > 0 && !validBranchName(v));
  const branchErrorText = branchError === undefined ? null : `${branchError} is not a valid branch name.`;

  const applyPreset = (preset: FeaturePreset) => {
    const known = new Set(projects.map((p) => p.id));
    const kept = preset.repos.filter((r) => known.has(r.projectId));
    setRepositories(kept.map((r) => r.projectId));
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

  const handleImportWorkspace = (hostId: string, filePath: string) => {
    void task.run(async () => {
      const imported = await importWorkspace.mutate({ hostId, filePath });
      if (name.trim().length === 0 && imported.name.trim().length > 0) setName(imported.name);
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
          return { projectId, role, branch: role === "ref" ? null : branches[projectId]?.trim() || null, baseBranch: base };
        }),
      });
      if (created.repositories.some((r) => r.outcome === "blocked")) {
        setResults(created);
        return;
      }
      onCreated(created.feature, start);
    }, "That did not work.");
  };

  if (results !== null) {
    return (
      <RepositoryResultsModal
        open={open}
        title={`Created ${results.feature.name}`}
        results={results.repositories}
        confirmLabel={start ? "Start conversation" : "Done"}
        onClose={() => onCreated(results.feature, false)}
        onConfirm={() => onCreated(results.feature, start)}
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title="New feature"
      subtitle="One piece of work across repositories, in one folder you can talk in."
      icon="Layers"
      busy={busy}
      width="34rem"
      footer={
        <ConfirmDialogFooter
          cancelLabel="Cancel"
          submitLabel={busy ? (repositories.length > 0 ? "Checking out…" : "Creating…") : "Create feature"}
          busy={busy}
          disabled={name.trim().length === 0 || slugError !== null || branchErrorText !== null}
          onSubmit={create}
          onCancel={onClose}
        />
      }
    >
      <div className="grid gap-3">
        <Field label="Name" error={task.error}>
          <Input
            autoFocus
            value={name}
            maxLength={60}
            placeholder="What are you working on?"
            disabled={busy}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
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
              onChange={(e) => setSlug(e.currentTarget.value.toLowerCase())}
              className="font-mono text-2xs"
            />
          </Field>
          <Field label="Base branch (optional)">
            <Input
              value={baseBranch}
              maxLength={200}
              placeholder="e.g. main"
              disabled={busy}
              onChange={(e) => setBaseBranch(e.currentTarget.value)}
              className="font-mono text-2xs"
            />
          </Field>
        </div>
        <p className="-mt-1.5 text-2xs text-muted-foreground">
          {effectiveSlug === null ? (
            name.trim().length === 0
              ? "Enter a feature name to preview the suggested branch and folder slug."
              : "No Latin letters found for an auto slug; a short random slug will be generated unless specified."
          ) : (
            <>
              Suggested branch <span className="font-mono text-foreground/80">{suggestedBranch}</span>; worktrees branch from{" "}
              {baseBranch.trim() || "default HEAD"}.
            </>
          )}
        </p>
        <div className="grid gap-1.5 rounded-md border border-border/80 bg-muted/20 p-2">
          <FeatureCreatePresetBar
            presets={presetsQuery.data?.presets ?? []}
            busy={busy}
            hasRepositories={repositories.length > 0}
            savingPreset={savingPreset}
            presetName={presetName}
            onToggleImport={() => setImportOpen((v) => !v)}
            onToggleSave={() => setSavingPreset((v) => !v)}
            onPresetNameChange={setPresetName}
            onApplyPreset={applyPreset}
            onSavePreset={handleSavePreset}
            onDeletePreset={(id) => void deletePreset.mutate({ id }).then(() => presetsQuery.refetch())}
          />
          <FeatureCreateWorkspaceImport
            dialogOpen={open}
            open={importOpen}
            busy={busy}
            workspacePath={workspacePath}
            unmatchedPaths={unmatchedPaths}
            onPathChange={setWorkspacePath}
            onImport={handleImportWorkspace}
          />
        </div>
        <Field label="Repositories (optional)">
          <div className="grid min-w-0 gap-2">
            <RepositoryPicker
              projects={projects}
              selected={repositories}
              onChange={(next) => {
                setRepositories(next);
                setBranches((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => next.includes(id))));
              }}
              disabled={busy}
              maxHeightClassName="max-h-36"
            />
            <RepoRoleBranchList
              projectIds={repositories}
              projects={projects}
              roles={roles}
              getBranch={branchOf}
              placeholderBranch={suggestedBranch || "branch"}
              disabled={busy}
              listClassName="max-h-32"
              onRoleChange={(id, choice) => setRoles((prev) => ({ ...prev, [id]: choice }))}
              onBranchChange={(id, val) => setBranches((cur) => ({ ...cur, [id]: val }))}
            />
            {branchErrorText === null ? null : <p className="text-2xs text-destructive">{branchErrorText}</p>}
          </div>
        </Field>
        <label htmlFor={startChatId} className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
          <Checkbox id={startChatId} checked={start} disabled={busy} onCheckedChange={(v) => setStart(v === true)} />
          Start a conversation in it
        </label>
      </div>
    </Modal>
  );
}
