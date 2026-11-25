import { useSyncExternalStore } from "react";

const MINUTE_MS = 60_000;

type Listener = () => void;

let currentMinute = Math.floor(Date.now() / MINUTE_MS);
let intervalTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<Listener>();

function advanceMinute(): void {
  const next = Math.floor(Date.now() / MINUTE_MS);
  if (next === currentMinute) return;
  currentMinute = next;
  for (const listener of listeners) listener();
}

export function subscribeMinuteClock(listener: Listener): () => void {
  if (listeners.size === 0) {
    // Refresh immediately upon first subscriber so idle gaps between mounts do
    // not display a stale minute until the next interval fires.
    currentMinute = Math.floor(Date.now() / MINUTE_MS);
    intervalTimer = setInterval(advanceMinute, MINUTE_MS);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalTimer !== null) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  };
}

export function getMinuteClockMs(): number {
  return currentMinute * MINUTE_MS;
}

/** Shared minute-resolution clock synchronized across all mounted consumers. */
export function useMinuteClock(): number {
  return useSyncExternalStore(
    subscribeMinuteClock,
    getMinuteClockMs,
    getMinuteClockMs,
  );
}
