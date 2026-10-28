import type { ReactNode } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import { DiscCluster } from "@/components/inbox/disc";
import { STATE_CHIP_CLASS } from "@/components/inbox/family-status";
import { Icon } from "@/components/ui/icon";
import type { FamilyStatusPresentation } from "@/lib/family-status";
import { familyStatusColor } from "@/components/inbox/family-status";
import { cn } from "@/lib/utils";

export function RootTrailingCluster({
  interactive,
  children,
}: {
  interactive: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "relative z-10 ml-auto flex shrink-0 items-center gap-1.5",
        "pointer-events-none",
        interactive &&
          "[&_a]:pointer-events-auto [&_button]:pointer-events-auto",
      )}
    >
      {children}
    </span>
  );
}

export function ChildThreadChip({
  threads,
  status,
  expanded,
  controls,
  label,
  providerGlyphs,
  disabled,
  onToggle,
}: {
  threads: readonly PluginSidebarThread[];
  status: FamilyStatusPresentation;
  expanded: boolean;
  controls: string;
  label: string;
  providerGlyphs: ReactNode;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-nest-child-status={status.kind}
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        STATE_CHIP_CLASS,
        "group/children relative cursor-pointer outline-none",
        "pointer-events-auto transition-colors duration-150 ease-out hover:bg-current/20 focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none",
        disabled && "pointer-events-none opacity-40",
      )}
      style={{ color: familyStatusColor(status) }}
    >
      <DiscCluster threads={threads} compact />
      <span className="tabular-nums">{threads.length}</span>
      {providerGlyphs}
      <Icon
        name="ChevronDown"
        className={cn(
          "size-3 transition-transform duration-150 ease-out motion-reduce:transition-none",
          expanded && "rotate-180",
        )}
        aria-hidden
      />
    </button>
  );
}
