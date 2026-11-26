import { useId } from "react";
import { Label } from "@bb-ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb-ui/select";
import { Switch } from "@bb-ui/switch";
import type { AppearanceKey } from "@/lib/domain/appearance";

export type SettingsSetter = (
  patch: Partial<Record<AppearanceKey, unknown>>,
) => void;

/**
 * A select row, in the host settings page's own layout.
 *
 * The row is what bb's own settings sections are: a label and its supporting
 * line on the left, the control on the right, `justify-between` with a 20px
 * gap. The measurements are not a guess — they are what the host's
 * `Configuration` block computes (`flex flex-row justify-between gap-5
 * items-start`, label `text-sm font-normal text-foreground`).
 *
 * The control is the registry's `Select`, not a `<select>`: it opens in bb's
 * own popover, keeps the host's keyboard behaviour, and renders as a sheet on a
 * compact viewport, none of which a native select does.
 */
export function SettingsChoice({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-row items-start justify-between gap-5 py-2">
      <SettingsRowLabel label={label} hint={hint} />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          aria-label={label}
          className="h-7 w-44 shrink-0 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent data-radix-select-content="">
          {options.map((option) => (
            <SelectItem key={option} value={option} className="text-xs">
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * A boolean row: the same layout, with the registry's `Switch`.
 *
 * `role="switch"` and `aria-checked` come from that component, so the state is
 * announced as a state rather than as a checked box.
 */
export function SettingsToggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-row items-start justify-between gap-5 py-2">
      <SettingsRowLabel label={label} hint={hint} htmlFor={id} />
      <Switch
        id={id}
        checked={value}
        aria-label={label}
        onCheckedChange={onChange}
        className="mt-0.5"
      />
    </div>
  );
}

/**
 * The left half of a settings row.
 *
 * Two sizes, both the host's: the label is `text-sm font-normal foreground`,
 * which is what bb's own field labels compute to; the supporting line under it
 * is one step down and muted.
 */
export function SettingsRowLabel({
  label,
  hint,
  htmlFor,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
}) {
  return (
    <div className="min-w-0">
      <Label
        htmlFor={htmlFor}
        className="block text-sm font-normal leading-normal text-foreground"
      >
        {label}
      </Label>
      {hint === undefined ? null : (
        // 2px: the host's own rows put the supporting line 3px under a 19px
        // label. Matching that keeps a plugin row the same height as a host row.
        <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
