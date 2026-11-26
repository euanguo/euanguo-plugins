import { NestMigrationCard } from "@/components/settings/nest-migration-card";
import {
  ProjectsPanel,
  type ProjectsPanelProps,
} from "@/components/settings/projects-panel";
import {
  ThreadListPanel,
  type ThreadListPanelProps,
} from "@/components/settings/thread-list-panel";

export interface SidebarLayoutPanelProps
  extends ThreadListPanelProps,
    ProjectsPanelProps {}

export function SidebarLayoutPanel({
  values,
  preferences,
  setAppearance,
  projects,
  overrides,
  isLoadingColors,
  setProjectColor,
  resetProjectColor,
  onResetAllAppearance,
}: SidebarLayoutPanelProps) {
  return (
    <div className="space-y-8">
      <ThreadListPanel
        values={values}
        preferences={preferences}
        setAppearance={setAppearance}
      />
      <div className="border-t border-border/60 pt-6">
        <ProjectsPanel
          values={values}
          setAppearance={setAppearance}
          projects={projects}
          overrides={overrides}
          isLoadingColors={isLoadingColors}
          setProjectColor={setProjectColor}
          resetProjectColor={resetProjectColor}
          onResetAllAppearance={onResetAllAppearance}
        />
      </div>
      <div className="border-t border-border/60 pt-6">
        <NestMigrationCard />
      </div>
    </div>
  );
}
