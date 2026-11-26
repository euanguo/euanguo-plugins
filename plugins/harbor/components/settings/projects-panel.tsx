import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeSwatch } from "@/components/ui/badge-swatch";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import type { SettingsSetter } from "@/components/ui/settings-row";
import type { AppearanceValues } from "@/lib/domain/appearance";
import { PALETTE_PREVIEW_ROLES } from "@/lib/domain/color-roles";
import { errorMessage } from "@/lib/domain/errors";
import {
  PALETTE_PRESET_OPTIONS,
  type PalettePreset,
  resolvePalette,
} from "@/lib/domain/preferences";
import {
  automaticProjectColor,
  projectBadgeLetter,
} from "@/lib/domain/project-colors";
import { cn } from "@/lib/ui/utils";

export interface ProjectsPanelProps {
  values: AppearanceValues;
  setAppearance: SettingsSetter;
  projects: readonly { id: string; name: string }[];
  overrides: ReadonlyMap<string, string>;
  isLoadingColors: boolean;
  setProjectColor: (projectId: string, color: string) => Promise<string>;
  resetProjectColor: (projectId: string) => Promise<void>;
  onResetAllAppearance: () => Promise<void>;
}

const PRESET_DESCRIPTIONS: Record<PalettePreset, string> = {
  Default: "Balanced tones aligned with your host theme.",
  "High contrast": "Stronger saturation and separation across status states.",
  "Colorblind-friendly":
    "Okabe-Ito palette tuned to avoid red-green ambiguity.",
};

const COLOR_DEBOUNCE_MS = 250;

export function ProjectsPanel({
  values,
  setAppearance,
  projects,
  overrides,
  isLoadingColors,
  setProjectColor,
  resetProjectColor,
  onResetAllAppearance,
}: ProjectsPanelProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const [pendingColors, setPendingColors] = useState<Record<string, string>>(
    {},
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);
  const [resetAllError, setResetAllError] = useState<string | null>(null);

  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const handle of timers.values()) {
        clearTimeout(handle);
      }
      timers.clear();
    };
  }, []);

  const clearPendingTimer = (projectId: string) => {
    const existing = timersRef.current.get(projectId);
    if (existing !== undefined) {
      clearTimeout(existing);
      timersRef.current.delete(projectId);
    }
  };

  const handleColorPick = (projectId: string, color: string) => {
    setPendingColors((prev) => ({ ...prev, [projectId]: color }));
    setRowErrors((prev) => {
      if (!(projectId in prev)) return prev;
      const next = { ...prev };
      delete next[projectId];
      return next;
    });

    clearPendingTimer(projectId);
    const timer = setTimeout(() => {
      timersRef.current.delete(projectId);
      setSavingId(projectId);
      void setProjectColor(projectId, color)
        .then(() => {
          setPendingColors((prev) => {
            if (!(projectId in prev)) return prev;
            const next = { ...prev };
            delete next[projectId];
            return next;
          });
        })
        .catch((err) => {
          setPendingColors((prev) => {
            if (!(projectId in prev)) return prev;
            const next = { ...prev };
            delete next[projectId];
            return next;
          });
          setRowErrors((prev) => ({
            ...prev,
            [projectId]: errorMessage(err, "Failed to update project color"),
          }));
        })
        .finally(() => {
          setSavingId((current) => (current === projectId ? null : current));
        });
    }, COLOR_DEBOUNCE_MS);
    timersRef.current.set(projectId, timer);
  };

  const handleResetProject = (projectId: string) => {
    clearPendingTimer(projectId);
    setPendingColors((prev) => {
      if (!(projectId in prev)) return prev;
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
    setSavingId(projectId);
    setRowErrors((prev) => {
      if (!(projectId in prev)) return prev;
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
    void resetProjectColor(projectId)
      .catch((err) => {
        setRowErrors((prev) => ({
          ...prev,
          [projectId]: errorMessage(err, "Failed to reset project color"),
        }));
      })
      .finally(() => {
        setSavingId((current) => (current === projectId ? null : current));
      });
  };

  const filteredProjects = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) =>
      project.name.toLowerCase().includes(query),
    );
  }, [projects, filterQuery]);

  const handleResetAllConfirm = async () => {
    setResettingAll(true);
    setResetAllError(null);
    try {
      await onResetAllAppearance();
      setConfirmResetAll(false);
    } catch (err) {
      setResetAllError(errorMessage(err, "Failed to reset appearance"));
    } finally {
      setResettingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2.5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Status Palette
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose a curated status color preset for thread indicators and PR
            states.
          </p>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-3">
          {PALETTE_PRESET_OPTIONS.map((preset) => {
            const active = values.palettePreset === preset;
            const palette = resolvePalette(preset);
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  if (!active) setAppearance({ palettePreset: preset });
                }}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border/70 bg-background/60 hover:border-border hover:bg-muted/30",
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">
                    {preset}
                  </span>
                  {active ? (
                    <Pill variant="emphasis" size="sm">
                      Active
                    </Pill>
                  ) : null}
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {PRESET_DESCRIPTIONS[preset]}
                </p>
                <div
                  aria-hidden="true"
                  className="mt-auto flex items-center gap-1.5 pt-1"
                >
                  {PALETTE_PREVIEW_ROLES.map((item) => (
                    <span
                      key={item.role}
                      title={item.label}
                      className="size-3 rounded-full ring-1 ring-black/10 dark:ring-white/15"
                      style={{ backgroundColor: palette[item.role] }}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Project Badge Colors
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pick a swatch color to save automatically across your sidebar.
            </p>
          </div>
          {isLoadingColors ? (
            <span className="text-[11px] text-muted-foreground">Loading...</span>
          ) : null}
        </div>

        {projects.length > 8 ? (
          <Input
            type="search"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="Filter projects..."
            aria-label="Filter projects"
            className="h-8 text-xs"
          />
        ) : null}

        {filteredProjects.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
            {projects.length === 0
              ? "No projects registered in this sidebar yet."
              : "No projects match that filter."}
          </p>
        ) : (
          <div className="divide-y divide-border/40 rounded-lg border border-border/60">
            {filteredProjects.map((project) => {
              const savedOverride = overrides.get(project.id);
              const pending = pendingColors[project.id];
              const effectiveColor =
                pending ?? savedOverride ?? automaticProjectColor(project.id);
              const isCustomized =
                pending !== undefined || savedOverride !== undefined;
              const isSaving = savingId === project.id;
              const rowError = rowErrors[project.id];

              return (
                <div
                  key={project.id}
                  className="flex flex-col gap-1.5 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <BadgeSwatch
                        backgroundColor={effectiveColor}
                        className="size-6 shrink-0 text-[11px]"
                      >
                        {projectBadgeLetter(project.name)}
                      </BadgeSwatch>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-foreground">
                          {project.name}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {effectiveColor} ·{" "}
                          {isSaving
                            ? "Saving..."
                            : isCustomized
                              ? "Custom"
                              : "Automatic"}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <input
                        type="color"
                        value={effectiveColor}
                        aria-label={`Badge color for ${project.name}`}
                        onChange={(event) =>
                          handleColorPick(project.id, event.target.value)
                        }
                        className="size-7 cursor-pointer rounded border border-border/70 bg-transparent p-0.5"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!isCustomized || isSaving}
                        onClick={() => handleResetProject(project.id)}
                        className="h-7 px-2 text-xs"
                      >
                        <Icon name="ArchiveRestore" className="mr-1 size-3" aria-hidden />
                        Reset
                      </Button>
                    </div>
                  </div>
                  {rowError !== undefined ? (
                    <p
                      role="alert"
                      className="text-[11px] text-destructive"
                    >
                      {rowError}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-foreground">
              Reset appearance to defaults
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Restores sidebar layout, palette preset, and feature template
              settings. Custom project badge colors are preserved.
            </p>
          </div>
          {confirmResetAll ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={resettingAll}
                onClick={() => {
                  setConfirmResetAll(false);
                  setResetAllError(null);
                }}
                className="h-7 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={resettingAll}
                onClick={() => void handleResetAllConfirm()}
                className="h-7 text-xs"
              >
                {resettingAll ? "Resetting..." : "Confirm reset"}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConfirmResetAll(true)}
              className="h-7 text-xs"
            >
              Reset defaults
            </Button>
          )}
        </div>
        {resetAllError !== null ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {resetAllError}
          </p>
        ) : null}
      </section>
    </div>
  );
}
