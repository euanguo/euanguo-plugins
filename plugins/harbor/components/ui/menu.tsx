import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as React from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { Z_MENU, Z_SUBMENU } from "@/components/ui/overlay-layers";
import {
  overlayCoordinator,
  useIsMenuActive,
} from "@/lib/ui/overlay-coordinator";
import { usePortalScopeProps } from "@/lib/ui/portal-scope";
import { cn } from "@/lib/ui/utils";

export { Z_MENU };

const MENU_SURFACE_CLASS =
  "min-w-44 overflow-hidden rounded-xl border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg outline-none";

export const MENU_CONTENT_CLASS = cn(Z_MENU, MENU_SURFACE_CLASS);

/**
 * A menu's own submenu. Radix portals it separately, so it sits one rung above
 * its parent menu on the shared stacking ladder.
 */
export const MENU_SUBMENU_CLASS = cn(Z_SUBMENU, MENU_SURFACE_CLASS);

/**
 * One menu row's own styling, shared by every surface that draws menu items.
 */
export const MENU_ITEM_CLASS = cn(
  "flex min-w-0 max-w-full cursor-default select-none items-center gap-2 rounded-md px-2 py-1 text-xs outline-none",
  "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
);

/** The row that opens a submenu, in either menu primitive. */
export const MENU_SUBTRIGGER_CLASS = cn(
  MENU_ITEM_CLASS,
  "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
);

/**
 * The inside of a menu item: an icon column that keeps labels aligned whether or
 * not a row has an icon, then the label.
 */
export function MenuItemBody({
  icon,
  label,
  destructive = false,
}: {
  icon?: IconName;
  label: string;
  destructive?: boolean;
}) {
  return (
    <>
      {icon === undefined ? (
        <span aria-hidden className="size-3.5 shrink-0" />
      ) : (
        <Icon
          name={icon}
          className={cn(
            "size-3.5 shrink-0",
            destructive ? "text-destructive" : "text-muted-foreground",
          )}
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </>
  );
}

/** A menu that opens from a trigger and renders in the root stacking context. */
export function Menu({
  trigger,
  open,
  onOpenChange,
  label,
  align = "end",
  side = "bottom",
  sideOffset = 4,
  className,
  children,
}: {
  trigger: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  label: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const menuId = React.useId();
  const activeMenuOpen = useIsMenuActive(menuId);
  const isControlled = open !== undefined;
  const resolvedOpen = isControlled ? open : activeMenuOpen;
  const wasControlledActiveRef = React.useRef(false);
  const scope = usePortalScopeProps();

  React.useLayoutEffect(() => {
    if (!isControlled) return;
    if (open) {
      overlayCoordinator.openMenu(menuId);
    } else {
      wasControlledActiveRef.current = false;
      overlayCoordinator.closeMenu(menuId);
    }
  }, [isControlled, menuId, open]);

  React.useEffect(() => {
    if (!isControlled || !open) {
      wasControlledActiveRef.current = false;
      return;
    }
    if (activeMenuOpen) {
      wasControlledActiveRef.current = true;
      return;
    }
    if (wasControlledActiveRef.current) {
      wasControlledActiveRef.current = false;
      onOpenChange?.(false);
    }
  }, [activeMenuOpen, isControlled, onOpenChange, open]);

  React.useEffect(() => {
    return () => {
      overlayCoordinator.closeMenu(menuId);
    };
  }, [menuId]);

  return (
    <DropdownMenu.Root
      open={resolvedOpen}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          overlayCoordinator.openMenu(menuId);
        } else {
          overlayCoordinator.closeMenu(menuId);
        }
        onOpenChange?.(nextOpen);
      }}
      modal={false}
    >
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-radix-dropdown-menu-content=""
          {...scope}
          aria-label={label}
          align={align}
          side={side}
          sideOffset={sideOffset}
          collisionPadding={8}
          className={cn(MENU_CONTENT_CLASS, className)}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({
  icon,
  label,
  destructive = false,
  disabled = false,
  onSelect,
}: {
  icon?: IconName;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(MENU_ITEM_CLASS, destructive && "text-destructive")}
    >
      <MenuItemBody icon={icon} label={label} destructive={destructive} />
    </DropdownMenu.Item>
  );
}

/** A row with an active/inactive check indicator. */
export function MenuCheckboxItem({
  icon = "Layers",
  label,
  checked,
  disabled = false,
  onSelect,
}: {
  icon?: IconName;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.CheckboxItem
      checked={checked}
      disabled={disabled}
      onSelect={onSelect}
      className={MENU_ITEM_CLASS}
    >
      <Icon
        name={icon}
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <DropdownMenu.ItemIndicator>
        <Icon name="Check" className="size-3.5 text-primary" aria-hidden />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.CheckboxItem>
  );
}

/** A second-level menu. Radix portals it separately, above the parent menu. */
export function MenuSub({
  label,
  icon,
  hint,
  children,
}: {
  label: string;
  icon?: IconName;
  /**
   * The current value, shown on the trigger. A submenu that reports its own
   * state means the menu does not have to be opened to read the tree's order.
   */
  hint?: string;
  children: React.ReactNode;
}) {
  const scope = usePortalScopeProps();
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={MENU_SUBTRIGGER_CLASS}>
        {icon === undefined ? (
          <span aria-hidden className="size-3.5 shrink-0" />
        ) : (
          <Icon
            name={icon}
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hint === undefined ? null : (
          <span className="max-w-24 shrink-0 truncate text-2xs text-muted-foreground">
            {hint}
          </span>
        )}
        <Icon
          name="ChevronRight"
          className="size-3.5 text-muted-foreground"
          aria-hidden
        />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          data-radix-dropdown-menu-content=""
          {...scope}
          aria-label={label}
          sideOffset={2}
          collisionPadding={8}
          className={MENU_SUBMENU_CLASS}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-border/70" />;
}

/** A group of mutually exclusive choices, e.g. one sort mode or one filter. */
export function MenuRadioGroup({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu.RadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </DropdownMenu.RadioGroup>
  );
}

export function MenuRadioItem({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <DropdownMenu.RadioItem value={value} className={MENU_ITEM_CLASS}>
      <span
        aria-hidden
        className="flex size-3.5 shrink-0 items-center justify-center"
      >
        <DropdownMenu.ItemIndicator>
          <Icon name="Check" className="size-3.5 text-primary" aria-hidden />
        </DropdownMenu.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </DropdownMenu.RadioItem>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu.Label className="px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </DropdownMenu.Label>
  );
}

/**
 * A menu item whose inside is the caller's.
 */
export function MenuRow({
  onSelect,
  className,
  children,
}: {
  onSelect: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(MENU_ITEM_CLASS, "items-start gap-2", className)}
    >
      {children}
    </DropdownMenu.Item>
  );
}
