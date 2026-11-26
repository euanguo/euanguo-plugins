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

import type { SidebarMode } from "../domain/organization.ts";
import type { WorkspaceIndex } from "../domain/workspace-index.ts";

export type ActiveNewChatTarget =
  | { readonly kind: "environment"; readonly environmentId: string }
  | { readonly kind: "feature"; readonly featureId: string };

let workspaceIndex: WorkspaceIndex | null = null;
let sidebarMode: SidebarMode | null = null;
let activeNewChat: ActiveNewChatTarget | null = null;
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

function sameActiveNewChat(
  a: ActiveNewChatTarget | null,
  b: ActiveNewChatTarget | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.kind !== b.kind) return false;
  return a.kind === "feature" && b.kind === "feature"
    ? a.featureId === b.featureId
    : a.kind === "environment" && b.kind === "environment"
      ? a.environmentId === b.environmentId
      : false;
}

function getWorkspaceIndex(): WorkspaceIndex | null {
  return workspaceIndex;
}

function getSidebarMode(): SidebarMode | null {
  return sidebarMode;
}

export function getActiveNewChat(): ActiveNewChatTarget | null {
  return activeNewChat;
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

export function publishActiveNewChat(target: ActiveNewChatTarget | null): void {
  if (sameActiveNewChat(activeNewChat, target)) return;
  activeNewChat = target;
  notify();
}

export function clearActiveNewChat(target: ActiveNewChatTarget): void {
  if (!sameActiveNewChat(activeNewChat, target)) return;
  activeNewChat = null;
  notify();
}

export function useSharedWorkspaceIndex(): WorkspaceIndex | null {
  return useSyncExternalStore(subscribe, getWorkspaceIndex, getWorkspaceIndex);
}

export function useSharedSidebarMode(): SidebarMode | null {
  return useSyncExternalStore(subscribe, getSidebarMode, getSidebarMode);
}

export function useActiveNewChat(): ActiveNewChatTarget | null {
  return useSyncExternalStore(subscribe, getActiveNewChat, getActiveNewChat);
}
