/**
 * The frontend half of the group picker's artwork: ask once, draw many.
 *
 * The artwork is not in the bundle (see `host/group-icon-artwork.ts` for why),
 * so every icon that reaches the screen has to be fetched. Doing that per icon
 * would be one round trip per tile — a picker page is 240 of them. So requests
 * are gathered for a tick and answered as one call, and the answers are kept:
 * reopening the picker, or re-rendering a row, costs nothing.
 *
 * A name that is asked about is remembered as answered even when the answer was
 * "no such icon", so a row whose name this build no longer carries does not ask
 * again on every render. A call that *fails* is not remembered: nothing was
 * learned, and a mount that comes later should be able to try again.
 */
import {
  MAX_GROUP_ICON_BATCH,
  type GroupIconArtwork,
} from "./group-icons.ts";

/**
 * How this module reaches the plugin's backend. The caller owns the RPC client
 * — it comes from a hook — so the loader takes it per request rather than
 * holding a reference to one.
 */
export type GroupIconTransport = (
  names: readonly string[],
) => Promise<Readonly<Record<string, GroupIconArtwork | null>>>;

const artwork = new Map<string, GroupIconArtwork>();
const answered = new Set<string>();
const waiting = new Map<string, Array<(value: GroupIconArtwork | null) => void>>();

/**
 * The transport of the most recent request. One plugin has one RPC client, so
 * the batch that is about to be sent can use whichever caller arrived last
 * without caring that React handed out a new client object since.
 */
let latestTransport: GroupIconTransport | null = null;
let scheduled = false;

/**
 * A macrotask, not a microtask. The picker mounts a whole page of tiles in one
 * commit, so either would gather them; the timeout also catches the tiles that
 * a follow-up render adds while the browser is still in the same task, which is
 * what a "Show more" page looks like.
 */
const BATCH_DELAY_MS = 0;

export function loadGroupIcon(
  transport: GroupIconTransport,
  name: string,
): Promise<GroupIconArtwork | null> {
  const known = artwork.get(name);
  if (known !== undefined) return Promise.resolve(known);
  if (answered.has(name)) return Promise.resolve(null);

  latestTransport = transport;
  const pending = new Promise<GroupIconArtwork | null>((resolve) => {
    const waiters = waiting.get(name);
    if (waiters === undefined) waiting.set(name, [resolve]);
    else waiters.push(resolve);
  });

  if (!scheduled) {
    scheduled = true;
    setTimeout(() => void flush(), BATCH_DELAY_MS);
  }
  return pending;
}

function settle(waiters: Array<(value: GroupIconArtwork | null) => void>, value: GroupIconArtwork | null): void {
  for (const resolve of waiters) resolve(value);
}

async function flush(): Promise<void> {
  scheduled = false;
  const transport = latestTransport;
  const batch = [...waiting.entries()];
  waiting.clear();

  if (transport === null) {
    for (const [, waiters] of batch) settle(waiters, null);
    return;
  }

  for (let start = 0; start < batch.length; start += MAX_GROUP_ICON_BATCH) {
    const slice = batch.slice(start, start + MAX_GROUP_ICON_BATCH);
    let result: Readonly<Record<string, GroupIconArtwork | null>>;
    try {
      result = await transport(slice.map(([name]) => name));
    } catch {
      for (const [, waiters] of slice) settle(waiters, null);
      continue;
    }
    for (const [name, waiters] of slice) {
      const value = result[name] ?? null;
      answered.add(name);
      if (value !== null) artwork.set(name, value);
      settle(waiters, value);
    }
  }
}
