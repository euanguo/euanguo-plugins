/**
 * The threads the tree draws, resolved across the host view and a recovery read.
 *
 * `experimental_useSidebarThreads` is the source of truth and has no refetch, so
 * this hook does two things the raw state cannot:
 *
 * 1. It keeps the last answer the host gave while it was `ready`, so a refresh
 *    that fails leaves the tree standing instead of blanking it.
 * 2. It can read the live view from bb's SDK through the plugin's own backend,
 *    which is the only way back when the host view has failed and there is no
 *    last answer to fall back on.
 *
 * The resolution itself is in `lib/thread-snapshot.ts`; this file is the state
 * machine around it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server/contract";
import { toRecoveryThreads } from "@/lib/recovery-threads";
import {
  resolveThreadView,
  type ThreadView,
  type ThreadViewSnapshot,
} from "@/lib/thread-snapshot";

export interface ThreadViewApi {
  /** What to draw, and where it came from. */
  readonly view: ThreadView;
  /**
   * The host's own state. The render needs it to tell a first load, which draws
   * nothing, apart from a cold failure, which draws the retry.
   */
  readonly status: "error" | "loading" | "ready";
  /** True while a recovery read is in flight. */
  readonly recovering: boolean;
  /** The last recovery failure, so a retry that failed can say so. */
  readonly recoveryError: string | null;
  /** Read the live view from bb's SDK. Only useful while the host is failing. */
  recover(): void;
}

export function useThreadView(): ThreadViewApi {
  const { status, threads, projects } = useSidebarThreads();
  const rpc = useRpc<typeof nestRpcContract>();
  const [recovered, setRecovered] = useState<ThreadViewSnapshot | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * The last answer the host gave while it was ready.
   *
   * Written during render on purpose, rather than in an effect. An effect would
   * have to decide whether the new answer differs from the retained one before
   * storing it, and neither obvious test works: the host hands out a fresh array
   * on every render, so comparing identity would set state on every render and
   * loop, while comparing a hand-listed signature would silently freeze the
   * retained copy the first time a field it did not name changed. Writing the
   * ref during render keeps it current with no comparison and no extra render,
   * and the write is idempotent, so a double-invoked render stores one value.
   */
  const lastGoodHostRef = useRef<ThreadViewSnapshot | null>(null);
  if (status === "ready") {
    lastGoodHostRef.current = { threads, projects };
  }

  // A recovery exists to fill the gap a cold failure leaves. Once the host is
  // answering again it is a second, older copy of the same list, and keeping it
  // would let a much later outage resurrect rows that have since moved on.
  // Keyed on `status` alone: the arrays change identity every render.
  useEffect(() => {
    if (status !== "ready") return;
    setRecovered(null);
    setRecoveryError(null);
  }, [status]);

  const recover = useCallback(() => {
    setRecovering(true);
    setRecoveryError(null);
    void rpc
      .call("listThreadsForRecovery", {})
      .then((result) => {
        if (!mounted.current) return;
        setRecovered({
          threads: toRecoveryThreads(result.threads),
          projects: result.projects.map((project) => ({
            ...project,
            href: `/projects/${project.id}`,
            settingsHref: `/projects/${project.id}/settings`,
          })),
        });
      })
      .catch((error: unknown) => {
        if (mounted.current) setRecoveryError(messageOf(error));
      })
      .finally(() => {
        if (mounted.current) setRecovering(false);
      });
  }, [rpc]);

  return {
    view: resolveThreadView({
      status,
      host: { threads, projects },
      lastGoodHost: lastGoodHostRef.current,
      recovered,
    }),
    status,
    recovering,
    recoveryError,
    recover,
  };
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Could not read threads.";
}
