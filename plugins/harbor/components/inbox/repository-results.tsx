import { Button } from "@/components/ui/button";
import { DialogActions } from "@/components/ui/control";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import type { RepositoryResult } from "@/hooks/use-features";
import { cn } from "@/lib/ui/utils";

/** What happened to each repository when creating/adding/promoting a feature. */
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

/** Modal displaying repository outcome details when some repos could not be added. */
export function RepositoryResultsModal({
  open,
  title,
  results,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  results: readonly RepositoryResult[];
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle="Some repositories could not be added."
      icon="Layers"
      width="32rem"
      footer={
        <DialogActions>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogActions>
      }
    >
      <RepositoryResults results={results} />
    </Modal>
  );
}
