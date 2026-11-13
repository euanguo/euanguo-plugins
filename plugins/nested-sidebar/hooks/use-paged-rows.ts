import { useCallback, useMemo, useState } from "react";

import { hasMoreRows, nextPageSize } from "../lib/paging.ts";

/**
 * The paging arithmetic for one list, without the state.
 *
 * Pure so the hook's controlled and uncontrolled uses cannot drift, and so it
 * can be tested without a DOM. While a search is running the limit is Infinity:
 * every match is drawn, and the controls are hidden by the call sites.
 */
export function pagedRows({
  total,
  pageSize,
  searching,
  pages,
}: {
  total: number;
  pageSize: number;
  searching: boolean;
  pages: number;
}): {
  /** How many rows the list draws, before the open-row escape hatch. */
  visibleCount: number;
  hasMore: boolean;
  /** How many rows the next click adds, for the button's own label. */
  remaining: number;
  page: number;
} {
  const visibleCount = searching ? Infinity : pages * pageSize;
  return {
    visibleCount,
    hasMore: hasMoreRows(total, visibleCount),
    remaining: nextPageSize(total, visibleCount, pageSize),
    page: pages,
  };
}

/**
 * One paged list: a page count, how much it draws, and the shared controls.
 *
 * The state owns a page count rather than a row count, so a page-size change
 * re-scales what is already on screen. The arithmetic stays in `lib/paging.ts`.
 *
 * A caller that already holds the page count — the settled shelf keeps its
 * state above the shelf that draws it — passes `page` (with the callbacks that
 * advance it) and the hook derives the same surface without owning the state.
 */
export function usePagedRows({
  total,
  pageSize,
  searching,
  page,
  onLoadMore,
  onShowLess,
}: {
  total: number;
  pageSize: number;
  searching: boolean;
  /** When given, the caller owns the page count and this hook only derives. */
  page?: number;
  onLoadMore?: () => void;
  onShowLess?: () => void;
}): {
  visibleCount: number;
  hasMore: boolean;
  page: number;
  nextPage: () => void;
  showLess: () => void;
  /** Exactly what `PageControls` takes, minus its `className`. */
  controlsProps: {
    hasMore: boolean;
    remaining: number;
    page: number;
    onLoadMore: () => void;
    onShowLess: () => void;
  };
} {
  const controlled = page !== undefined;
  const [ownedPages, setOwnedPages] = useState(1);
  const pages = controlled ? page : ownedPages;
  const nextPage = useCallback(() => {
    if (controlled) onLoadMore?.();
    else setOwnedPages((count) => count + 1);
  }, [controlled, onLoadMore]);
  const showLess = useCallback(() => {
    if (controlled) onShowLess?.();
    else setOwnedPages(1);
  }, [controlled, onShowLess]);
  const derived = pagedRows({ total, pageSize, searching, pages });
  const controlsProps = useMemo(
    () => ({
      hasMore: derived.hasMore,
      remaining: derived.remaining,
      page: derived.page,
      onLoadMore: nextPage,
      onShowLess: showLess,
    }),
    [derived.hasMore, derived.remaining, derived.page, nextPage, showLess],
  );
  return {
    visibleCount: derived.visibleCount,
    hasMore: derived.hasMore,
    page: derived.page,
    nextPage,
    showLess,
    controlsProps,
  };
}
