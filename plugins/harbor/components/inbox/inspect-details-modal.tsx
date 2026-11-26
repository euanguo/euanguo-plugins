import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogActions } from "@/components/ui/control";
import { Icon, type IconName } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { copyWithAnnouncement } from "@/lib/ui/clipboard";
import { cn } from "@/lib/ui/utils";
import { workspaceKindLabel, type WorkspaceRef } from "@/lib/domain/workspace";

export interface InspectDetailField {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** Raw text to copy when different from the formatted display value. */
  readonly copyValue?: string;
  readonly mono?: boolean;
  /** Defaults to true when value is non-empty. */
  readonly copyable?: boolean;
}

/**
 * On-demand technical details dialog for rows in the sidebar.
 *
 * Keeps raw identifiers, remote URLs, and full untruncated local paths out of
 * the lightweight hover preview while giving each field a reliable one-click
 * copy button and free text selection.
 */
export function InspectDetailsModal({
  open,
  onClose,
  title,
  subtitle,
  icon = "Info",
  fields,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: IconName;
  fields: readonly InspectDetailField[];
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) setCopiedKey(null);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [open]);

  const handleCopy = async (field: InspectDetailField) => {
    const raw = field.copyValue ?? field.value;
    if (raw.length === 0) return;
    const ok = await copyWithAnnouncement(raw, field.label);
    if (!ok) return;
    setCopiedKey(field.key);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setCopiedKey((current) => (current === field.key ? null : current));
      timerRef.current = null;
    }, 1200);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={icon}
      title={title}
      subtitle={subtitle}
      width="34rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogActions>
      }
    >
      <dl className="flex flex-col divide-y divide-border/60">
        {fields.map((field) => {
          const rawCopy = field.copyValue ?? field.value;
          const canCopy = field.copyable !== false && rawCopy.length > 0;
          const copied = copiedKey === field.key;
          return (
            <div
              key={field.key}
              className="flex min-w-0 items-start gap-3 py-2 first:pt-0 last:pb-0"
            >
              <dt className="w-28 shrink-0 pt-0.5 text-2xs font-medium text-muted-foreground">
                {field.label}
              </dt>
              <dd className="flex min-w-0 flex-1 items-start gap-2">
                <span
                  className={cn(
                    "min-w-0 flex-1 select-text break-words [overflow-wrap:anywhere] text-xs leading-relaxed text-foreground",
                    field.mono && "font-mono text-2xs",
                  )}
                >
                  {field.value}
                </span>
                {canCopy ? (
                  <button
                    type="button"
                    aria-label={`Copy ${field.label}`}
                    title={copied ? "Copied" : `Copy ${field.label}`}
                    onClick={() => void handleCopy(field)}
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70",
                      "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      copied && "text-primary",
                    )}
                  >
                    <Icon
                      name={copied ? "Check" : "Copy"}
                      className="size-3.5"
                      aria-hidden
                    />
                  </button>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </Modal>
  );
}

export function buildWorkspaceInspectFields({
  ref,
  projectName,
  projectId,
  branch,
  path,
  status,
  repoKey,
  remoteUrl,
  hostName,
}: {
  ref: WorkspaceRef;
  projectName: string;
  projectId: string;
  branch: string | null;
  path: string | null;
  status?: string | null;
  repoKey?: string | null;
  remoteUrl?: string | null;
  hostName?: string | null;
}): InspectDetailField[] {
  const fields: InspectDetailField[] = [
    { key: "kind", label: "Kind", value: workspaceKindLabel(ref.kind), copyable: false },
    { key: "project", label: "Project", value: projectName },
    { key: "project-id", label: "Project ID", value: projectId, mono: true },
  ];
  if (ref.alias !== null) {
    fields.push({ key: "alias", label: "Alias", value: ref.alias });
  }
  if (remoteUrl !== undefined && remoteUrl !== null) {
    fields.push({
      key: "remote-url",
      label: "Remote URL",
      value: remoteUrl,
      mono: true,
    });
  }
  if (repoKey !== undefined && repoKey !== null) {
    fields.push({
      key: "repo-key",
      label: "Repository ID",
      value: repoKey,
      mono: true,
    });
  }
  if (hostName !== undefined && hostName !== null) {
    fields.push({ key: "host", label: "Host", value: hostName });
  } else if (ref.hostId !== null) {
    fields.push({ key: "host", label: "Host ID", value: ref.hostId, mono: true });
  }
  if (branch !== null) {
    fields.push({ key: "branch", label: "Branch", value: branch, mono: true });
  }
  if (status !== undefined && status !== null && status.length > 0) {
    fields.push({ key: "status", label: "Status", value: status, copyable: false });
  }
  if (ref.environmentId !== null) {
    fields.push({
      key: "environment-id",
      label: "Environment ID",
      value: ref.environmentId,
      mono: true,
    });
  }
  if (path !== null) {
    fields.push({
      key: "path",
      label: "Local path",
      value: path,
      mono: true,
    });
  }
  if (ref.diagnostic !== null) {
    fields.push({
      key: "diagnostic",
      label: "Diagnostic",
      value: ref.diagnostic,
    });
  }
  return fields;
}

export function buildProjectInspectFields({
  projectId,
  projectName,
  projectPath,
  isPersonal,
  groupName,
  repoKey,
  remoteUrl,
  hostName,
  status,
}: {
  projectId: string;
  projectName: string;
  projectPath: string | null;
  isPersonal: boolean;
  groupName: string;
  repoKey?: string | null;
  remoteUrl?: string | null;
  hostName?: string | null;
  status?: string | null;
}): InspectDetailField[] {
  const fields: InspectDetailField[] = [
    {
      key: "kind",
      label: "Kind",
      value: isPersonal ? "Personal project" : "Project",
      copyable: false,
    },
    { key: "project", label: "Project", value: projectName },
    { key: "project-id", label: "Project ID", value: projectId, mono: true },
    { key: "group", label: "Group", value: groupName, copyable: false },
  ];
  if (remoteUrl !== undefined && remoteUrl !== null) {
    fields.push({
      key: "remote-url",
      label: "Remote URL",
      value: remoteUrl,
      mono: true,
    });
  }
  if (repoKey !== undefined && repoKey !== null) {
    fields.push({
      key: "repo-key",
      label: "Repository ID",
      value: repoKey,
      mono: true,
    });
  }
  if (hostName !== undefined && hostName !== null) {
    fields.push({ key: "host", label: "Host", value: hostName });
  }
  if (status !== undefined && status !== null && status.length > 0) {
    fields.push({ key: "status", label: "Status", value: status, copyable: false });
  }
  if (projectPath !== null) {
    fields.push({
      key: "path",
      label: "Local path",
      value: projectPath,
      mono: true,
    });
  }
  return fields;
}
