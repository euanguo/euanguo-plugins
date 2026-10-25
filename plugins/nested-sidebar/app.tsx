// bb-plugin-nested-sidebar — a project-first replacement for bb's sidebar thread
// list. Root threads keep a stable position and expand their child agents in
// place, so activity changes state without moving the user's navigation.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ThreadInbox } from "@/components/inbox/thread-inbox";
import { ChildrenChip } from "@/components/inbox/children-chip";
import { ParentChip } from "@/components/inbox/parent-chip";
import { NestSettingsSection } from "@/components/settings/nest-settings";
import { nestActions } from "@/lib/palette-bridge";
import { UNARCHIVE_RETRY_RENDERER_ID } from "@/lib/unarchive-retry";
import { UnarchiveRetryPrompt } from "@/components/inbox/unarchive-retry-prompt";
import { mountNestRowStatus } from "@/lib/row-status-mount";
import { TitleAttention } from "@/components/title-attention";

export default definePluginApp((app) => {
  /**
   * The additive half: one marker on bb's own rows, whether or not Nest is the
   * chosen list.
   *
   * Everything else in this file needs Nest to be the provider. This does not:
   * it decorates the sidebar bb draws, saying the one thing bb's own list cannot
   * — that Nest is holding a thread back until a time the user chose. A content
   * script is the only surface that runs in both cases, and the host owns the
   * glyph, so this cannot leave a broken list behind it.
   */
  app.contentScripts.register({
    id: "nest-row-status",
    mount: mountNestRowStatus,
  });

  // The desktop title bar has an empty middle. The threads that are working or
  // need the user fit there without being buried in the sidebar's tree.
  app.slots.experimental_appOverlay({
    id: "title-attention",
    component: TitleAttention,
  });

  app.slots.settingsSection({
    id: "appearance",
    title: "Appearance & behavior",
    description: "Preview the effective Nest palette and layout settings.",
    component: NestSettingsSection,
  });

  app.slots.experimental_threadList({
    id: "inbox",
    title: "Nest (projects)",
    description:
      "Stable project groups with expandable root threads and inline agents.",
    component: ThreadInbox,
  });

  // A child remains nested in the sidebar, and this is the direct route back
  // to its root while the user is focused in the thread itself.
  app.slots.experimental_threadHeaderAction({
    id: "parent",
    title: "Parent thread",
    component: ParentChip,
  });

  // The other direction, and the one the sidebar cannot cover: while the user is
  // reading a thread, the list may be on another group tab, filtered past this
  // family, or collapsed. The slot holds a row of actions, so this sits beside
  // the parent chip rather than replacing it.
  app.slots.experimental_threadHeaderAction({
    id: "children",
    title: "Child threads",
    component: ChildrenChip,
  });

  // The view menu can change filtering and ordering, but the display settings
  // (density, row layout, which metadata shows) are `bb.settings`, which the
  // frontend can read but not write. Rather than keep a second copy of them,
  // this is a one-click route to the page that owns them.
  app.slots.sidebarFooterAction({
    id: "settings",
    title: "Nest settings",
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
   * bb's quick palette, so Nest's verbs are reachable without the sidebar.
   *
   * These rows are registered outside React and run outside the inbox's tree, so
   * they reach it through `lib/palette-bridge`. Every one of them asks the
   * mounted inbox first: a user who has pinned bb's own list has no Nest inbox to
   * act on, and a row that is offered and then does nothing is worse than a row
   * that is not offered at all.
   */
  app.slots.commandPaletteAction({
    id: "settle-thread",
    title: "Nest: settle thread",
    isAvailable: ({ threadId }) =>
      threadId !== null && nestActions()?.canPark(threadId) === true,
    run: ({ threadId }) => {
      if (threadId !== null) nestActions()?.settle(threadId);
    },
  });

  app.slots.commandPaletteAction({
    id: "snooze-thread",
    title: "Nest: snooze thread until tomorrow",
    isAvailable: ({ threadId }) =>
      threadId !== null && nestActions()?.canPark(threadId) === true,
    run: ({ threadId }) => {
      if (threadId !== null) nestActions()?.snoozeUntilTomorrow(threadId);
    },
  });

  // The inverse, and gated on the inverse: a wake is only meaningful for a
  // thread that is actually parked.
  app.slots.commandPaletteAction({
    id: "wake-thread",
    title: "Nest: wake thread",
    isAvailable: ({ threadId }) =>
      threadId !== null && nestActions()?.isParked(threadId) === true,
    run: ({ threadId }) => {
      if (threadId !== null) nestActions()?.wake(threadId);
    },
  });

  app.slots.commandPaletteAction({
    id: "show-needs-you",
    title: "Nest: show threads that need you",
    isAvailable: () => nestActions() !== null,
    run: () => nestActions()?.showNeedsYou(),
  });
});
