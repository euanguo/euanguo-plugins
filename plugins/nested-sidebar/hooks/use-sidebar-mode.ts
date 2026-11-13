import { readStoredSidebarMode } from "@/hooks/use-view-preferences";
import { DEFAULT_SIDEBAR_MODE, type SidebarMode } from "@/lib/organization";
import { useSharedSidebarMode } from "@/lib/workspace-index-store";

/**
 * The mode in force, for a surface outside the sidebar.
 *
 * The mounted sidebar is authoritative: it publishes what it is drawing, and
 * that is what the header follows. Without it — bb's own thread list chosen —
 * the persisted preference is still the user's standing choice, so the header
 * reads it from the snapshot the sidebar already wrote. Nothing else is a
 * reason to draw a header, so the default is the mode that leaves it to bb.
 */
export function useSidebarMode(): SidebarMode {
  const shared = useSharedSidebarMode();
  return shared ?? readStoredSidebarMode() ?? DEFAULT_SIDEBAR_MODE;
}
