import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/**
 * The two compositions the registry does not ship.
 *
 * Everything else on a form is the registry's own component — `Button`,
 * `Input`, `Label`, `Switch`, `Checkbox`, `Select` — vendored from the same
 * source bb's settings page is built from, so a plugin control and a host
 * control are the same component, not two that were made to look alike.
 *
 * What is left here is layout: a labelled field, and the row a dialog's actions
 * sit in. Neither is a control, so neither has a registry item to vendor.
 */

/**
 * A field: its label, its control, and the one line said when the control is
 * refused.
 *
 * The error sits under the control rather than beside the label, because it is
 * about the value the user just typed, not about the field's name.
 */
export function Field({
  label,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      {children}
      {error ? (
        <span className="text-2xs text-destructive">{error}</span>
      ) : null}
    </label>
  );
}

/**
 * The footer a dialog's actions sit in.
 *
 * Right-aligned with one gap, so the quiet action reads first and the primary
 * one lands under the thumb. The order inside is the caller's: a destructive
 * dialog puts its cancel before its confirm just as a form does.
 */
export function DialogActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-end gap-2", className)}>
      {children}
    </div>
  );
}
