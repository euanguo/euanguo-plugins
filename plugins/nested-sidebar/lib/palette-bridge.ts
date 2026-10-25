/**
 * The bridge between bb's quick palette and the mounted inbox.
 *
 * `commandPaletteAction` rows are registered when the plugin's app definition
 * runs — outside React — while every one of Nest's verbs needs state that only
 * exists inside a mounted inbox: the lifecycle rows, the park rules, the view.
 * So the mounted inbox publishes a small dispatcher here, and the palette rows
 * call through it.
 *
 * A module-level slot is the right shape for this and the wrong shape for almost
 * everything else. The palette is a second entry point into the same verbs the
 * rows already offer, and it lives outside the component tree, so there is no
 * prop path from one to the other. The header action's per-pane state is the
 * opposite case: it must stay in its component.
 *
 * Nothing published is a normal state, not an error. The palette is reachable on
 * every surface, and a user who has pinned bb's own list has no Nest inbox to act
 * on. Every reader here returns null or false rather than throwing, and each
 * palette row asks `isAvailable` first — so those rows are hidden instead of
 * being offered and then doing nothing.
 */

/** What the mounted inbox lends to the palette. */
export interface PublishedNestActions {
  /** Settle a thread: archive it, and let the list advance. */
  settle(threadId: string): void;
  /** Snooze a thread until the hover button's own default wake time. */
  snoozeUntilTomorrow(threadId: string): void;
  /** Bring a parked thread back, whichever shelf it is on. */
  wake(threadId: string): void;
  /**
   * Whether this thread may be parked at all.
   *
   * False for a thread the list is not drawing — hidden, archived, or on a
   * client whose view this is not — because the park rules read fields only the
   * drawn rows carry.
   */
  canPark(threadId: string): boolean;
  /** Whether this thread is on the snoozed or the settled shelf. */
  isParked(threadId: string): boolean;
  /** Narrow the list to the threads that need the user. */
  showNeedsYou(): void;
}

let published: PublishedNestActions | null = null;

export function publishNestActions(actions: PublishedNestActions): void {
  published = actions;
}

/**
 * Only the publisher that is still current may clear the slot.
 *
 * A remount publishes the new dispatcher before the old one unmounts — React
 * runs the new effect before the previous cleanup in a strict-mode double
 * invoke, and a fast remount does the same — so an unconditional clear here
 * would take the palette's verbs away for the rest of the session.
 */
export function forgetNestActions(actions: PublishedNestActions): void {
  if (published === actions) published = null;
}

/** The mounted inbox's dispatcher, or null when there is none. */
export function nestActions(): PublishedNestActions | null {
  return published;
}