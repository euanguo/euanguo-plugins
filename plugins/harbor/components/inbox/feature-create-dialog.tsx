import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import {
  asciiSlug,
  featureBranch,
  generateDraftFeatureName,
  validFeatureSlug,
  type Feature,
} from "@/lib/domain/features";
import { validBranchName } from "@/lib/domain/feature-materialize";
import type { FeaturePreset } from "@/lib/domain/feature-presets";

function RerollIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
      aria-hidden
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

export function FeatureCreateDialog({
  open,
  projects,
  existingNames = [],
  onClose,
  onCreate,
  onCreated,
}: {
  open: boolean;
  projects: readonly PluginSidebarProject[];
  existingNames?: readonly string[];
  onClose: () => void;
  onCreate: FeaturesApi["create"];
  onCreated: (feature: Feature, startConversation: boolean) => void;
}) {
  const startChatId = useId();
  const discussFirstId = useId();
  const takenNames = useMemo(() => new Set(existingNames), [existingNames]);
  const takenNamesRef = useRef(takenNames);
  takenNamesRef.current = takenNames;
  const wasOpenRef = useRef(false);
  const [name, setName] = useState("");
  const [draftName, setDraftName] = useState(() => generateDraftFeatureName());
  const [discussFirst, setDiscussFirst] = useState(true);
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
  const resetTask = task.reset;
  const [results, setResults] = useState<{ feature: Feature; repositories: readonly RepositoryResult[] } | null>(null);

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;
    setName("");
    setDraftName(generateDraftFeatureName(takenNamesRef.current));
    setDiscussFirst(true);
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
    resetTask();
    setResults(null);
  }, [open, resetTask]);

  const effectiveName = name.trim().length > 0 ? name.trim() : draftName;
  const defaultRole: "worktree" | "ref" = discussFirst ? "ref" : "worktree";
  const roleOf = (projectId: string): "worktree" | "ref" => roles[projectId] ?? defaultRole;
  const hasWritableRepo = repositories.some((id) => roleOf(id) === "worktree");
  const showBranchOptions = !discussFirst || hasWritableRepo;

  const suggested = asciiSlug(effectiveName);
  const effectiveSlug = slug.trim().length > 0 ? slug.trim() : suggested.length >= 2 ? suggested : null;
  const slugError =
    showBranchOptions && slug.trim().length > 0 && !validFeatureSlug(slug.trim())
      ? "Lowercase letters, digits and single dashes."
      : null;
  const suggestedBranch = effectiveSlug === null ? "" : featureBranch(effectiveSlug);
  const branchOf = (projectId: string) => branches[projectId] ?? suggestedBranch;
  const branchError = repositories
    .filter((id) => roleOf(id) !== "ref")
    .map((id) => branchOf(id).trim())
    .find((v) => v.length > 0 && !validBranchName(v));
  const branchErrorText =
    branchError === undefined ? null : `${branchError} is not a valid branch name.`;

  const handleDiscussFirstToggle = (checked: boolean) => {
    setDiscussFirst(checked);
    const targetRole: "worktree" | "ref" = checked ? "ref" : "worktree";
    setRoles(
      Object.fromEntries(repositories.map((id) => [id, targetRole])),
    );
  };

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
    if (kept.length > 0) {
      setDiscussFirst(kept.every((r) => r.role === "ref"));
    }
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
          role: roleOf(projectId),
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
      const matchedIds = imported.matched.map((item) => item.projectId);
      setRepositories(matchedIds);
      setRoles(Object.fromEntries(matchedIds.map((id) => [id, defaultRole])));
      setUnmatchedPaths([...imported.unmatchedPaths]);
      setImportOpen(false);
    }, "Could not import .code-workspace file.");
  };

  const create = () => {
    if (slugError !== null || branchErrorText !== null || busy) return;
    void task.run(async () => {
      const base = showBranchOptions ? baseBranch.trim() || null : null;
      const customSlug = showBranchOptions && slug.trim().length > 0 ? slug.trim() : null;
      const created = await onCreate({
        name: effectiveName,
        slug: customSlug,
        baseBranch: base,
        repositories: repositories.map((projectId) => {
          const role = roleOf(projectId);
          return {
            projectId,
            role,
            branch: role === "ref" ? null : branches[projectId]?.trim() || null,
            baseBranch: base,
          };
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
      subtitle="Start immediately with a draft name and read-only refs, or set up branches upfront."
      icon="Layers"
      busy={busy}
      width="34rem"
      footer={
        <ConfirmDialogFooter
          cancelLabel="Cancel"
          submitLabel={busy ? (hasWritableRepo ? "Checking out…" : "Creating…") : "Create feature"}
          busy={busy}
          disabled={slugError !== null || branchErrorText !== null}
          onSubmit={create}
          onCancel={onClose}
        />
      }
    >
      <div className="grid gap-3">
        <Field label="Name (optional)" error={task.error}>
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              value={name}
              maxLength={60}
              placeholder={`Leave blank to use "${draftName}"`}
              disabled={busy}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  create();
                }
              }}
              className="min-w-0 flex-1"
            />
            {name.trim().length === 0 ? (
              <button
                type="button"
                disabled={busy}
                aria-label="Generate random draft name"
                title="Roll another draft name"
                onClick={() =>
                  setDraftName(
                    generateDraftFeatureName(new Set([...takenNames, draftName])),
                  )
                }
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <RerollIcon />
              </button>
            ) : null}
          </div>
        </Field>

        <label
          htmlFor={discussFirstId}
          data-harbor-discuss-first-toggle=""
          className="flex cursor-pointer items-start gap-2 rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-xs text-foreground"
        >
          <Checkbox
            id={discussFirstId}
            checked={discussFirst}
            disabled={busy}
            onCheckedChange={(v) => handleDiscussFirstToggle(v === true)}
            className="mt-0.5"
          />
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">
              Discuss first — link repos as read-only refs, branch after alignment
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
              Starts chat using <span className="font-medium text-foreground/85">{effectiveName}</span> with zero premature branches. Once aligned, ask the agent to update Feature Info or initialize worktrees in Feature Hub.
            </span>
          </span>
        </label>

        {showBranchOptions ? (
          <>
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
                "No Latin letters found for an auto slug; a short random slug will be generated unless specified."
              ) : (
                <>
                  Suggested branch <span className="font-mono text-foreground/80">{suggestedBranch}</span>; worktrees branch from{" "}
                  {baseBranch.trim() || "default HEAD"}.
                </>
              )}
            </p>
          </>
        ) : null}

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
                setRoles((cur) => {
                  const updated: Record<string, "worktree" | "ref"> = {};
                  for (const id of next) updated[id] = cur[id] ?? defaultRole;
                  return updated;
                });
                setBranches((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => next.includes(id))));
              }}
              disabled={busy}
              maxHeightClassName="max-h-40"
            />
            <RepoRoleBranchList
              projectIds={repositories}
              projects={projects}
              roles={roles}
              getBranch={branchOf}
              placeholderBranch={suggestedBranch || "branch"}
              disabled={busy}
              listClassName="max-h-32"
              onRoleChange={(id, choice) => {
                const nextRoles = { ...roles, [id]: choice };
                setRoles(nextRoles);
                setDiscussFirst(
                  repositories.length > 0 &&
                    repositories.every((repoId) => (nextRoles[repoId] ?? defaultRole) === "ref"),
                );
              }}
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
