import { Button } from "@/components/ui/button";
import { DialogActions } from "@/components/ui/control";
import { Icon } from "@/components/ui/icon";
import { confirmSubmitIcon } from "@/hooks/use-dialog-task";

type ConfirmDialogTone = "default" | "destructive";

/**
 * The right-hand footer for a modal confirmation.
 *
 * `submitIcon` is for the destructive actions that already carry their glyph;
 * other confirmations keep their text-only convention. `disabled` is the
 * caller's readiness rule and never owns the modal's open state.
 */
export function ConfirmDialogFooter({
  cancelLabel,
  submitLabel,
  busy,
  disabled = false,
  tone = "default",
  submitIcon,
  cancelAutoFocus = false,
  onSubmit,
  onCancel,
}: {
  cancelLabel: string;
  submitLabel: string;
  busy: boolean;
  disabled?: boolean;
  tone?: ConfirmDialogTone;
  submitIcon?: "Trash2";
  cancelAutoFocus?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const icon = confirmSubmitIcon(busy, submitIcon);
  return (
    <DialogActions>
      <Button
        autoFocus={cancelAutoFocus}
        disabled={busy}
        size="sm"
        type="button"
        variant="ghost"
        onClick={onCancel}
      >
        {cancelLabel}
      </Button>
      <Button
        disabled={busy || disabled}
        size="sm"
        type="button"
        variant={tone}
        onClick={onSubmit}
      >
        {icon === null ? null : (
          <Icon
            name={icon}
            className={
              busy ? "size-3.5 animate-spin motion-reduce:animate-none" : "size-3.5"
            }
            aria-hidden
          />
        )}
        {submitLabel}
      </Button>
    </DialogActions>
  );
}
