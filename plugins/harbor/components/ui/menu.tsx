import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@bb-ui/dropdown-menu";
import { useIsCompactViewport } from "@bb-ui/hooks/use-compact-viewport";
import { Icon, type IconName } from "@bb-ui/icon";

import { Z_MENU, Z_SUBMENU } from "@/components/ui/overlay-layers";
import {
  overlayCoordinator,
  useIsMenuActive,
} from "@/lib/ui/overlay-coordinator";
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
 * Shared row sizing and layout across dropdown and context menu primitives.
 */
export const MENU_ITEM_CLASS =
  "flex min-w-0 max-w-full cursor-default select-none items-center gap-2 rounded-md px-2 py-1 text-xs outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40";

/** The row that opens a submenu, in either menu primitive. */
export const MENU_SUBTRIGGER_CLASS = cn(
  MENU_ITEM_CLASS,
  "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
);

const CompactRadioContext = React.createContext<{
  readonly value: string;
  readonly onValueChange: (value: string) => void;
} | null>(null);

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

/**
 * Overlay-coordinated menu backed by BB's `@bb-ui/dropdown-menu` primitive
 * (native desktop menu + compact mobile `ResponsiveDrawerShell`).
 */
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
  const isCompactViewport = useIsCompactViewport();

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
    <DropdownMenu
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
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        data-radix-menu-content=""
        data-radix-dropdown-menu-content=""
        aria-label={label}
        mobileTitle={label}
        align={align}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(isCompactViewport ? "gap-0.5 p-2" : MENU_CONTENT_CLASS, className)}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
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
    <DropdownMenuItem
      variant={destructive ? "destructive" : "default"}
      disabled={disabled}
      onSelect={onSelect}
      className={cn(MENU_ITEM_CLASS, destructive && "text-destructive")}
    >
      <MenuItemBody icon={icon} label={label} destructive={destructive} />
    </DropdownMenuItem>
  );
}

/** A row with an active/inactive check indicator. */
export function MenuCheckboxItem({
  icon = "Layers",
  label,
  checked,
  disabled = false,
  keepOpen = false,
  onSelect,
}: {
  icon?: IconName;
  label: string;
  checked: boolean;
  disabled?: boolean;
  keepOpen?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      disabled={disabled}
      onSelect={(event) => {
        if (keepOpen) {
          event.preventDefault();
        }
        onSelect();
      }}
      className={cn(MENU_ITEM_CLASS, "pr-7")}
    >
      <Icon
        name={icon}
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </DropdownMenuCheckboxItem>
  );
}

/**
 * A second-level menu. On desktop Radix portals it above the parent menu;
 * on compact mobile drawers (`ResponsiveDrawerShell`), renders as an inline
 * expandable section so `DropdownMenuPrimitive.Sub` never lacks a desktop Root.
 */
export function MenuSub({
  label,
  icon,
  hint,
  children,
}: {
  label: string;
  icon?: IconName;
  hint?: string;
  children: React.ReactNode;
}) {
  const isCompactViewport = useIsCompactViewport();
  const [expanded, setExpanded] = React.useState(false);

  if (isCompactViewport) {
    return (
      <div className="flex flex-col">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className={cn(
            MENU_ITEM_CLASS,
            "w-full py-2 text-left hover:bg-state-hover hover:text-foreground",
          )}
        >
          <MenuItemBody icon={icon} label={label} />
          {hint === undefined ? null : (
            <span className="max-w-24 shrink-0 truncate text-2xs text-muted-foreground">
              {hint}
            </span>
          )}
          <Icon
            name={expanded ? "ChevronDown" : "ChevronRight"}
            className="size-3.5 text-muted-foreground"
            aria-hidden
          />
        </button>
        {expanded ? (
          <div className="ml-4 flex flex-col gap-0.5 border-l border-border/60 pl-2">
            {children}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={MENU_SUBTRIGGER_CLASS}>
        <MenuItemBody icon={icon} label={label} />
        {hint === undefined ? null : (
          <span className="max-w-24 shrink-0 truncate text-2xs text-muted-foreground">
            {hint}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          data-radix-menu-content=""
          data-radix-dropdown-menu-content=""
          aria-label={label}
          sideOffset={2}
          collisionPadding={8}
          className={MENU_SUBMENU_CLASS}
        >
          {children}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export function MenuSeparator() {
  return <DropdownMenuSeparator className="my-1 h-px bg-border/70" />;
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
  const isCompactViewport = useIsCompactViewport();

  if (isCompactViewport) {
    return (
      <CompactRadioContext.Provider value={{ value, onValueChange }}>
        <div role="radiogroup">{children}</div>
      </CompactRadioContext.Provider>
    );
  }

  return (
    <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </DropdownMenuRadioGroup>
  );
}

export function MenuRadioItem({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const compactRadio = React.useContext(CompactRadioContext);

  if (compactRadio !== null) {
    const selected = compactRadio.value === value;
    return (
      <DropdownMenuItem
        role="menuitemradio"
        aria-checked={selected}
        onSelect={() => compactRadio.onValueChange(value)}
        className={MENU_ITEM_CLASS}
      >
        <span
          aria-hidden
          className="flex size-3.5 shrink-0 items-center justify-center"
        >
          {selected ? (
            <Icon name="Check" className="size-3.5 text-primary" aria-hidden />
          ) : null}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuRadioItem value={value} className={cn(MENU_ITEM_CLASS, "pl-2")}>
      <span
        aria-hidden
        className="flex size-3.5 shrink-0 items-center justify-center"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </DropdownMenuRadioItem>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenuLabel className="px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </DropdownMenuLabel>
  );
}

/** A menu item whose inside is the caller's. */
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
    <DropdownMenuItem
      onSelect={onSelect}
      className={cn(MENU_ITEM_CLASS, "items-start gap-2", className)}
    >
      {children}
    </DropdownMenuItem>
  );
}
