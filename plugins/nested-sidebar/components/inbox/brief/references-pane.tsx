import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/control";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  refKindLabel,
  type FeatureRef,
  type RefKind,
} from "@/lib/feature-meta";

import { FieldBlock } from "./decisions-pane";

export interface RefDraft {
  kind: RefKind;
  url: string;
  refId: string;
  title: string;
}

export const EMPTY_REF: RefDraft = {
  kind: "link",
  url: "",
  refId: "",
  title: "",
};

export function ReferencesPane({
  refs,
  refDraft,
  busy,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  refs: readonly FeatureRef[];
  refDraft: RefDraft;
  busy: boolean;
  onDraftChange: (patch: Partial<RefDraft>) => void;
  onAdd: () => void;
  onRemove: (ref: FeatureRef) => void;
}) {
  return (
    <div className="grid gap-3">
      {refs.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          No references yet.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {refs.map((ref) => (
            <li
              key={ref.id}
              className="flex items-center gap-2 rounded-md border border-border/70 px-2 py-1.5"
            >
              <Pill variant="outline" size="sm">
                {refKindLabel(ref.kind)}
              </Pill>
              {ref.url === null ? (
                <span className="min-w-0 flex-1 truncate text-xs">
                  {ref.title}
                </span>
              ) : (
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-xs text-primary hover:underline"
                  title={ref.url}
                >
                  {ref.title}
                </a>
              )}
              {ref.refId !== null ? (
                <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                  {ref.refId}
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onRemove(ref)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3">
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
          <FieldBlock label="Kind">
            <Select
              value={refDraft.kind}
              onValueChange={(value) =>
                onDraftChange({ kind: value as RefDraft["kind"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ticket">Ticket</SelectItem>
                <SelectItem value="document">Document</SelectItem>
                <SelectItem value="link">Link</SelectItem>
              </SelectContent>
            </Select>
          </FieldBlock>
          <Field label="Link">
            <Input
              value={refDraft.url}
              placeholder="https://…"
              maxLength={2000}
              onChange={(event) => onDraftChange({ url: event.target.value })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ticket or document id">
            <Input
              value={refDraft.refId}
              placeholder="TICKET-123"
              maxLength={200}
              onChange={(event) => onDraftChange({ refId: event.target.value })}
            />
          </Field>
          <Field label="Title">
            <Input
              value={refDraft.title}
              placeholder="Optional; defaults to the id or link."
              maxLength={300}
              onChange={(event) => onDraftChange({ title: event.target.value })}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={
              busy ||
              (refDraft.url.trim().length === 0 &&
                refDraft.refId.trim().length === 0)
            }
            onClick={onAdd}
          >
            Add reference
          </Button>
        </div>
      </div>
    </div>
  );
}
