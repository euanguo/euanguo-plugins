/**
 * The content script that marks snoozed threads in bb's own sidebar.
 *
 * `contentScripts` is the additive half of the plugin surface: it runs whether or
 * not Nest is the chosen thread list, gets no DOM container, and is disposed when
 * the frontend generation is replaced. The decoration itself is the host's —
 * `experimental_setThreadRowStatus` renders the glyph and owns its tone — so this
 * script only decides *what* to say and keeps saying it.
 *
 * Why it reads web storage: a content script has no `useSidebarThreads` and no
 * RPC client, because both are hooks and a content script is not a component. The
 * one source it can reach is the same-origin cache Nest already writes for its
 * cold start. What that costs is stated in `lib/row-status.ts` rather than hidden
 * here: the marker reflects the last state Nest wrote, not a live read.
 */

import type {
  PluginContentScriptContext,
  PluginContentScriptDisposer,
} from "@get-bb/plugin-sdk/app";
import { MAX_TIMEOUT_MS } from "./lifecycle.ts";
import { nextMarkerDelayMs, snoozedRowStatuses } from "./row-status.ts";
import { WARM_START_ROWS_KEY, readWarmStartRows } from "./warm-start.ts";

export function mountNestRowStatus(
  context: PluginContentScriptContext,
): PluginContentScriptDisposer {
  const setStatus = context.experimental_setThreadRowStatus;
  // Feature-detected: the surface is experimental and an older client may not
  // have it. Doing nothing is the right answer — throwing would take the plugin
  // down over a decoration.
  if (setStatus === undefined) return () => undefined;

  let applied: readonly string[] = [];
  let timer: number | null = null;

  const apply = () => {
    const rows = readWarmStartRows() ?? [];
    const now = Date.now();
    const statuses = snoozedRowStatuses({ rows, now });
    const ids = new Set(statuses.map((entry) => entry.threadId));
    // Clear a marker this script set and is no longer setting, so a thread that
    // woke up loses its glyph rather than keeping one that stopped being true.
    for (const threadId of applied) {
      if (!ids.has(threadId)) setStatus(threadId, null);
    }
    for (const entry of statuses) setStatus(entry.threadId, entry.status);
    applied = [...ids];

    // One timer armed for the soonest wake rather than an interval: a wake time
    // passing is the only thing that changes this without an event, and a poll
    // that mostly finds nothing is a poll that should not have been armed. The
    // delay is clamped because `setTimeout` takes a signed 32-bit value and a
    // far-future snooze would otherwise fire at once, in a tight loop.
    if (timer !== null) window.clearTimeout(timer);
    const delay = nextMarkerDelayMs(rows, now);
    timer =
      delay === null
        ? null
        : window.setTimeout(apply, Math.min(delay + 50, MAX_TIMEOUT_MS));
  };

  const onFocus = () => apply();
  const onStorage = (event: StorageEvent) => {
    // Cross-tab only: a same-tab write does not fire this. The focus re-read is
    // what covers the same-tab case, which is why there are two.
    if (event.key === WARM_START_ROWS_KEY) apply();
  };
  window.addEventListener("focus", onFocus);
  window.addEventListener("storage", onStorage);
  apply();

  const dispose = () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("storage", onStorage);
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    // Hand every marker back before letting go of the ids: the host clears the
    // rest when the generation ends, but a script that is replaced should not
    // leave its successor to clean up after it.
    for (const threadId of applied) setStatus(threadId, null);
    applied = [];
  };
  context.signal.addEventListener("abort", dispose);
  return dispose;
}