import { Fragment, useEffect, useId, type MouseEventHandler, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@bb-ui/context-menu";
import { Icon, type IconName } from "@bb-ui/icon";

import {
  MENU_CONTENT_CLASS,
  MENU_ITEM_CLASS,
  MENU_SUBMENU_CLASS,
  MENU_SUBTRIGGER_CLASS,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuItemBody,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
} from "@/components/ui/menu";
import {
  overlayCoordinator,
  useIsMenuActive,
} from "@/lib/ui/overlay-coordinator";
import { cn } from "@/lib/ui/utils";

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
   */
  readonly checked?: boolean;
  readonly onSelect: () => void;
  readonly choices?: never;
}

/** One entry inside a submenu: either a radio choice (`checked` set) or an action. */
export interface RowMenuChoice {
  readonly key: string;
  readonly label: string;
  readonly checked?: boolean;
  readonly icon?: IconName;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

/**
 * A submenu: for a choice list or grouped secondary actions such as `Copy ▸`.
 */
export interface RowMenuSubmenu extends RowMenuEntry {
  readonly choices: readonly RowMenuChoice[];
  readonly onSelect?: never;
}

export type RowMenuItem = RowMenuAction | RowMenuSubmenu;

function isRadioSubmenu(choices: readonly RowMenuChoice[]): boolean {
  return choices.some((choice) => choice.checked !== undefined);
}

/**
 * Context menu attached to every sidebar row, backed by BB's `@bb-ui/context-menu`
 * and coordinated through `overlayCoordinator`.
 */
export function RowMenu({
  label,
  items,
  dialog,
  children,
}: {
  label: string;
  items: readonly RowMenuItem[];
  dialog?: ReactNode;
  children: ReactNode;
}) {
  const menuId = useId();
  const isOpen = useIsMenuActive(menuId);

  useEffect(() => {
    return () => {
      overlayCoordinator.closeMenu(menuId);
    };
  }, [menuId]);

  return (
    <>
      <ContextMenu
        modal={false}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            overlayCoordinator.openMenu(menuId);
          } else {
            overlayCoordinator.closeMenu(menuId);
          }
        }}
      >
        <ContextMenuTrigger
          asChild
          onContextMenu={() => {
            overlayCoordinator.dismissHover();
          }}
        >
          {children}
        </ContextMenuTrigger>
        {isOpen ? (
          <ContextMenuContent
            data-radix-menu-content=""
            data-radix-context-menu-content=""
            aria-label={label}
            className={MENU_CONTENT_CLASS}
          >
            {items.map((item) => (
              <Fragment key={item.key}>
                {item.separatorBefore ? (
                  <ContextMenuSeparator className="my-1 h-px bg-border" />
                ) : null}
                {item.choices === undefined && item.checked !== undefined ? (
                  <ContextMenuCheckboxItem
                    checked={item.checked}
                    disabled={item.disabled ?? false}
                    onSelect={item.onSelect}
                    className={cn(MENU_ITEM_CLASS, "pr-7")}
                  >
                    <Icon
                      name={item.icon}
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                  </ContextMenuCheckboxItem>
                ) : item.choices === undefined ? (
                  <ContextMenuItem
                    disabled={item.disabled ?? false}
                    onSelect={item.onSelect}
                    className={cn(
                      MENU_ITEM_CLASS,
                      item.destructive && "text-destructive focus:text-destructive",
                    )}
                  >
                    <MenuItemBody
                      icon={item.icon}
                      label={item.label}
                      destructive={item.destructive ?? false}
                    />
                  </ContextMenuItem>
                ) : (
                  <ContextMenuSub>
                    <ContextMenuSubTrigger className={MENU_SUBTRIGGER_CLASS}>
                      <MenuItemBody icon={item.icon} label={item.label} />
                      {item.hint === undefined ? null : (
                        <span className="max-w-24 shrink-0 truncate text-2xs text-muted-foreground">
                          {item.hint}
                        </span>
                      )}
                    </ContextMenuSubTrigger>
                    <ContextMenuPortal>
                      <ContextMenuSubContent
                        data-radix-menu-content=""
                        data-radix-context-menu-content=""
                        aria-label={item.label}
                        sideOffset={2}
                        collisionPadding={8}
                        className={MENU_SUBMENU_CLASS}
                      >
                        {isRadioSubmenu(item.choices) ? (
                          <ContextMenuRadioGroup
                            value={
                              item.choices.find((choice) => choice.checked === true)
                                ?.key ?? ""
                            }
                          >
                            {item.choices.map((choice) => (
                              <ContextMenuRadioItem
                                key={choice.key}
                                value={choice.key}
                                disabled={choice.disabled ?? false}
                                onSelect={choice.onSelect}
                                className={cn(MENU_ITEM_CLASS, "pl-2")}
                              >
                                <span
                                  aria-hidden
                                  className="size-3.5 shrink-0"
                                />
                                <span className="min-w-0 flex-1 truncate">
                                  {choice.label}
                                </span>
                              </ContextMenuRadioItem>
                            ))}
                          </ContextMenuRadioGroup>
                        ) : (
                          item.choices.map((choice) => (
                            <ContextMenuItem
                              key={choice.key}
                              disabled={choice.disabled ?? false}
                              onSelect={choice.onSelect}
                              className={MENU_ITEM_CLASS}
                            >
                              <MenuItemBody
                                icon={choice.icon}
                                label={choice.label}
                              />
                            </ContextMenuItem>
                          ))
                        )}
                      </ContextMenuSubContent>
                    </ContextMenuPortal>
                  </ContextMenuSub>
                )}
              </Fragment>
            ))}
          </ContextMenuContent>
        ) : null}
      </ContextMenu>
      {dialog}
    </>
  );
}

/**
 * Hover/focus `⋯` trigger button rendering the exact same `RowMenuItem[]`
 * vocabulary through `DropdownMenu` (`Menu`).
 */
export function RowMenuButton({
  label,
  items,
  dialog,
  align = "end",
  side = "bottom",
  className,
  onClick,
}: {
  label: string;
  items: readonly RowMenuItem[];
  dialog?: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <>
      <Menu
        label={label}
        align={align}
        side={side}
        trigger={
          <button
            type="button"
            aria-label={label}
            title={label}
            data-bb-icon-button=""
            data-harbor-row-menu-trigger=""
            onPointerDown={(event) => {
              event.stopPropagation();
              overlayCoordinator.dismissHover();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onClick?.(event);
            }}
            className={cn(
              "relative z-10 flex size-5 shrink-0 items-center justify-center rounded-md",
              "text-muted-foreground transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "data-[state=open]:bg-sidebar-accent data-[state=open]:text-foreground",
              "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/project:opacity-100 [@media(hover:hover)]:group-hover/ws:opacity-100 [@media(hover:hover)]:group-focus-within/project:opacity-100 [@media(hover:hover)]:group-focus-within/ws:opacity-100 data-[state=open]:opacity-100",
              "motion-reduce:transition-none",
              className,
            )}
          >
            <Icon name="MoreHorizontal" className="size-3.5" aria-hidden />
          </button>
        }
      >
        {items.map((item) => (
          <Fragment key={item.key}>
            {item.separatorBefore ? <MenuSeparator /> : null}
            {item.choices === undefined && item.checked !== undefined ? (
              <MenuCheckboxItem
                icon={item.icon}
                label={item.label}
                checked={item.checked}
                disabled={item.disabled ?? false}
                onSelect={item.onSelect}
              />
            ) : item.choices === undefined ? (
              <MenuItem
                icon={item.icon}
                label={item.label}
                destructive={item.destructive ?? false}
                disabled={item.disabled ?? false}
                onSelect={item.onSelect}
              />
            ) : (
              <MenuSub label={item.label} icon={item.icon} hint={item.hint}>
                {isRadioSubmenu(item.choices) ? (
                  <MenuRadioGroup
                    value={
                      item.choices.find((choice) => choice.checked === true)
                        ?.key ?? ""
                    }
                    onValueChange={(nextKey) => {
                      item.choices
                        .find((choice) => choice.key === nextKey)
                        ?.onSelect();
                    }}
                  >
                    {item.choices.map((choice) => (
                      <MenuRadioItem
                        key={choice.key}
                        value={choice.key}
                        label={choice.label}
                      />
                    ))}
                  </MenuRadioGroup>
                ) : (
                  item.choices.map((choice) => (
                    <MenuItem
                      key={choice.key}
                      icon={choice.icon}
                      label={choice.label}
                      disabled={choice.disabled ?? false}
                      onSelect={choice.onSelect}
                    />
                  ))
                )}
              </MenuSub>
            )}
          </Fragment>
        ))}
      </Menu>
      {dialog}
    </>
  );
}
