import { useMemo, useState } from "react";
import {
  ThreadTitle,
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  useComposers,
  useSdk,
  type NewThreadRequest,
  type PluginComposerApi,
  type PluginNavPanelProps,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import { Icon } from "@/components/ui/icon";
import { useWorkspaceIndex } from "@/hooks/use-workspace-index";
import { workspaceChats } from "@/lib/workspace-tabs";
import {
  draftKeyFor,
  environmentIdFromSubPath,
} from "./route.js";

function findComposer(
  composers: readonly PluginComposerApi[],
  draftKey: string,
): PluginComposerApi | null {
  const fresh = composers.filter(
    (composer) => composer.scope.kind === "new-thread",
  );
  return (
    fresh.find((composer) => composer.key.includes(draftKey)) ??
    fresh.at(-1) ??
    null
  );
}

function TranscriptChips({
  chats,
  draftKey,
}: {
  chats: readonly PluginSidebarThread[];
  draftKey: string;
}) {
  const composers = useComposers();
  const add = (chat: PluginSidebarThread) => {
    const composer = findComposer(composers, draftKey);
    if (composer === null) return;
    composer.insert([
      {
        from: 0,
        to: 0,
        kind: "thread",
        threadId: chat.id,
        projectId: chat.projectId,
        label: chat.displayTitle,
      },
      " ",
    ]);
    composer.focus();
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {chats.map((chat) => (
        <button
          key={chat.id}
          type="button"
          className="inline-flex h-7 max-w-64 min-w-0 items-center gap-1.5 rounded-md border border-border-hairline px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={() => add(chat)}
        >
          <Icon name="MessageSquare" className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            <ThreadTitle threadId={chat.id} />
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * A new conversation bound to one workspace.
 *
 * The composer reuses the workspace's environment, so the thread starts in the
 * same worktree the strip belongs to. The chips add another conversation's
 * transcript as a mention, which is how a new chat inherits context without a
 * message being sent for it.
 */
export function NewChatPage({ subPath }: PluginNavPanelProps) {
  const environmentId = environmentIdFromSubPath(subPath);
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const index = useWorkspaceIndex();
  const { threads } = useSidebarThreads();
  const [focusRequest, setFocusRequest] = useState(1);

  const workspace = useMemo(() => {
    if (environmentId === null) return null;
    const key = index.byEnvironmentId.get(environmentId);
    return key === undefined ? null : (index.byKey.get(key) ?? null);
  }, [environmentId, index]);

  const chats = useMemo(() => {
    if (environmentId === null || workspace === null) return [];
    return workspaceChats(threads, workspace.key, "", index);
  }, [environmentId, index, threads, workspace]);

  if (environmentId === null || workspace === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        This workspace has no conversations.
      </div>
    );
  }

  const close = () => {
    const target = chats.at(-1);
    if (target !== undefined) navigate.toThread(target.id);
  };

  return (
    <div
      data-nest-new-chat={environmentId}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border-hairline px-3 text-xs text-muted-foreground">
        <Icon name="MessageSquarePlus" className="size-3.5" />
        <span>
          New conversation in{" "}
          <code className="font-mono text-foreground">/{workspace.label}</code>
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className="inline-flex h-6 items-center rounded-md px-2 hover:bg-state-hover hover:text-foreground"
          onClick={close}
        >
          Back
        </button>
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 overflow-y-auto px-6 py-5 text-sm text-muted-foreground">
        {chats.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <p>Add a conversation&apos;s transcript:</p>
            <TranscriptChips chats={chats} draftKey={draftKeyFor(environmentId)} />
          </div>
        )}
      </div>
      <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
        <NewThreadComposer
          key={environmentId}
          layout="document"
          draftKey={draftKeyFor(environmentId)}
          defaultProjectId={workspace.projectId}
          defaultEnvironment={{ type: "reuse", environmentId }}
          focusRequest={focusRequest}
          placeholder="Ask to make changes, @mention files, run /commands"
          onSubmit={async (request: NewThreadRequest) => {
            const thread = await sdk.threads.spawn(request);
            navigate.toThread(thread.id);
          }}
        />
        <button
          type="button"
          className="mt-2 text-2xs text-muted-foreground hover:text-foreground"
          onClick={() => setFocusRequest((value) => value + 1)}
        >
          Focus the composer
        </button>
      </div>
    </div>
  );
}
