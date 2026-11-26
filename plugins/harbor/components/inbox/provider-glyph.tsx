import { experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";

import { TRAILING_GLYPH_BOX_CLASS } from "@/components/inbox/status-slot";
import { RowTooltip } from "@/components/ui/row-tooltip";
import { cn } from "@/lib/ui/utils";

export interface ProviderGlyphInfo {
  displayName: string;
  logoUrl: string | null;
}

/**
 * Renders the thread's agent provider glyph via bb's shared `experimental_ProviderIcon`.
 */
export function ProviderGlyph({
  providerId,
  provider,
  className,
  interactive = true,
}: {
  providerId: string;
  provider?: ProviderGlyphInfo;
  className?: string;
  interactive?: boolean;
}) {
  const displayName = provider?.displayName ?? providerId;
  return (
    <span
      className={cn(
        TRAILING_GLYPH_BOX_CLASS,
        "group/provider relative rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      title={displayName}
      tabIndex={interactive ? 0 : undefined}
    >
      <ProviderIcon
        providerKind="agent"
        provider={{ id: providerId, logoUrl: provider?.logoUrl ?? null }}
        className="size-3 text-muted-foreground/70"
        aria-label={displayName}
      />
      <RowTooltip
        content={`Provider: ${displayName}`}
        className="z-40 max-w-[min(12rem,calc(100cqw-1rem))] px-2 py-1 group-hover/provider:translate-y-0 group-hover/provider:opacity-100 group-focus/provider:translate-y-0 group-focus/provider:opacity-100"
      />
    </span>
  );
}
