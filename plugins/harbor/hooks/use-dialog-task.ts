import { useCallback, useRef, useState } from "react";

import { errorMessage } from "../lib/domain/rpc-error.ts";

/**
 * One async dialog action at a time, with the error it leaves behind.
 *
 * The fallback belongs to the caller because only it knows what the action
 * means to the user. A superseded run never writes its result back: a second
 * submit owns the busy and error state from the moment it starts.
 */
export function useDialogTask<T>() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const run = useCallback(async (task: () => Promise<T>, fallback: string) => {
    const current = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      return await task();
    } catch (failure: unknown) {
      if (current === generation.current) setError(errorMessage(failure, fallback));
      return undefined;
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }, []);

  const reset = useCallback(() => {
    setBusy(false);
    setError(null);
  }, []);

  return { busy, error, run, reset, setError };
}

/**
 * A text-only confirmation stays quiet while busy; a destructive action with
 * its own glyph swaps it for the shared spinner.
 */
export function confirmSubmitIcon(
  busy: boolean,
  submitIcon: string | undefined,
): string | null {
  if (submitIcon === undefined) return null;
  return busy ? "Loading" : submitIcon;
}
