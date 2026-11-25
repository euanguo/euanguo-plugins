import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import type { FeaturesApi } from "@/hooks/use-features";
import type { Feature, FeatureMember } from "@/lib/domain/features";
import { cn } from "@/lib/ui/utils";

export function FeatureHubRepos({
  feature,
  members,
  api,
}: {
  readonly feature: Feature;
  readonly members: readonly FeatureMember[];
  readonly api: FeaturesApi;
}) {
  const sdk = useSdk();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [addRole, setAddRole] = useState<"worktree" | "ref">("worktree");
  const [addBranch, setAddBranch] = useState("");
  const [addBaseBranch, setAddBaseBranch] = useState("");
  const [busy, setBusy] = useState(false);

  const [renamingDir, setRenamingDir] = useState<string | null>(null);
  const [branchDraft, setBranchDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    const homes = new Set(Object.values(api.homeProjects));
    const currentDirs = new Set(members.map((m) => m.directory));
    void sdk.projects
      .list({})
      .then((list) => {
        if (cancelled) return;
        const available = list
          .filter((p) => p.kind !== "personal" && !homes.has(p.id) && !currentDirs.has(p.name))
          .map((p) => ({ id: p.id, name: p.name }));
        setProjects(available);
        const first = available[0];
        if (first !== undefined) {
          setSelectedProjectId((prev) =>
            available.some((a) => a.id === prev) ? prev : first.id,
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api.homeProjects, members, sdk]);

  const handleAdd = () => {
    if (!selectedProjectId || busy) return;
    setBusy(true);
    const task =
      addRole === "ref"
        ? api.addReferenceRepo(feature.id, selectedProjectId)
        : api.addRepositories(
            feature.id,
            [
              {
                projectId: selectedProjectId,
                role: "worktree",
                branch: addBranch.trim() || null,
                baseBranch: addBaseBranch.trim() || null,
              },
            ],
            addBaseBranch.trim() || null,
          );
    void task
      .then(() => {
        toast.success(
          addRole === "ref"
            ? "Linked read-only reference repository."
            : "Added repository worktree.",
        );
        setAddBranch("");
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not add repository."),
      )
      .finally(() => setBusy(false));
  };

  const handleRenameBranch = (directory: string) => {
    const clean = branchDraft.trim();
    if (!clean || busy) return;
    setBusy(true);
    void api
      .renameMemberBranch(feature.id, directory, clean)
      .then((res) => {
        if (res.ok) {
          setRenamingDir(null);
          toast.success(`Renamed branch in ${directory}.`);
        } else {
          toast.error(res.reason ?? "Could not rename branch.");
        }
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not rename branch."),
      )
      .finally(() => setBusy(false));
  };

  const handleRemoveMember = (member: FeatureMember) => {
    if (busy) return;
    setBusy(true);
    const run =
      member.role === "ref"
        ? api.removeReferenceRepo(feature.id, member.directory)
        : api.removeRepository(feature.id, member.directory, false);
    void run
      .then(() => toast.success(`Removed ${member.directory}.`))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not remove member."),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div className="grid gap-1.5">
        <h3 className="text-xs font-semibold text-foreground">
          Attached Repositories ({members.length})
        </h3>
        {members.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-2xs text-muted-foreground">
            No repositories attached yet.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {members.map((member) => {
              const isRef = member.role === "ref";
              const isSub = member.role === "submodule";
              return (
                <li
                  key={member.path}
                  className="grid gap-1.5 rounded-md border border-border px-2.5 py-2"
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
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {!isRef && !isSub ? (
                        <Button
                          variant="ghost"
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
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-2xs text-muted-foreground hover:text-destructive"
                          disabled={busy}
                          onClick={() => handleRemoveMember(member)}
                        >
                          {isRef ? "Unlink" : "Remove"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="truncate font-mono text-2xs text-muted-foreground">
                    {isRef
                      ? `Target: ${member.repositoryPath}`
                      : `Branch: ${member.branch ?? "detached"}`}
                  </div>
                  {renamingDir === member.directory ? (
                    <div className="flex items-center gap-1.5 pt-1">
                      <Input
                        value={branchDraft}
                        maxLength={200}
                        disabled={busy}
                        onChange={(e) => setBranchDraft(e.currentTarget.value)}
                        className="h-6 flex-1 font-mono text-2xs"
                      />
                      <Button
                        size="sm"
                        className="h-6 px-2 text-2xs"
                        disabled={busy || branchDraft.trim().length === 0}
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
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Add worktree or read-only ref */}
      <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-2xs font-medium text-foreground">
            Add repository or reference
          </span>
          <div className="inline-flex rounded border border-border p-0.5 text-[10px]">
            {(["worktree", "ref"] as const).map((role) => (
              <button
                key={role}
                type="button"
                disabled={busy}
                onClick={() => setAddRole(role)}
                className={cn(
                  "rounded-sm px-2 py-0.5",
                  addRole === role
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {role === "ref" ? "Read-only Ref" : "Worktree"}
              </button>
            ))}
          </div>
        </div>
        {projects.length === 0 ? (
          <p className="text-2xs text-muted-foreground">
            Every available project is already in this feature.
          </p>
        ) : (
          <div className="grid gap-1.5">
            <select
              value={selectedProjectId}
              disabled={busy}
              onChange={(e) => setSelectedProjectId(e.currentTarget.value)}
              className="h-7 rounded-md border border-border bg-background px-2 text-xs"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {addRole === "worktree" ? (
              <div className="grid grid-cols-2 gap-1.5">
                <Input
                  value={addBranch}
                  placeholder="Branch (auto)"
                  disabled={busy}
                  onChange={(e) => setAddBranch(e.currentTarget.value)}
                  className="h-7 font-mono text-2xs"
                />
                <Input
                  value={addBaseBranch}
                  placeholder="Base (default)"
                  disabled={busy}
                  onChange={(e) => setAddBaseBranch(e.currentTarget.value)}
                  className="h-7 font-mono text-2xs"
                />
              </div>
            ) : null}
            <Button
              size="sm"
              className="h-7 text-2xs"
              disabled={busy || !selectedProjectId}
              onClick={handleAdd}
            >
              {busy
                ? "Working…"
                : addRole === "ref"
                  ? "Link as Read-only Ref"
                  : "Checkout Worktree"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
