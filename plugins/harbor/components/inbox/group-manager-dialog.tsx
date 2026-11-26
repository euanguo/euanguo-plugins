import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { harborRpcContract } from "@/server/contract";
import { DialogError } from "@/components/ui/control";
import { GroupIcon } from "@/components/ui/group-icon";
import { Icon } from "@bb-ui/icon";
import { cn } from "@/lib/ui/utils";
import { Modal } from "@/components/ui/modal";
import { Input } from "@bb-ui/input";
import { Button } from "@bb-ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DEFAULT_GROUP_ICON,
  GROUP_ICON_LABELS,
  GROUP_ICON_OPTIONS,
  type GroupIconName,
} from "@/lib/domain/group-icons";
import type { ProjectGroup } from "@/lib/domain/groups";
import { useDialogTask } from "@/hooks/use-dialog-task";

/** Create, rename, reorder, delete, and visually choose project group icons. */
export function GroupManagerDialog({
  open,
  groups,
  onClose,
}: {
  open: boolean;
  groups: readonly ProjectGroup[];
  onClose: () => void;
}) {
  const rpc = useRpc<typeof harborRpcContract>();
  const [draftName, setDraftName] = useState("");
  const [draftIcon, setDraftIcon] = useState<GroupIconName>(DEFAULT_GROUP_ICON);
  const [iconOverrides, setIconOverrides] = useState<Record<string, GroupIconName>>({});
  const task = useDialogTask<unknown>();
  const busy = task.busy;
  const error = task.error;

  useEffect(() => {
    if (!open) return;
    setDraftName("");
    setDraftIcon(DEFAULT_GROUP_ICON);
    task.reset();
  }, [open]);

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

  const run = (action: () => Promise<unknown>) => task.run(action, "That did not work.");

  const create = () =>
    run(async () => {
      const name = draftName.trim();
      if (name.length === 0) return;
      await rpc.call("createGroup", { name, icon: draftIcon });
      setDraftName("");
      setDraftIcon(DEFAULT_GROUP_ICON);
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
      icon="Layers"
      busy={busy}
      width="34rem"
      footer={
        <form
          className="flex min-w-0 items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void create();
          }}
        >
          <IconPicker
            value={draftIcon}
            disabled={busy}
            label="New group icon"
            onChange={setDraftIcon}
          />
          <Input
            className="flex-1"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="New group name"
            aria-label="New group name"
            maxLength={60}
          />
          <Button
            size="sm"
            type="submit"
            variant="default"
            disabled={busy || draftName.trim().length === 0}
          >
            Add
          </Button>
        </form>
      }
    >
      <div className="flex flex-col gap-2">
        {error === null ? null : (
          <DialogError className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1">
            {error}
          </DialogError>
        )}

        <ul className="flex flex-col gap-0.5">
          {groups.length === 0 ? (
            <li className="px-1 py-2 text-2xs text-muted-foreground">
              No groups yet.
            </li>
          ) : (
            groups.map((group, index, all) => {
              const icon = iconOverrides[group.id] ?? group.icon;
              return (
                <li
                  key={group.id}
                  className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-accent/60"
                >
                  <IconPicker
                    value={icon}
                    disabled={busy}
                    label={`Icon for ${group.name}`}
                    onChange={(nextIcon) => changeIcon(group, nextIcon)}
                  />
                  <GroupNameEditor
                    group={group}
                    disabled={busy}
                    onRename={(name) =>
                      run(() => rpc.call("renameGroup", { groupId: group.id, name }))
                    }
                  />
                  {(
                    [
                      {
                        label: `Move ${group.name} up`,
                        icon: "ChevronUp",
                        disabled: busy || index === 0,
                        className:
                          "border border-border/70 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                        onClick: () => move(group.id, -1),
                      },
                      {
                        label: `Move ${group.name} down`,
                        icon: "ChevronDown",
                        disabled: busy || index === all.length - 1,
                        className:
                          "border border-border/70 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                        onClick: () => move(group.id, 1),
                      },
                      {
                        label: `Delete group ${group.name}`,
                        title: "Delete group (releases its projects)",
                        icon: "Trash2",
                        disabled: busy,
                        className: "text-destructive hover:bg-destructive/10",
                        onClick: () =>
                          void run(() => rpc.call("deleteGroup", { groupId: group.id })),
                      },
                    ] as const
                  ).map((btn) => (
                    <button
                      key={btn.label}
                      type="button"
                      data-bb-icon-button=""
                      aria-label={btn.label}
                      title={"title" in btn ? btn.title : undefined}
                      disabled={btn.disabled}
                      onClick={btn.onClick}
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
                        btn.className,
                      )}
                    >
                      <Icon name={btn.icon} className="size-3" aria-hidden />
                    </button>
                  ))}
                </li>
              );
            })
          )}
        </ul>
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          aria-label={label}
          disabled={disabled}
          variant="outline"
          className="h-8 min-w-12 justify-between gap-1 px-2 text-2xs"
        >
          <GroupIcon name={value} className="size-3.5 text-foreground/80" ariaHidden />
          <Icon name="ChevronDown" className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        collisionPadding={8}
        aria-label={`${label} picker`}
        className="w-[min(15.5rem,calc(100vw-3rem))] overflow-hidden rounded-lg border-border bg-popover p-2 text-popover-foreground shadow-lg"
      >
        <div className="grid grid-cols-6 gap-1">
          {GROUP_ICON_OPTIONS.map((icon) => {
            const optionLabel = GROUP_ICON_LABELS[icon];
            return (
              <button
                key={icon}
                type="button"
                aria-label={optionLabel}
                title={optionLabel}
                aria-pressed={value === icon}
                onClick={() => {
                  onChange(icon);
                  setOpen(false);
                }}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  value === icon
                    ? "border-primary bg-primary/10 text-foreground hover:bg-primary/15"
                    : "hover:bg-accent hover:text-foreground",
                )}
              >
                <GroupIcon name={icon} className="size-4 text-current" ariaHidden />
              </button>
            );
          })}
        </div>
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
    <Input
      className="h-7 flex-1 text-xs"
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
      aria-label={`Rename ${group.name}`}
      maxLength={60}
    />
  );
}
