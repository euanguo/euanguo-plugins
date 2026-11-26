import { useEffect, useRef, useState } from "react";

/**
 * Shared RPC state hook that refreshes when its signature changes, on focus/visibility
 * wake, or when explicitly triggered through `listeners`.
 */
export function useFocusSyncedRpc<T>({
  rpcKey,
  signature,
  initialValue,
  fetchValue,
  onSuccess,
  listeners,
}: {
  readonly rpcKey: unknown;
  readonly signature: string;
  readonly initialValue: () => T;
  readonly fetchValue: () => Promise<T>;
  readonly onSuccess: (value: T) => void;
  readonly listeners: Set<() => void>;
}): T {
  const [value, setValue] = useState<T>(initialValue);
  const [wakeToken, setWakeToken] = useState(0);
  const fetchRef = useRef(fetchValue);
  fetchRef.current = fetchValue;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    let cancelled = false;
    fetchRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setValue(result);
        onSuccessRef.current(result);
      })
      .catch(() => {
        // Fallback snapshot keeps rendering cleanly; nothing to surface.
      });
    return () => {
      cancelled = true;
    };
  }, [rpcKey, signature, wakeToken]);

  useEffect(() => {
    const bump = () => setWakeToken((token) => token + 1);
    const wake = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      bump();
    };
    listeners.add(bump);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", wake);
    if (typeof window !== "undefined") window.addEventListener("focus", wake);
    return () => {
      listeners.delete(bump);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", wake);
      if (typeof window !== "undefined") window.removeEventListener("focus", wake);
    };
  }, [listeners]);

  return value;
}
