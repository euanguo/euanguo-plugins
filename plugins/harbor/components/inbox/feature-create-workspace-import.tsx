import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";

import { Button } from "@bb-ui/button";
import { Icon } from "@bb-ui/icon";
import { Input } from "@bb-ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb-ui/select";
import { Z_DIALOG_POPOVER } from "@/components/ui/overlay-layers";

/**
 * Host + file path selector to import a `.code-workspace` into the create form.
 */
export function FeatureCreateWorkspaceImport({
  dialogOpen,
  open,
  busy,
  workspacePath,
  unmatchedPaths,
  onPathChange,
  onImport,
}: {
  readonly dialogOpen: boolean;
  readonly open: boolean;
  readonly busy: boolean;
  readonly workspacePath: string;
  readonly unmatchedPaths: readonly string[];
  readonly onPathChange: (value: string) => void;
  readonly onImport: (hostId: string, filePath: string) => void;
}) {
  const sdk = useSdk();
  const [hosts, setHosts] = useState<{ id: string; name: string }[]>([]);
  const [selectedHostId, setSelectedHostId] = useState("");

  useEffect(() => {
    if (!dialogOpen || !open) return;
    let cancelled = false;
    void sdk.hosts
      .list()
      .then((list) => {
        if (cancelled) return;
        const simplified = list.map((host) => ({ id: host.id, name: host.name }));
        setHosts(simplified);
        const firstHost = simplified[0];
        if (firstHost !== undefined) setSelectedHostId((prev) => prev || firstHost.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [dialogOpen, open, sdk]);

  const cleanPath = workspacePath.trim();

  return (
    <>
      {open ? (
        <div className="grid gap-1.5 pt-1">
          <div className="flex items-center gap-1.5">
            {hosts.length > 1 ? (
              <Select
                value={selectedHostId}
                disabled={busy}
                onValueChange={setSelectedHostId}
              >
                <SelectTrigger className="h-6 w-auto min-w-24 border-foreground/20! bg-background/80! px-1.5 text-2xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  data-harbor-overlay="dialog-popover"
                  data-radix-select-content=""
                  className={Z_DIALOG_POPOVER}
                >
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
              onChange={(e) => onPathChange(e.currentTarget.value)}
              className="h-6 flex-1 font-mono text-2xs"
            />
            <Button
              type="button"
              size="sm"
              className="h-6 px-2 text-2xs"
              disabled={busy || cleanPath.length === 0 || selectedHostId.length === 0}
              onClick={() => onImport(selectedHostId, cleanPath)}
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
    </>
  );
}
