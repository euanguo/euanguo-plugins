import { useEffect, useMemo, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { nestRpcContract } from "@/server";
import { GroupIcon } from "@/components/ui/group-icon";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  GROUP_ICON_OPTIONS,
  groupIconLabel,
  type GroupIconName,
  type ProjectGroup,
} from "@/lib/groups";
import {
  SCOPE_ICON_SCOPES,
  type ScopeIconScope,
  type ScopeIcons,
} from "@/lib/group-scope-icons";

const INITIAL_ICON_LIMIT = 240;

/** What each of the strip's own tabs is called, for the picker's label. */
const SCOPE_ICON_LABELS: Readonly<Record<ScopeIconScope, string>> = {
  all: "All",
  ungrouped: "Ungrouped",
};

/** Create, rename, reorder, delete, and visually choose project group icons. */
export function GroupManagerDialog({
  open,
  groups,
  icons,
  onClose,
}: {
  open: boolean;
  groups: readonly ProjectGroup[];
  icons: ScopeIcons;
  onClose: () => void;
}) {
  const rpc = useRpc<typeof nestRpcContract>();
  const [draftName, setDraftName] = useState("");
  const [draftIcon, setDraftIcon] = useState<GroupIconName>("LayerIcon");
  const [iconOverrides, setIconOverrides] = useState<Record<string, GroupIconName>>({});
  const [scopeOverrides, setScopeOverrides] = useState<
    Partial<Record<ScopeIconScope, GroupIconName>>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIconOverrides((current) => {
      const next: Record<string, GroupIconName> = {};
      for (const group of groups) {
        const override = current[group.id];
        if (override !== undefined && override !== group.icon) {
          next[group.id] = override;
        }
      }
      return next;
    });
  }, [groups]);

  useEffect(() => {
    setScopeOverrides((current) => {
      const next: Partial<Record<ScopeIconScope, GroupIconName>> = {};
      for (const scope of SCOPE_ICON_SCOPES) {
        const override = current[scope];
        if (override !== undefined && override !== icons[scope]) {
          next[scope] = override;
        }
      }
      return next;
    });
  }, [icons]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const name = draftName.trim();
      if (name.length === 0) return;
      await rpc.call("createGroup", { name, icon: draftIcon });
      setDraftName("");
      setDraftIcon("LayerIcon");
    });

  const changeIcon = (group: ProjectGroup, icon: GroupIconName) => {
    setIconOverrides((current) => ({ ...current, [group.id]: icon }));
    void run(async () => {
      try {
        await rpc.call("renameGroup", { groupId: group.id, name: group.name, icon });
      } catch (caught) {
        setIconOverrides((current) => {
          const next = { ...current };
          delete next[group.id];
          return next;
        });
        throw caught;
      }
    });
  };

  /**
   * The strip's own two tabs are not groups, so their icon is the only thing
   * about them that can be chosen. The optimistic override is dropped again if
   * the write fails, exactly as a group's is, so the picker never claims an
   * icon the store did not take.
   */
  const changeScopeIcon = (scope: ScopeIconScope, icon: GroupIconName) => {
    setScopeOverrides((current) => ({ ...current, [scope]: icon }));
    void run(async () => {
      try {
        await rpc.call("setScopeIcon", { scope, icon });
      } catch (caught) {
        setScopeOverrides((current) => {
          const next = { ...current };
          delete next[scope];
          return next;
        });
        throw caught;
      }
    });
  };

  const move = (groupId: string, delta: -1 | 1) => {
    const ids = groups.map((group) => group.id);
    const index = ids.indexOf(groupId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const next = [...ids];
    next.splice(index, 1);
    next.splice(target, 0, groupId);
    void run(() => rpc.call("reorderGroups", { groupIds: next }));
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Project groups"
      icon="FolderTree"
      busy={busy}
      width="38rem"
    >
      <div className="flex flex-col gap-3">
        <p className="text-2xs leading-relaxed text-muted-foreground">
          Groups organize projects. Choose any free Hugeicons icon from the
          preview panel; changes are saved per group and do not affect projects.
        </p>

        <div className="flex flex-col gap-1 rounded-md border border-border/60 px-2 py-1.5">
          <span className="text-2xs text-muted-foreground">
            The strip's own tabs are not groups: they take an icon, no name, and
            can be neither reordered nor removed. An icon shows when the strip
            is too narrow to draw labels.
          </span>
          {SCOPE_ICON_SCOPES.map((scope) => (
            <div key={scope} className="flex items-center gap-1.5">
              <IconPicker
                value={scopeOverrides[scope] ?? icons[scope]}
                disabled={busy}
                label={SCOPE_ICON_LABELS[scope]}
                onChange={(icon) => changeScopeIcon(scope, icon)}
              />
              <span className="min-w-0 truncate text-xs text-foreground/80">
                {SCOPE_ICON_LABELS[scope]}
              </span>
            </div>
          ))}
        </div>

        {error === null ? null : (
          <p className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-2xs text-destructive">
            {error}
          </p>
        )}

        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {groups.length === 0 ? (
            <li className="px-1 py-2 text-2xs text-muted-foreground">No groups yet.</li>
          ) : (
            groups.map((group, index, all) => {
              const icon = iconOverrides[group.id] ?? group.icon;
              return (
                <li
                  key={group.id}
                  className="flex min-w-0 items-center gap-1 rounded-md px-1 py-1 hover:bg-accent/60"
                >
                  <IconPicker
                    value={icon}
                    disabled={busy}
                    label={"Icon for " + group.name}
                    onChange={(nextIcon) => changeIcon(group, nextIcon)}
                  />
                  <GroupNameEditor
                    group={group}
                    disabled={busy}
                    onRename={(name) =>
                      run(() => rpc.call("renameGroup", { groupId: group.id, name }))
                    }
                  />
                  <button
                    type="button"
                    aria-label={"Move " + group.name + " up"}
                    disabled={busy || index === 0}
                    onClick={() => move(group.id, -1)}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-30"
                  >
                    <Icon name="ChevronUp" className="size-3" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={"Move " + group.name + " down"}
                    disabled={busy || index === all.length - 1}
                    onClick={() => move(group.id, 1)}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-30"
                  >
                    <Icon name="ChevronDown" className="size-3" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={"Delete group " + group.name}
                    title="Delete group (releases its projects)"
                    disabled={busy}
                    onClick={() =>
                      void run(() => rpc.call("deleteGroup", { groupId: group.id }))
                    }
                    className="flex size-5 shrink-0 items-center justify-center rounded text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-30"
                  >
                    <Icon name="Trash" className="size-3" aria-hidden />
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <form
          className="flex min-w-0 items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="New group name"
            aria-label="New group name"
            maxLength={60}
            className={cn(
              "h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          />
          <IconPicker
            value={draftIcon}
            disabled={busy}
            label="New group icon"
            onChange={setDraftIcon}
          />
          <button
            type="submit"
            disabled={busy || draftName.trim().length === 0}
            className="h-7 shrink-0 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
          >
            Add
          </button>
        </form>
      </div>
    </Modal>
  );
}

function IconPicker({
  value,
  disabled,
  label,
  onChange,
}: {
  value: GroupIconName;
  disabled: boolean;
  label: string;
  onChange: (icon: GroupIconName) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(INITIAL_ICON_LIMIT);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      normalizedQuery.length === 0
        ? GROUP_ICON_OPTIONS
        : GROUP_ICON_OPTIONS.filter((icon) =>
            groupIconLabel(icon).toLowerCase().includes(normalizedQuery),
          ),
    [normalizedQuery],
  );
  const visible = filtered.slice(0, limit);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setLimit(INITIAL_ICON_LIMIT);
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          className="flex h-7 min-w-24 items-center gap-1 rounded-md border border-border bg-background px-1.5 text-2xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
        >
          <GroupIcon name={value} className="size-3.5 shrink-0" ariaHidden />
          <span className="min-w-0 flex-1 truncate text-left">{groupIconLabel(value)}</span>
          <Icon name="ChevronDown" className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        collisionPadding={8}
        aria-label={label + " picker"}
        mobileTitle={label + " picker"}
        className="z-[70] max-h-[min(70vh,28rem)] w-[min(28rem,calc(100vw-3rem))] overflow-hidden rounded-lg border-border bg-popover p-2 text-popover-foreground shadow-lg"
      >
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(INITIAL_ICON_LIMIT);
              }}
              placeholder="Search 6,025 icons"
              aria-label="Search icons"
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <span className="shrink-0 text-2xs text-muted-foreground">
              {filtered.length.toLocaleString()}
            </span>
          </div>
          <div className="mt-2 grid max-h-56 grid-cols-8 gap-1 overflow-y-auto">
            {visible.map((icon) => (
              <button
                key={icon}
                type="button"
                aria-label={groupIconLabel(icon)}
                title={groupIconLabel(icon)}
                aria-pressed={value === icon}
                onClick={() => {
                  onChange(icon);
                  setOpen(false);
                }}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  value === icon && "border-primary bg-primary/10 text-primary",
                )}
              >
                <GroupIcon name={icon} className="size-4" ariaHidden />
              </button>
            ))}
          </div>
          {visible.length < filtered.length ? (
            <button
              type="button"
              onClick={() => setLimit((current) => current + INITIAL_ICON_LIMIT)}
              className="mt-2 w-full rounded-md px-2 py-1 text-2xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              Show more ({(filtered.length - visible.length).toLocaleString()} remaining)
            </button>
          ) : null}
      </PopoverContent>
    </Popover>
  );
}

function GroupNameEditor({
  group,
  disabled,
  onRename,
}: {
  group: ProjectGroup;
  disabled: boolean;
  onRename: (name: string) => void;
}) {
  const [value, setValue] = useState(group.name);
  useEffect(() => setValue(group.name), [group.name]);
  return (
    <input
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        const name = value.trim();
        if (name.length > 0 && name !== group.name) onRename(name);
        else setValue(group.name);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setValue(group.name);
          event.currentTarget.blur();
        }
      }}
      disabled={disabled}
      aria-label={"Rename " + group.name}
      maxLength={60}
      className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-xs hover:border-border focus-visible:border-border focus-visible:outline-none disabled:opacity-60"
    />
  );
}
