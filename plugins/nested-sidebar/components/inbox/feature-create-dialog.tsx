import { useEffect, useState } from "react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

import { RepositoryPicker } from "@/components/inbox/repository-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogActions, Field } from "@/components/ui/control";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { FeaturesApi, RepositoryResult } from "@/hooks/use-features";
import { asciiSlug, featureBranch, validFeatureSlug, type Feature } from "@/lib/features";
import { validBranchName } from "@/lib/feature-materialize";
import { cn } from "@/lib/utils";

/**
 * Naming a piece of work, and saying where it touches.
 *
 * Everything is optional except the name: a feature with no repositories is a
 * folder to plan in, and the first conversation is where the plan happens.
 * Repositories chosen here are checked out straight away, each on its own
 * branch: the feature's slug suggests one, and any repository may take a
 * different name or an existing branch instead.
 *
 * "Start a conversation" is on by default, because naming the work and starting
 * on it are, for most people, the same moment.
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
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [repositories, setRepositories] = useState<string[]>([]);
  /**
   * Branches the person typed, per repository. A repository with no entry
   * follows the suggestion, which moves as the slug changes; one they typed
   * stays theirs.
   */
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [start, setStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{
    feature: Feature;
    repositories: readonly RepositoryResult[];
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setSlug("");
    setRepositories([]);
    setBranches({});
    setStart(true);
    setError(null);
    setResults(null);
  }, [open]);

  const suggested = asciiSlug(name);
  const effectiveSlug = slug.trim().length > 0 ? slug.trim() : suggested.length >= 2 ? suggested : null;
  const slugError =
    slug.trim().length > 0 && !validFeatureSlug(slug.trim())
      ? "Lowercase letters, digits and single dashes."
      : null;
  const suggestedBranch = effectiveSlug === null ? "" : featureBranch(effectiveSlug);
  const branchOf = (projectId: string) => branches[projectId] ?? suggestedBranch;
  const branchError = repositories
    .map((projectId) => branchOf(projectId).trim())
    .find((value) => value.length > 0 && !validBranchName(value));
  const branchErrorText =
    branchError === undefined
      ? null
      : `${branchError} is not a valid branch name.`;

  const create = () => {
    if (name.trim().length === 0 || slugError !== null || branchErrorText !== null || busy) return;
    setBusy(true);
    setError(null);
    onCreate({
      name: name.trim(),
      slug: slug.trim().length > 0 ? slug.trim() : null,
      repositories: repositories.map((projectId) => ({
        projectId,
        branch: branches[projectId]?.trim() ? branches[projectId].trim() : null,
      })),
    })
      .then((created) => {
        // A refusal is worth stopping for: the person picked that repository
        // and is owed the reason it is not there. Otherwise the dialog gets out
        // of the way.
        if (created.repositories.some((result) => result.outcome === "blocked")) {
          setResults(created);
          return;
        }
        onCreated(created.feature, start);
      })
      .catch((failure: unknown) => setError(messageOf(failure)))
      .finally(() => setBusy(false));
  };

  if (results !== null) {
    return (
      <Modal
        open={open}
        onClose={() => onCreated(results.feature, false)}
        title={`Created ${results.feature.name}`}
        subtitle="Some repositories could not be added."
        icon="Tag"
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

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="New feature"
      subtitle="One piece of work across repositories, in one folder you can talk in."
      icon="Tag"
      busy={busy}
      width="32rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={
              busy ||
              name.trim().length === 0 ||
              slugError !== null ||
              branchErrorText !== null
            }
            onClick={create}
          >
            {busy
              ? repositories.length > 0
                ? "Checking out…"
                : "Creating…"
              : "Create feature"}
          </Button>
        </DialogActions>
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
        <p className="-mt-1.5 text-2xs text-muted-foreground">
          {effectiveSlug === null
            ? "The name has no Latin letters, so a short random name is used. Type one to choose it."
            : (
                <>
                  Suggested branch{" "}
                  <span className="font-mono text-foreground/80">{suggestedBranch}</span>; each
                  repository can use its own.
                </>
              )}
        </p>
        <Field label="Repositories (optional)">
          <div className="grid gap-2">
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
            />
            {repositories.length === 0 ? null : (
              <ul className="grid gap-1 rounded-md border border-border px-2 py-1.5">
                {repositories.map((projectId) => {
                  const project = projects.find((candidate) => candidate.id === projectId);
                  return (
                    <li key={projectId} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                        {project?.name ?? projectId}
                      </span>
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
                        className="h-6 w-52 font-mono text-2xs"
                      />
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
        <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
          <Checkbox
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
        <li key={result.projectId} className="flex items-start gap-2 text-xs">
          <Icon
            name={result.outcome === "blocked" ? "AlertCircle" : "Check"}
            className={cn(
              "mt-0.5 size-3.5 shrink-0",
              result.outcome === "blocked" ? "text-destructive" : "text-muted-foreground",
            )}
            aria-hidden
          />
          <span className="grid min-w-0 gap-0.5">
            <span className="text-foreground">{result.repository || result.projectId}</span>
            <span className="break-words text-2xs text-muted-foreground">
              {result.outcome === "blocked"
                ? result.reason
                : `${result.outcome === "reused" ? "Already there" : "Checked out"} on ${result.branch}. ${result.setup.join(" ")}`}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "That did not work.";
}
