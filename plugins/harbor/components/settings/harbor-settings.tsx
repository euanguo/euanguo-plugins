import { experimental_useSidebarThreads as useSidebarThreads } from "@get-bb/plugin-sdk/app";
import {
  harborPreferenceStyle,
} from "@/lib/domain/preferences";
import { useState, type CSSProperties } from "react";
import { useAppearance } from "@/hooks/use-appearance";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { useProjectColors } from "@/hooks/use-project-colors";
import { RepoFactsPanel } from "@/components/settings/repo-facts-panel";
import { ThreadListPanel } from "@/components/settings/thread-list-panel";
import { PalettePanel } from "@/components/settings/palette-panel";
import { ProjectsPanel } from "@/components/settings/projects-panel";

type TabId = "threads" | "palette" | "projects" | "diagnostics";

const TAB_IDS: readonly TabId[] = ["threads", "palette", "projects", "diagnostics"];

/**
 * Harbor's settings, in tabs.
 *
 * Tabs are only worth having once the page is the plugin's to lay out, and that
 * only became true when the appearance settings moved out of `bb.settings`: the
 * host draws one form row per descriptor above this section and the plugin
 * cannot group, reorder or collapse them, so a tab strip there would have
 * governed a fraction of a page whose top the user still had to scroll. What is
 * left in the host form now is the five agent switches — a coherent block that
 * reads as its own thing.
 *
 * The four panels are ordered by what a user comes here to change: how the list
 * reads, the colours on it, project identity, then what the machines reported.
 */
export function HarborSettingsSection() {
  const { values, preferences, set } = useAppearance();
  const { projects } = useSidebarThreads();
  const projectColors = useProjectColors();
  const [tab, setTab] = useState<TabId>(() => readTab());

  const selectTab = (next: TabId) => {
    setTab(next);
    writeTab(next);
  };

  return (
    <section
      data-harbor-settings-preview=""
      style={harborPreferenceStyle(preferences) as CSSProperties}
      // The card, the fill and the 12px inset are bb's own settings block:
      // `rounded-md border border-border bg-surface-recessed/70 px-3 py-3`.
      className="max-w-[760px] rounded-md border border-border bg-surface-recessed/70 px-3 py-3"
    >
      <SettingsTabs
        active={tab}
        onSelect={selectTab}
        tabs={[
          {
            id: "threads",
            label: "Thread list",
            content: (
              <ThreadListPanel
                preferences={preferences}
                values={values}
                set={set}
              />
            ),
          },
          {
            id: "palette",
            label: "Palette",
            content: (
              <PalettePanel
                values={values}
                preset={preferences.palettePreset}
                set={set}
              />
            ),
          },
          {
            id: "projects",
            label: "Projects",
            // Only when there is a number worth reading: a bare "0" beside a
            // tab label is a badge that says nothing.
            hint:
              projectColors.overrides.size > 0
                ? String(projectColors.overrides.size)
                : undefined,
            content: (
              <ProjectsPanel
                projects={projects}
                projectColors={projectColors}
                values={values}
                set={set}
              />
            ),
          },
          {
            id: "diagnostics",
            label: "Diagnostics",
            content: <RepoFactsPanel />,
          },
        ]}
      />
    </section>
  );
}

/** Which tab was open last. A settings page that forgets is a settings page you re-learn. */
const TAB_STORAGE_KEY = "bb.harbor.settings.tab";

function readTab(): TabId {
  if (typeof window === "undefined") return "threads";
  try {
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    return TAB_IDS.includes(stored as TabId) ? (stored as TabId) : "threads";
  } catch {
    return "threads";
  }
}

function writeTab(tab: TabId): void {
  try {
    window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // A full or blocked store costs the memory of one choice, not the page.
  }
}
