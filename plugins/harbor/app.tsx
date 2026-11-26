// bb-plugin-harbor — a project-first replacement for bb's sidebar thread
// list. Root threads keep a stable position and expand their child agents in
// place, so activity changes state without moving the user's navigation.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import "@/components/ui/semantic-tones.css";
import { ThreadInbox } from "@/components/inbox/thread-inbox";
import {
  FamilySegment,
  useFamilySegmentVisible,
} from "@/components/thread-context/family-segment";
import { WorkspaceBreadcrumb } from "@/components/header/WorkspaceBreadcrumb";
import { NewChatPage } from "@/app/new-chat/NewChatPage";
import { NEW_CHAT_PANEL_PATH } from "@/app/new-chat/route";
import { WorkspaceTabs } from "@/components/header/WorkspaceTabs";
import { AppBridgeOverlay } from "@/components/AppBridgeOverlay";
import { forkToNewWorkspace } from "@/app/fork";
import { HarborSettingsSection } from "@/components/settings/harbor-settings";
import { harborActions } from "@/lib/ui/palette-bridge";
import { UNARCHIVE_RETRY_RENDERER_ID } from "@/lib/domain/unarchive-retry";
import { UnarchiveRetryPrompt } from "@/components/inbox/unarchive-retry-prompt";
import { mountHarborRowStatus } from "@/lib/ui/row-status-mount";
import { TitleAttention } from "@/components/title-attention";
import { FeatureHubPanel } from "@/components/feature-hub/feature-hub-panel";
import { FEATURE_HUB_TAB_REF } from "@/components/feature-hub/hub-tab-ref";
import { useFeatureHubVisible } from "@/components/feature-hub/use-thread-feature";
import {
  FeatureContextCardSummaryRow,
  FeatureInfoSummaryRow,
} from "@/components/thread-context/feature-context-card";

export default definePluginApp((app) => {
  /**
   * The additive half: one marker on bb's own rows, whether or not Harbor is the
   * chosen list.
   *
   * Everything else in this file needs Harbor to be the provider. This does not:
   * it decorates the sidebar bb draws, saying the one thing bb's own list cannot
   * — that Harbor is holding a thread back until a time the user chose. A content
   * script is the only surface that runs in both cases, and the host owns the
   * glyph, so this cannot leave a broken list behind it.
   */
  app.contentScripts.register({
    id: "harbor-row-status",
    mount: mountHarborRowStatus,
  });

  // The desktop title bar has an empty middle. The threads that are working or
  // need the user fit there without being buried in the sidebar's tree.
  app.slots.experimental_appOverlay({
    id: "title-attention",
    component: TitleAttention,
  });

  /**
   * The settings page, in tabs.
   *
   * This used to be a preview under a wall of host-drawn fields: every
   * appearance setting was a `bb.settings` descriptor, the host drew one form
   * row per descriptor above this section, and the plugin could neither group
   * nor reorder them. The descriptors that remain are the agent switches the server
   * reads; everything a user actually tunes is drawn here.
   */
  app.slots.settingsSection({
    id: "settings",
    title: "Harbor settings",
    component: HarborSettingsSection,
  });

  app.slots.experimental_threadList({
    id: "inbox",
    title: "Harbor",
    description:
      "Multi-repo feature cockpit, decoupled project groups, and worktree-aware thread trees.",
    component: ThreadInbox,
  });

  app.slots.experimental_appOverlay({
    id: "bridge",
    component: AppBridgeOverlay,
  });
  app.slots.messageAction({
    id: "fork-to-new-workspace",
    title: "Fork to new workspace",
    icon: "FolderGit",
    async run(context) {
      await forkToNewWorkspace(context).catch((error: unknown) => {
        console.error(error);
      });
    },
  });

  // Every thread pane in a workspace gets a strip of its conversations, under
  // the header and above the timeline, and a breadcrumb in place of the raw
  // thread title.
  app.slots.experimental_threadHeaderRow({
    id: "workspace-tabs",
    component: WorkspaceTabs,
  });
  app.slots.experimental_threadHeaderTitle({
    id: "workspace-breadcrumb",
    component: WorkspaceBreadcrumb,
  });

  // The plus on the strip opens this page rather than bb's composer, so the
  // new conversation is bound to the workspace the strip belongs to.
  app.slots.navPanel({
    id: "new-chat",
    title: "New chat",
    icon: "MessageSquarePlus",
    path: NEW_CHAT_PANEL_PATH,
    component: NewChatPage,
    experimental_hideFromNavigation: true,
  });

  // The family chips sit in the context row above the composer, the same row
  // bb's own parent-thread segment uses. One registration draws both, because
  // a thread can have a parent and children at once.
  app.slots.experimental_threadContextSegment({
    id: "family",
    title: "Thread family",
    group: "harbor",
    summary: FamilySegment,
    useVisible: useFamilySegmentVisible,
  });

  app.slots.experimental_tab({
    id: FEATURE_HUB_TAB_REF.id,
    context: { kind: "thread" },
    availability: "fixed",
    experimental_target: FEATURE_HUB_TAB_REF.experimental_target,
    title: "Feature Hub",
    icon: "Layers",
    layout: "flush",
    useVisible: useFeatureHubVisible,
    component: FeatureHubPanel,
  });

  app.slots.experimental_threadContextCardRow({
    id: "harbor-feature-summary",
    group: "harbor",
    order: 1,
    component: FeatureContextCardSummaryRow,
  });

  app.slots.experimental_threadInfoRow({
    id: "harbor-feature-info",
    group: "harbor",
    order: 1,
    component: FeatureInfoSummaryRow,
  });

  // The view menu can change filtering and ordering, but the display settings
  // (density, row layout, which metadata shows) are `bb.settings`, which the
  // frontend can read but not write. Rather than keep a second copy of them,
  // this is a one-click route to the page that owns them.
  app.slots.sidebarFooterAction({
    id: "settings",
    title: "Harbor settings",
    icon: "Settings",
    run: (context) => context.openSettings(),
  });

  /**
   * The one question this sidebar asks outside its own dialogs.
   *
   * Un-settling takes bb's archive off a thread, and that runs on the thread's
   * own machine. When it cannot be reached the thread stays archived and leaves
   * the sidebar — which used to be a silent failure the user had to diagnose
   * from a missing row. The backend raises this renderer through
   * `bb.ui.requestInput`, and the retry becomes a button.
   */
  app.slots.pendingInteraction({
    id: UNARCHIVE_RETRY_RENDERER_ID,
    component: UnarchiveRetryPrompt,
  });

  /**
   * bb's quick palette, so Harbor's verbs are reachable without the sidebar.
   *
   * These rows are registered outside React and run outside the inbox's tree, so
   * they reach it through `lib/ui/palette-bridge`. Every one of them asks the
   * mounted inbox first: a user who has pinned bb's own list has no Harbor inbox to
   * act on, and a row that is offered and then does nothing is worse than a row
   * that is not offered at all.
   */
  app.slots.commandPaletteAction({
    id: "settle-thread",
    title: "Harbor: settle thread",
    isAvailable: ({ threadId }) =>
      threadId !== null && harborActions()?.canPark(threadId) === true,
    run: ({ threadId }) => {
      if (threadId !== null) harborActions()?.settle(threadId);
    },
  });

  app.slots.commandPaletteAction({
    id: "snooze-thread",
    title: "Harbor: snooze thread until tomorrow",
    isAvailable: ({ threadId }) =>
      threadId !== null && harborActions()?.canPark(threadId) === true,
    run: ({ threadId }) => {
      if (threadId !== null) harborActions()?.snoozeUntilTomorrow(threadId);
    },
  });

  // The inverse, and gated on the inverse: a wake is only meaningful for a
  // thread that is actually parked.
  app.slots.commandPaletteAction({
    id: "wake-thread",
    title: "Harbor: wake thread",
    isAvailable: ({ threadId }) =>
      threadId !== null && harborActions()?.isParked(threadId) === true,
    run: ({ threadId }) => {
      if (threadId !== null) harborActions()?.wake(threadId);
    },
  });

  app.slots.commandPaletteAction({
    id: "show-needs-you",
    title: "Harbor: show threads that need you",
    isAvailable: () => harborActions() !== null,
    run: () => harborActions()?.showNeedsYou(),
  });

  app.slots.commandPaletteAction({
    id: "open-feature-hub",
    title: "Harbor: open Feature Hub",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ experimental_panel }) => {
      experimental_panel.openTab({
        tab: FEATURE_HUB_TAB_REF,
        target: { section: "overview", directory: null },
      });
    },
  });
});
