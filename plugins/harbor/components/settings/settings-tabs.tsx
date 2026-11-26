import type { ReactNode } from "react";
import { Pill } from "@bb-ui/pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bb-ui/tabs";
import { cn } from "@/lib/ui/utils";

export type SettingsTabId = "sidebar" | "agent-features" | "diagnostics";

export interface SettingsSectionTab {
  readonly id: SettingsTabId;
  readonly label: string;
  readonly badgeCount?: number;
  readonly content: ReactNode;
}

export interface SettingsTabsProps {
  activeTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  sections: readonly SettingsSectionTab[];
}

export function SettingsTabs({
  activeTab,
  onTabChange,
  sections,
}: SettingsTabsProps) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(next) => onTabChange(next as SettingsTabId)}
      className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6"
    >
      <TabsList
        aria-label="Harbor settings sections"
        className={cn(
          "grid h-auto w-full grid-cols-3 gap-1 p-1",
          "sm:flex sm:w-[152px] sm:shrink-0 sm:flex-col sm:items-stretch sm:justify-start sm:bg-transparent sm:p-0",
        )}
      >
        {sections.map((section) => (
          <TabsTrigger
            key={section.id}
            value={section.id}
            className={cn(
              "justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium",
              "sm:justify-between sm:rounded-md sm:px-2.5 sm:py-2 sm:text-left",
              "sm:data-[state=active]:bg-muted sm:data-[state=active]:text-foreground sm:data-[state=active]:shadow-none",
            )}
          >
            <span className="truncate">{section.label}</span>
            {section.badgeCount !== undefined && section.badgeCount > 0 ? (
              <Pill variant="outline" size="sm" className="shrink-0">
                {section.badgeCount}
              </Pill>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="min-w-0 flex-1">
        {sections.map((section) => (
          <TabsContent
            key={section.id}
            value={section.id}
            forceMount
            className="mt-0 focus-visible:outline-none data-[state=inactive]:hidden"
          >
            {section.content}
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}
