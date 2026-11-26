import { useCallback, useSyncExternalStore } from "react";

type MediaQueryRef = {
  mql: MediaQueryList;
  subscribe: (notify: () => void) => () => void;
};

const mediaQueryCache = new Map<string, MediaQueryRef>();

function createMediaQueryRef(query: string): MediaQueryRef | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;

  let ref = mediaQueryCache.get(query);
  if (ref) return ref;

  const mql = window.matchMedia(query);
  const listeners = new Set<() => void>();
  const onChange = () => {
    for (const listener of listeners) listener();
  };

  ref = {
    mql,
    subscribe(notify) {
      const wasEmpty = listeners.size === 0;
      listeners.add(notify);
      if (wasEmpty) {
        mql.addEventListener("change", onChange);
      }
      return () => {
        listeners.delete(notify);
        if (listeners.size === 0) {
          mql.removeEventListener("change", onChange);
          mediaQueryCache.delete(query);
        }
      };
    },
  };
  mediaQueryCache.set(query, ref);
  return ref;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => createMediaQueryRef(query)?.subscribe(notify) ?? (() => {}),
    [query],
  );
  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return mediaQueryCache.get(query)?.mql.matches ?? window.matchMedia(query).matches;
  }, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
