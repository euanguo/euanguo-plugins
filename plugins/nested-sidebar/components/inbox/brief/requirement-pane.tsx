import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/control";
import { Textarea } from "@/components/ui/textarea";
import type { BriefDraft } from "@/lib/domain/feature-meta";

/** The six requirement fields, in the order the dialog renders them. */
export const BRIEF_FIELDS: readonly {
  readonly key: keyof BriefDraft;
  readonly label: string;
  readonly rows: number;
  readonly placeholder: string;
}[] = [
  {
    key: "goal",
    label: "Goal",
    rows: 3,
    placeholder: "What this work is for, in the user's words.",
  },
  {
    key: "nonGoals",
    label: "Not this work",
    rows: 2,
    placeholder:
      "What is deliberately out of scope, when saying so prevents a wrong turn.",
  },
  {
    key: "acceptance",
    label: "Acceptance",
    rows: 3,
    placeholder: "What has to be true before this is done.",
  },
  {
    key: "openQuestions",
    label: "Open questions (one per line)",
    rows: 3,
    placeholder: "What still needs an answer.",
  },
  {
    key: "blockers",
    label: "Blockers (one per line)",
    rows: 2,
    placeholder: "What is stopping progress right now.",
  },
  {
    key: "notes",
    label: "Notes",
    rows: 3,
    placeholder: "Anything else worth carrying into every conversation.",
  },
];

function BriefField({
  field,
  value,
  onChange,
}: {
  field: (typeof BRIEF_FIELDS)[number];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={field.label}>
      <Textarea
        rows={field.rows}
        value={value}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function RequirementPane({
  brief,
  briefDirty,
  busy,
  onChange,
  onSave,
}: {
  brief: BriefDraft;
  briefDirty: boolean;
  busy: boolean;
  onChange: (patch: Partial<BriefDraft>) => void;
  onSave: () => void;
}) {
  return (
    <div className="grid gap-3">
      {BRIEF_FIELDS.map((field) => (
        <BriefField
          key={field.key}
          field={field}
          value={brief[field.key]}
          onChange={(value) => onChange({ [field.key]: value })}
        />
      ))}
      <div className="flex items-center justify-end gap-2">
        {briefDirty ? (
          <span className="text-2xs text-muted-foreground">
            Unsaved changes
          </span>
        ) : null}
        <Button
          size="sm"
          disabled={busy || !briefDirty}
          onClick={onSave}
        >
          Save requirement
        </Button>
      </div>
    </div>
  );
}
