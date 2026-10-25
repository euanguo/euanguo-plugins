/**
 * The question the backend asks when an unarchive fails.
 *
 * It exists because the failure is otherwise invisible: un-settling clears the
 * row and takes bb's archive off the thread, and if the thread's machine is
 * offline the archive stays — so the thread simply leaves the sidebar. The
 * README has carried a paragraph about it since the feature landed, because
 * there was nothing better to say than "unarchive it in bb yourself".
 *
 * The prompt shows what bb said rather than a paraphrase of it, and offers the
 * two answers that are actually different: try again, or leave it. Neither is
 * destructive, so neither is styled as if it were.
 */

import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  UNARCHIVE_RETRY_APPROVAL,
  parseUnarchiveRetryPayload,
} from "@/lib/unarchive-retry";

const OUTLINE_BUTTON_CLASS = cn(
  "inline-flex h-7 items-center rounded-md px-2.5",
  "border border-border text-xs text-muted-foreground",
  "hover:bg-accent hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
);

export function UnarchiveRetryPrompt({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const payload = parseUnarchiveRetryPayload(interaction.payload);

  // A payload this build cannot read is not a reason to guess at a retry: the
  // only safe answer is the one that changes nothing.
  if (payload === null) {
    return (
      <div className="grid gap-3 rounded-lg border border-border bg-background p-3 text-sm">
        <p className="font-semibold text-foreground">{interaction.title}</p>
        <p className="text-muted-foreground">
          This prompt came from a newer version of Nest, which this client cannot
          read. Nothing has changed; the thread is still archived in bb.
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void cancel()}
            className={cn(OUTLINE_BUTTON_CLASS)}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-background p-3 text-sm">
      <p className="font-semibold text-foreground">{interaction.title}</p>
      <p className="text-muted-foreground">
        Un-settling takes bb&rsquo;s archive off a thread, and that runs on the
        thread&rsquo;s own machine. It could not be reached, so the thread is
        still archived and has left the sidebar. Nothing else was changed.
      </p>
      {payload.message.length === 0 ? null : (
        <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 px-2.5 py-1.5 font-sans text-2xs text-muted-foreground">
          {payload.message}
        </pre>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => void cancel()}
          className={cn(OUTLINE_BUTTON_CLASS)}
        >
          Leave it archived
        </button>
        <button
          type="button"
          onClick={() => void submit(UNARCHIVE_RETRY_APPROVAL)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5",
            "text-xs font-medium text-primary-foreground hover:bg-primary/90",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
        >
          <Icon name="ArchiveRestore" className="size-3.5" aria-hidden />
          Try again
        </button>
      </div>
    </div>
  );
}