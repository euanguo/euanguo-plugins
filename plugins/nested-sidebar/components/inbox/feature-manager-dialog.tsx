import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/modal";
import { DialogActions, Field } from "@/components/ui/control";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Feature } from "@/lib/features";
import type { ProjectGroup } from "@/lib/groups";

/**
 * Naming a feature, and where it is filed.
 *
 * One box because they are the same decision made at different times: what this
 * piece of work is called, and which group it is archived under. The dialog
 * never edits a workspace's label; that happens on the row that carries it.
 */
export function FeatureManagerDialog({
  open,
  features,
  groups,
  defaultGroupId,
  onClose,
  onCreate,
  onSetGroup,
}: {
  open: boolean;
  features: readonly Feature[];
  groups: readonly ProjectGroup[];
  defaultGroupId: string | null;
  onClose: () => void;
  onCreate: (name: string, groupId: string | null) => Promise<Feature | null>;
  onSetGroup: (featureId: string, groupId: string | null) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState<string | null>(defaultGroupId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setGroupId(defaultGroupId);
    setError(null);
  }, [open, defaultGroupId]);

  const create = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("A feature needs a name.");
      return;
    }
    setBusy(true);
    onCreate(trimmed, groupId)
      .then((created) => {
        if (created === null) setError("That name cannot be used for a feature.");
        else onClose();
      })
      .catch(() => setError("That did not work."))
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="New feature"
      subtitle="A feature is one piece of work that spans repositories."
      icon="Tag"
      busy={busy}
      width="30rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || name.trim().length === 0}
            onClick={create}
          >
            {busy ? "Creating…" : "Create feature"}
          </Button>
        </DialogActions>
      }
    >
      <div className="grid gap-3">
        <Field label="Name" error={error}>
          <Input
            autoFocus
            value={name}
            placeholder="New feature name"
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim().length > 0) {
                event.preventDefault();
                create();
              }
            }}
          />
        </Field>
        <Field label="Group">
          <select
            value={groupId ?? ""}
            onChange={(event) =>
              setGroupId(event.currentTarget.value === "" ? null : event.currentTarget.value)
            }
            className="h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs"
          >
            <option value="">Ungrouped</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
        {features.length === 0 ? null : (
          <div className="grid gap-1">
            <p className="text-2xs text-muted-foreground">Filed features</p>
            <ul className="max-h-56 overflow-y-auto rounded-md border border-border">
              {features.map((feature) => (
                <li
                  key={feature.id}
                  className="flex items-center gap-2 border-b border-border/60 px-2 py-1 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {feature.name}
                  </span>
                  <select
                    aria-label={`File ${feature.name} under a group`}
                    value={feature.groupId ?? ""}
                    onChange={(event) =>
                      void onSetGroup(
                        feature.id,
                        event.currentTarget.value === "" ? null : event.currentTarget.value,
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
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
