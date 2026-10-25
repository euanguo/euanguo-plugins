import { useMemo } from "react";
import {
  useBbNavigate,
  useSdk,
} from "@get-bb/plugin-sdk/app";

/**
 * The small action surface Nest needs, expressed over the current browser SDK.
 *
 * The legacy sidebar-actions hook is gone in current bb.
 * Keeping one adapter here means rows and menus do not each learn the new
 * public thread API, and the plugin can follow a later SDK rename in one place.
 */
export interface ThreadActions {
  open(threadId: string, options?: { split?: boolean }): void;
  openNewThread(options?: { projectId?: string; focusPrompt?: boolean }): void;
  setPinned(threadId: string, pinned: boolean): Promise<void>;
  setRead(threadId: string, read: boolean): Promise<void>;
  rename(threadId: string, title: string): Promise<void>;
  archive(threadId: string): void;
}

export function useThreadActions(): ThreadActions {
  const sdk = useSdk();
  const navigate = useBbNavigate();

  return useMemo(
    () => ({
      open(threadId, options) {
        // Current bb accepts split placement; the SDK 0.5.x declaration does
        // not expose the second argument yet. The extra argument is ignored by
        // runtimes that predate it.
        const openThread = navigate.toThread as (
          id: string,
          openOptions?: { split?: boolean },
        ) => void;
        openThread(threadId, options);
      },
      openNewThread(options) {
        navigate.toCompose(options);
      },
      async setPinned(threadId, pinned) {
        await (pinned
          ? sdk.threads.pin({ threadId })
          : sdk.threads.unpin({ threadId }));
      },
      async setRead(threadId, read) {
        await (read
          ? sdk.threads.markRead({ threadId })
          : sdk.threads.markUnread({ threadId }));
      },
      async rename(threadId, title) {
        await sdk.threads.update({ threadId, title });
      },
      archive(threadId) {
        void sdk.threads.archive({ threadId });
      },
    }),
    [navigate, sdk],
  );
}
