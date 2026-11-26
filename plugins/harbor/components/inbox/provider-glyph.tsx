import { experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";

import { TRAILING_GLYPH_BOX_CLASS } from "@/components/inbox/status-slot";
import { HarborTooltip } from "@/components/ui/tooltip";
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
  const glyph = (
    <span
      className={cn(
        TRAILING_GLYPH_BOX_CLASS,
        "relative rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      title={interactive ? undefined : displayName}
      tabIndex={interactive ? 0 : undefined}
    >
      <ProviderIcon
        providerKind="agent"
        provider={{ id: providerId, logoUrl: provider?.logoUrl ?? null }}
        className="size-3 text-muted-foreground/70"
        aria-label={displayName}
      />
    </span>
  );

  if (!interactive) return glyph;

  return (
    <HarborTooltip content={`Provider: ${displayName}`}>
      {glyph}
    </HarborTooltip>
  );
}
