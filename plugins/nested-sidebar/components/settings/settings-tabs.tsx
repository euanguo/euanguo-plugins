import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface SettingsTab<Id extends string> {
  readonly id: Id;
  readonly label: string;
  /** A short count or state shown beside the label, or nothing. */
  readonly hint?: string;
  readonly content: ReactNode;
}

/**
 * Nest's settings tabs, on the registry's `Tabs`.
 *
 * The registry's component is Radix's, so roving focus, arrow-key movement and
 * the `aria-controls`/`aria-labelledby` pair come with it rather than being
 * re-implemented here. The sizing is the plugin's: a settings page is a dense
 * column, so the trigger is one step down from the registry's default.
 *
 * Below `sm` the strip becomes a select. A settings page is one column of
 * content, and three labels squeezed into a rail are worse than one control
 * that names every section.
 *
 * Every panel stays mounted and only the selected one is shown, because two of
 * them read from the server: switching tabs must not re-run those reads.
 */
export function SettingsTabs<Id extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: readonly SettingsTab<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
}) {
  return (
    <Tabs
      value={active}
      onValueChange={(next) => onSelect(next as Id)}
      data-nest-settings-tabs=""
    >
      <TabsList className="h-7 gap-0.5 bg-transparent p-0 max-sm:hidden">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            className={cn(
              "h-7 gap-1 rounded-md px-2 text-2xs font-medium",
              "text-muted-foreground hover:bg-state-hover hover:text-foreground",
              "data-[state=active]:bg-state-active data-[state=active]:text-foreground",
            )}
          >
            {tab.label}
            {tab.hint === undefined ? null : (
              <span className="tabular-nums text-muted-foreground/70">
                {tab.hint}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>

      <label className="grid gap-1 pt-2 sm:hidden">
        <span className="text-2xs text-muted-foreground">Section</span>
        <select
          value={active}
          onChange={(event) => onSelect(event.currentTarget.value as Id)}
          className="h-7 rounded-md border border-input bg-transparent px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}
            </option>
          ))}
        </select>
      </label>

      <div className="pt-3">
        {tabs.map((tab) => (
          <TabsContent
            key={tab.id}
            value={tab.id}
            data-nest-settings-panel={tab.id}
            className="m-0 focus-visible:outline-none"
          >
            {tab.content}
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}
