import { useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";

import { Button } from "@bb-ui/button";
import { Input } from "@bb-ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb-ui/select";
import { Z_DIALOG_POPOVER } from "@/components/ui/overlay-layers";
import type { FeaturesApi } from "@/hooks/use-features";
import {
  MAX_REF_ID_LENGTH,
  MAX_REF_TITLE_LENGTH,
  MAX_REF_URL_LENGTH,
  refKindLabel,
  type FeatureRef,
  type RefKind,
} from "@/lib/domain/feature-meta";

/**
 * External tickets, documents, and URL references linked to the feature.
 */
export function OverviewReferencesSection({
  featureId,
  refs,
  onRefsChange,
  api,
}: {
  readonly featureId: string;
  readonly refs: readonly FeatureRef[];
  readonly onRefsChange: Dispatch<SetStateAction<readonly FeatureRef[]>>;
  readonly api: FeaturesApi;
}) {
  const [addingRef, setAddingRef] = useState(false);
  const [newRefKind, setNewRefKind] = useState<RefKind>("link");
  const [newRefId, setNewRefId] = useState("");
  const [newRefTitle, setNewRefTitle] = useState("");
  const [newRefUrl, setNewRefUrl] = useState("");

  const canAddRef =
    !addingRef && (newRefUrl.trim().length > 0 || newRefId.trim().length > 0);

  const handleAddRef = () => {
    const url = newRefUrl.trim();
    const refId = newRefId.trim();
    const title = newRefTitle.trim();
    if (!canAddRef) return;
    setAddingRef(true);
    void api
      .addRef(featureId, {
        kind: newRefKind,
        ...(url.length > 0 ? { url } : {}),
        ...(refId.length > 0 ? { refId } : {}),
        ...(title.length > 0 ? { title } : {}),
      })
      .then((added) => {
        onRefsChange((prev) => [...prev, added]);
        setNewRefId("");
        setNewRefTitle("");
        setNewRefUrl("");
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not add reference."),
      )
      .finally(() => setAddingRef(false));
  };

  const handleRemoveRef = (refId: string) => {
    void api
      .removeRef(featureId, refId)
      .then((ok) => {
        if (ok) onRefsChange((prev) => prev.filter((item) => item.id !== refId));
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not remove reference."),
      );
  };

  return (
    <div className="grid gap-2 rounded-md border border-border p-2.5">
      <h3 className="text-xs font-semibold text-foreground">References &amp; Tickets</h3>
      {refs.length === 0 ? (
        <p className="text-2xs text-muted-foreground">No references attached yet.</p>
      ) : (
        <ul className="grid gap-1">
          {refs.map((ref) => (
            <li
              key={ref.id}
              className="flex items-center justify-between gap-2 rounded bg-muted/30 px-2 py-1 text-2xs"
            >
              <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {refKindLabel(ref.kind)}
                </span>
                {ref.url ? (
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noreferrer"
                    title={ref.url}
                    className="min-w-0 truncate text-foreground underline-offset-2 hover:underline"
                  >
                    {ref.title}
                  </a>
                ) : (
                  <span className="min-w-0 truncate text-foreground">{ref.title}</span>
                )}
                {ref.refId !== null ? (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {ref.refId}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                aria-label={`Remove ${ref.title}`}
                onClick={() => handleRemoveRef(ref.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-1.5 rounded-md border border-border/70 bg-muted/15 p-2">
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-1.5">
          <Select value={newRefKind} onValueChange={(value) => setNewRefKind(value as RefKind)}>
            <SelectTrigger aria-label="Reference kind" className="h-7 px-2 text-2xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              data-harbor-overlay="dialog-popover"
              data-radix-select-content=""
              className={Z_DIALOG_POPOVER}
            >
              <SelectItem value="ticket" className="text-xs">Ticket</SelectItem>
              <SelectItem value="document" className="text-xs">Document</SelectItem>
              <SelectItem value="link" className="text-xs">Link</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={newRefUrl}
            maxLength={MAX_REF_URL_LENGTH}
            placeholder="https://… (optional if ticket/doc ID is set)"
            onChange={(e) => setNewRefUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleAddRef();
              }
            }}
            className="h-7 font-mono text-2xs"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            value={newRefId}
            maxLength={MAX_REF_ID_LENGTH}
            placeholder="ID (e.g. TICKET-123)"
            onChange={(e) => setNewRefId(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleAddRef();
              }
            }}
            className="h-7 w-48 font-mono text-2xs"
          />
          <Input
            value={newRefTitle}
            maxLength={MAX_REF_TITLE_LENGTH}
            placeholder="Title (optional)"
            onChange={(e) => setNewRefTitle(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleAddRef();
              }
            }}
            className="h-7 flex-1 text-2xs"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2.5 text-2xs disabled:opacity-60"
            disabled={!canAddRef}
            onClick={handleAddRef}
          >
            {addingRef ? "Adding…" : "Add ref"}
          </Button>
        </div>
      </div>
    </div>
  );
}
