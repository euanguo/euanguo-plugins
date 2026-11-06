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
 * Add one repository's worktree to a feature.
 *
 * The plan is a separate click from the create, because the refusal is the
 * point: a branch already checked out somewhere else is the most common
 * outcome, and the answer names where it is. Showing that after a create would
 * mean the user clicked a button that could never have worked.
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

  const create = async () => {
    if (feature === null || projectId.length === 0) return;
    setBusy(true);
    try {
      const result = await onCreate(feature.id, projectId);
      if (result.outcome === "blocked") {
        setMessage(result.reason ?? "创建失败。");
      } else {
        setMessage(
          result.outcome === "reused"
            ? `已存在，直接登记：${result.path ?? ""}`
            : `已创建：${result.path ?? ""}`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const blocked = plan === null || "error" in plan || plan.outcome === "blocked";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={feature === null ? "添加仓库" : `添加仓库到「${feature.name}」`}
      subtitle="为这个仓库在功能目录里创建一个 worktree，分支由功能名派生。"
      busy={busy}
      width="38rem"
      footer={
        <DialogActions>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            关闭
          </Button>
          <Button onClick={() => void create()} disabled={busy || blocked}>
            {plan !== null && "outcome" in plan && plan.outcome === "reuse"
              ? "登记已有 worktree"
              : "创建 worktree"}
          </Button>
        </DialogActions>
      }
    >
      <div className="grid gap-3">
        <Field label="仓库">
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="rounded-md border border-border p-2 text-xs">
          {plan === null ? (
            <p className="text-muted-foreground">正在读取仓库状态…</p>
          ) : "error" in plan ? (
            <p className="text-destructive">{plan.error}</p>
          ) : (
            <div className="grid gap-1">
              <Row label="分支" value={plan.branch} mono />
              <Row label="目录" value={plan.path} mono />
              <p
                className={cn(
                  plan.outcome === "blocked"
                    ? "text-destructive"
                    : plan.outcome === "reuse"
                      ? "text-muted-foreground"
                      : "text-success",
                )}
              >
                {plan.outcome === "blocked"
                  ? plan.reason
                  : plan.outcome === "reuse"
                    ? "这个 worktree 已经存在，只会补登记。"
                    : "可以创建。"}
              </p>
            </div>
          )}
        </div>

        {message === null ? null : (
          <p className="text-xs text-muted-foreground">{message}</p>
        )}
      </div>
    </Modal>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <span className="w-10 shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 break-all", mono && "font-mono text-2xs")}>
        {value}
      </span>
    </div>
  );
}
