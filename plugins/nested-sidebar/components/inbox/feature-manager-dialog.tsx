import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/modal";
import { DialogActions, Field } from "@/components/ui/control";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Feature } from "@/lib/features";
import type { ProjectGroup } from "@/lib/groups";

/**
 * Name a new feature, or file an existing one under a group.
 *
 * Two actions share one box because they are the same decision made at
 * different times: what this piece of work is called, and where it is filed.
 * The dialog never edits the label of a workspace; that happens on the row
 * that carries the label, where the workspace is visible.
 */
export function FeatureManagerDialog({
  open,
  features,
  groups,
  defaultGroupId,
  onClose,
  onCreate,
  onRename,
  onSetGroup,
  onDelete,
}: {
  open: boolean;
  features: readonly Feature[];
  groups: readonly ProjectGroup[];
  defaultGroupId: string | null;
  onClose: () => void;
  onCreate: (name: string, groupId: string | null) => Promise<Feature | null>;
  onRename: (featureId: string, name: string) => Promise<boolean>;
  onSetGroup: (featureId: string, groupId: string | null) => Promise<boolean>;
  onDelete: (featureId: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState<string | null>(defaultGroupId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setGroupId(defaultGroupId);
    setError(null);
    setEditingId(null);
    setConfirmId(null);
  }, [open, defaultGroupId]);

  const create = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("功能需要一个名字。");
      return;
    }
    setBusy(true);
    try {
      const created = await onCreate(trimmed, groupId);
      if (created === null) setError("这个名字不能用作功能。");
      else onClose();
    } catch {
      setError("创建失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="功能"
      subtitle="一个功能是横跨多个仓库的一件事。worktree 通过标签归属到功能下。"
      busy={busy}
      width="34rem"
      footer={
        <DialogActions>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            关闭
          </Button>
          <Button onClick={() => void create()} disabled={busy || name.trim().length === 0}>
            新建功能
          </Button>
        </DialogActions>
      }
    >
      <div className="grid gap-3">
        <Field label="新建功能" error={error}>
          <Input
            value={name}
            placeholder="例如 AI 语音"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void create();
            }}
          />
        </Field>
        <Field label="归档到分组">
          <select
            value={groupId ?? ""}
            onChange={(event) =>
              setGroupId(event.target.value === "" ? null : event.target.value)
            }
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">Ungrouped</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
        {features.length > 0 ? (
          <div className="grid gap-1">
            <p className="text-2xs text-muted-foreground">已有的功能</p>
            <ul className="max-h-56 overflow-y-auto rounded-md border border-border">
              {features.map((feature) => (
                <li
                  key={feature.id}
                  className="flex items-center gap-2 border-b border-border/60 px-2 py-1 last:border-b-0"
                >
                  {editingId === feature.id ? (
                    <Input
                      value={draft}
                      autoFocus
                      onChange={(event) => setDraft(event.target.value)}
                      onBlur={() => setEditingId(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setEditingId(null);
                        if (event.key !== "Enter") return;
                        void onRename(feature.id, draft);
                        setEditingId(null);
                      }}
                      className="h-6 min-w-0 flex-1 text-xs"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {feature.name}
                    </span>
                  )}
                  <select
                    aria-label={`File ${feature.name} under a group`}
                    value={feature.groupId ?? ""}
                    onChange={(event) =>
                      void onSetGroup(
                        feature.id,
                        event.target.value === "" ? null : event.target.value,
                      )
                    }
                    className="h-6 rounded border border-input bg-transparent px-1 text-2xs"
                  >
                    <option value="">Ungrouped</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    title={`Rename ${feature.name}`}
                    className="text-2xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setDraft(feature.name);
                      setEditingId(feature.id);
                    }}
                  >
                    改名
                  </button>
                  <button
                    type="button"
                    title={`Delete ${feature.name}`}
                    className="text-2xs text-destructive hover:underline"
                    onClick={() => {
                      if (confirmId !== feature.id) {
                        setConfirmId(feature.id);
                        return;
                      }
                      setConfirmId(null);
                      void onDelete(feature.id);
                    }}
                  >
                    {confirmId === feature.id ? "确认删除" : "删除"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
