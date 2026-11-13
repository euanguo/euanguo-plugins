/**
 * The sidebar's derivation, published for the surfaces outside it.
 *
 * A header component mounts once per thread pane, so reading the three RPCs an
 * index takes in each pane means three reads per pane, all answering the same
 * thing. The sidebar already builds the index and the mode, so it publishes
 * them here and every pane subscribes to the one answer.
 *
 * Null means no sidebar is mounted, which is a supported state: bb's own thread
 * list can be the chosen one, and the reader then derives what it needs from
 * the threads it holds. Publishing the same value twice is not a change, which
 * keeps an unrelated re-render from waking every subscriber.
 */

import { useSyncExternalStore } from "react";

import type { SidebarMode } from "./organization.ts";
import type { WorkspaceIndex } from "./workspace-index.ts";

let workspaceIndex: WorkspaceIndex | null = null;
let sidebarMode: SidebarMode | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

function getWorkspaceIndex(): WorkspaceIndex | null {
  return workspaceIndex;
}

function getSidebarMode(): SidebarMode | null {
  return sidebarMode;
}

export function publishWorkspaceIndex(index: WorkspaceIndex | null): void {
  if (workspaceIndex === index) return;
  workspaceIndex = index;
  notify();
}

export function publishSidebarMode(mode: SidebarMode | null): void {
  if (sidebarMode === mode) return;
  sidebarMode = mode;
  notify();
}

export function useSharedWorkspaceIndex(): WorkspaceIndex | null {
  return useSyncExternalStore(subscribe, getWorkspaceIndex, getWorkspaceIndex);
}

export function useSharedSidebarMode(): SidebarMode | null {
  return useSyncExternalStore(subscribe, getSidebarMode, getSidebarMode);
}
