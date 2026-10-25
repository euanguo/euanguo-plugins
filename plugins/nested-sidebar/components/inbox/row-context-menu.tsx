import { Fragment, type ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { cn } from "@/lib/utils";
import {
  MENU_CONTENT_CLASS,
  MENU_ITEM_CLASS,
  MENU_SUBMENU_CLASS,
  MENU_SUBTRIGGER_CLASS,
  MenuItemBody,
} from "@/components/ui/menu";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "@/components/ui/icon";

/**
 * The one menu in this sidebar: right-click a row, anywhere in the tree.
 *
 * The plugin API ships no menu component on purpose, so a replaced sidebar owns
 * this surface. Every level — a group, a project, a worktree, a thread family,
 * a child thread, a parked row — opens *this*, with the same item shape, the
 * same dividers, the same icons and the same keyboard route (`Shift+F10` and the
 * context-menu key come from the primitive, so they work wherever a right-click
 * does). Nest used to put a `⋯` button on each row instead, which meant one
 * trigger, one hover state and one menu per level that could drift; the
 * affordances test pins that they are gone.
 *
 * Nested rows are why the primitive matters: a right-click on a thread bubbles
 * to the project it sits in, and Radix's inner trigger calls `preventDefault()`,
 * which is what stops the outer project menu from opening underneath it.
 *
 * The items are described by the caller — `useThreadMenuActions` for threads —
 * rather than here, so one action is written once and every entrance to it stays
 * the same. The destructive ones are `requestDelete` and `remove`, which open
 * BB's confirmation rather than deleting a subtree silently.
 */
interface RowMenuEntry {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  /** Draw a divider above this entry, so the menu reads in the same groups. */
  readonly separatorBefore?: boolean;
  /** The current value, shown on a submenu's own row. */
  readonly hint?: string;
}

/** A leaf: picking it does something. */
export interface RowMenuAction extends RowMenuEntry {
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  /**
   * A leaf that is held on or off, rather than merely available.
   *
   * Distinct from a submenu's `choices`: there, one of several answers is picked
   * and the tick says which; here there is one answer and the tick says whether
   * it is in force. "Show archived threads" is the case — it is the project's
   * own state, and the menu is the only surface the project row offers.
   */
  readonly checked?: boolean;
  readonly onSelect: () => void;
  readonly choices?: never;
}

/** One answer inside a submenu, ticked when it is the one in force. */
export interface RowMenuChoice {
  readonly key: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onSelect: () => void;
}

/**
 * A submenu: for a decision with more than two answers, which reads better one
 * level down than as a wall of sibling rows.
 */
export interface RowMenuSubmenu extends RowMenuEntry {
  readonly choices: readonly RowMenuChoice[];
  readonly onSelect?: never;
}

export type RowMenuItem = RowMenuAction | RowMenuSubmenu;

export function RowMenu({
  label,
  items,
  dialog,
  children,
}: {
  /** The menu's accessible name, e.g. "Project actions". */
  label: string;
  items: readonly RowMenuItem[];
  /** A confirmation the items need, mounted by the caller so it outlives the menu. */
  dialog?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content aria-label={label} className={MENU_CONTENT_CLASS}>
            {items.map((item) => (
              <Fragment key={item.key}>
                {item.separatorBefore ? <Separator /> : null}
                {item.choices === undefined && item.checked !== undefined ? (
                  <ContextMenu.CheckboxItem
                    checked={item.checked}
                    disabled={item.disabled ?? false}
                    onSelect={item.onSelect}
                    className={MENU_ITEM_CLASS}
                  >
                    <Icon
                      name={item.icon}
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                    <ContextMenu.ItemIndicator>
                      <Icon
                        name="Check"
                        className="size-3.5 text-primary"
                        aria-hidden
                      />
                    </ContextMenu.ItemIndicator>
                  </ContextMenu.CheckboxItem>
                ) : item.choices === undefined ? (
                  <ContextMenu.Item
                    disabled={item.disabled ?? false}
                    onSelect={item.onSelect}
                    className={cn(
                      MENU_ITEM_CLASS,
                      item.destructive && "text-destructive",
                    )}
                  >
                    <MenuItemBody
                      icon={item.icon}
                      label={item.label}
                      destructive={item.destructive ?? false}
                    />
                  </ContextMenu.Item>
                ) : (
                  <ContextMenu.Sub>
                    <ContextMenu.SubTrigger className={MENU_SUBTRIGGER_CLASS}>
                      <MenuItemBody icon={item.icon} label={item.label} />
                      {item.hint === undefined ? null : (
                        <span className="max-w-24 shrink-0 truncate text-2xs text-muted-foreground">
                          {item.hint}
                        </span>
                      )}
                      <Icon
                        name="ChevronRight"
                        className="size-3 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </ContextMenu.SubTrigger>
                    <ContextMenu.Portal>
                      <ContextMenu.SubContent
                        aria-label={item.label}
                        sideOffset={2}
                        collisionPadding={8}
                        className={MENU_SUBMENU_CLASS}
                      >
                        {item.choices.map((choice) => (
                          <ContextMenu.RadioGroup
                            key={choice.key}
                            value={choice.checked ? choice.key : ""}
                          >
                            <ContextMenu.RadioItem
                              value={choice.key}
                              onSelect={choice.onSelect}
                              className={MENU_ITEM_CLASS}
                            >
                              <Icon
                                name={choice.checked ? "Check" : "FolderTree"}
                                className={cn(
                                  "size-3.5 shrink-0",
                                  choice.checked
                                    ? "text-primary"
                                    : "text-muted-foreground",
                                )}
                                aria-hidden
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {choice.label}
                              </span>
                            </ContextMenu.RadioItem>
                          </ContextMenu.RadioGroup>
                        ))}
                      </ContextMenu.SubContent>
                    </ContextMenu.Portal>
                  </ContextMenu.Sub>
                )}
              </Fragment>
            ))}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {dialog}
    </>
  );
}

function Separator() {
  return <ContextMenu.Separator className="my-1 h-px bg-border" />;
}
