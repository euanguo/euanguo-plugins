/**
 * Pure decisions for the shared full-row anchor. They live outside the
 * component so tests can run them without a DOM.
 */

export type ThreadRowAriaCurrent = "page" | undefined;

export function threadRowAriaCurrent(active: boolean): ThreadRowAriaCurrent {
  return active ? "page" : undefined;
}

export function threadRowSplitClick(modifiers: {
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return modifiers.metaKey || modifiers.ctrlKey;
}
