/**
 * Where each workspace was last looked at.
 *
 * A workspace row's click target is the conversation the user last had open in
 * it, and that fact is not in bb's records: it is a choice, so it lives with
 * the other view state. localStorage rather than the plugin store because the
 * write happens while the user is switching conversations, and a round trip
 * would lose the one they just left.
 *
 * The stored value is user-writable, so every read re-checks it: anything that
 * is not a record of strings is an empty record, never an exception. The cap is
 * a bound on what this page parses, not on how many workspaces exist.
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "bb.nest.last-active.v1";
const MAX_ENTRIES = 500;

type LastActive = Readonly<Record<string, string>>;
type LastActiveStorage = Pick<Storage, "getItem" | "setItem">;

const listeners = new Set<() => void>();

/** What this page last wrote, for when storage cannot be read back. */
let memory: LastActive | null = null;

/** The value subscribers hold. One identity until the record changes. */
let snapshot: LastActive | null = null;

function storage(): LastActiveStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function decode(raw: string): LastActive {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") next[key] = value;
  }
  return next;
}

function read(): LastActive {
  const store = storage();
  if (store === null) return memory ?? {};
  try {
    const raw = store.getItem(STORAGE_KEY);
    return raw === null ? {} : decode(raw);
  } catch {
    return memory ?? {};
  }
}

function currentSnapshot(): LastActive {
  snapshot ??= read();
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function recordLastActive(workspaceKey: string, threadId: string): void {
  const current = read();
  const keys = Object.keys(current);
  if (current[workspaceKey] === threadId && keys.at(-1) === workspaceKey) {
    return;
  }
  // Re-adding a key is what moves it to the end, and the end is what the cap
  // keeps. Object key order is insertion order for these string keys.
  const next = Object.fromEntries(
    Object.entries(current).filter(([key]) => key !== workspaceKey),
  );
  next[workspaceKey] = threadId;
  const value: LastActive = Object.fromEntries(
    Object.entries(next).slice(-MAX_ENTRIES),
  );
  memory = value;
  snapshot = value;
  const store = storage();
  if (store !== null) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // The in-memory copy still answers for this page.
    }
  }
  notify();
}

export function lastActiveFor(workspaceKey: string): string | null {
  return read()[workspaceKey] ?? null;
}

export function useLastActive(): Readonly<Record<string, string>> {
  return useSyncExternalStore(subscribe, currentSnapshot, currentSnapshot);
}
