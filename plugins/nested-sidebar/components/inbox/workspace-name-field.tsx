import { useState, type RefObject } from "react";

import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

export function WorkspaceNameField({
  inputRef,
  initial,
  fallback,
  ariaLabel,
  onCommit,
  onCancel,
}: {
  inputRef?: RefObject<HTMLInputElement | null>;
  initial: string;
  fallback: string;
  ariaLabel: string;
  onCommit: (draft: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [done, setDone] = useState(false);
  const finish = (commit: boolean) => {
    if (done) return;
    setDone(true);
    if (commit) onCommit(value);
    else onCancel();
  };
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <Icon
        name="Edit"
        className="size-3 shrink-0 text-muted-foreground/60"
        aria-hidden
      />
      <Input
        ref={inputRef}
        className="h-6 flex-1 px-1.5"
        autoFocus
        value={value}
        maxLength={120}
        aria-label={ariaLabel}
        placeholder={fallback}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
      />
    </span>
  );
}
