import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  useOverlayPortalContainer,
  usePortalScopeProps,
} from "@/lib/portal-scope";

/**
 * The plugin's stacking ladder, in one place.
 *
 * Everything that floats is portaled to the document body, which is what makes
 * this ladder meaningful: inside the sidebar the tree competes with bb's own
 * sticky stack (its project and label tiers sit at 50 and above), and no
 * hand-rolled `absolute` layer can out-rank that reliably. A portal puts these
 * surfaces in the root stacking context instead, where a plain z-index decides.
 *
 * So the order is fixed here rather than guessed per call site:
 *
 *   menu / hover card   50  - a menu opens above the tree it belongs to
 *   dialog              60  - a modal covers an open menu behind it
 *   dialog submenu      70  - a second-level menu inside a dialog stays on top
 */
export const Z_MENU = "z-50";
export const Z_DIALOG = "z-[60]";
export const Z_DIALOG_SUBMENU = "z-[70]";

const MENU_SURFACE_CLASS =
  "min-w-44 overflow-hidden rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-lg";

export const MENU_CONTENT_CLASS = cn(Z_MENU, MENU_SURFACE_CLASS);

/**
 * A menu's own submenu. Radix portals it separately, so it needs a rung above
 * the menu it came from — the menu closes as soon as a submenu item is picked,
 * which is why sharing the dialog's rung is safe.
 */
export const MENU_SUBMENU_CLASS = cn(Z_DIALOG, MENU_SURFACE_CLASS);

/**
 * One menu row's own styling, shared by every surface that draws menu items.
 *
 * The dropdown and the right-click menu are different Radix primitives — an
 * item cannot be rendered by the other's root — so this is the seam where their
 * look is kept identical rather than a component they can both host.
 */
export const MENU_ITEM_CLASS = cn(
  "flex cursor-default select-none items-center gap-2 px-2 py-1 text-xs outline-none",
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
  icon?: Parameters<typeof Icon>[0]["name"];
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
  children,
}: {
  trigger: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  label: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactNode;
}) {
  const scope = usePortalScopeProps();
  const container = useOverlayPortalContainer();
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content
          {...scope}
          aria-label={label}
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={8}
          className={MENU_CONTENT_CLASS}
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
  icon?: Parameters<typeof Icon>[0]["name"];
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        MENU_ITEM_CLASS,
        destructive && "text-destructive",
      )}
    >
      <MenuItemBody icon={icon} label={label} destructive={destructive} />
    </DropdownMenu.Item>
  );
}

/** A row inside a "move to group" submenu: the current group is ticked. */
export function MenuCheckboxItem({
  label,
  checked,
  onSelect,
}: {
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.CheckboxItem
      checked={checked}
      onSelect={onSelect}
      className={cn(
        "flex cursor-default select-none items-center gap-2 px-2 py-1 text-xs outline-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
      )}
    >
      <Icon
        name="FolderTree"
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
  icon?: Parameters<typeof Icon>[0]["name"];
  /**
   * The current value, shown on the trigger. A submenu that reports its own
   * state means the menu does not have to be opened to read the tree's order.
   */
  hint?: string;
  children: React.ReactNode;
}) {
  const scope = usePortalScopeProps();
  const container = useOverlayPortalContainer();
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        className={MENU_SUBTRIGGER_CLASS}
      >
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
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.SubContent
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
    <DropdownMenu.RadioItem
      value={value}
      className={cn(
        "flex cursor-default select-none items-center gap-2 px-2 py-1 text-xs outline-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
      )}
    >
      <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
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
 *
 * `MenuItem`'s icon-and-label shape cannot carry a row that has to show a disc,
 * a title, the kind of thing it is *and* a status glyph. This keeps such a row a
 * real menu item — keyboard walk, highlight, `onSelect` — while the panel and
 * the row's own styling stay the shared ones. Without it a caller with a richer
 * row reaches for the primitive and re-draws the menu, which is how a sidebar
 * ends up with two.
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
