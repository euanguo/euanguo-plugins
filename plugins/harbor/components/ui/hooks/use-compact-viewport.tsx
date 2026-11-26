import { useMediaQuery } from "./use-media-query.js";

const COMPACT_VIEWPORT_QUERY = "(max-width: 767px)";

export function useIsCompactViewport(): boolean {
  return useMediaQuery(COMPACT_VIEWPORT_QUERY);
}
