import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FeaturePreset } from "@/lib/domain/feature-presets";

/**
 * Toolbar strip for applying, saving, and deleting multi-repo feature presets.
 */
export function FeatureCreatePresetBar({
  presets,
  busy,
  hasRepositories,
  savingPreset,
  presetName,
  onToggleImport,
  onToggleSave,
  onPresetNameChange,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
}: {
  readonly presets: readonly FeaturePreset[];
  readonly busy: boolean;
  readonly hasRepositories: boolean;
  readonly savingPreset: boolean;
  readonly presetName: string;
  readonly onToggleImport: () => void;
  readonly onToggleSave: () => void;
  readonly onPresetNameChange: (value: string) => void;
  readonly onApplyPreset: (preset: FeaturePreset) => void;
  readonly onSavePreset: () => void;
  readonly onDeletePreset: (presetId: string) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-2xs font-medium text-muted-foreground">
          Templates &amp; Workspaces
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-2xs"
            disabled={busy}
            onClick={onToggleImport}
          >
            Import .code-workspace
          </Button>
          {hasRepositories ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-2xs"
              disabled={busy}
              onClick={onToggleSave}
            >
              Save preset
            </Button>
          ) : null}
        </div>
      </div>
      {presets.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="inline-flex items-center rounded border border-border bg-background/60 text-2xs"
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => onApplyPreset(preset)}
                className="px-2 py-0.5 text-foreground hover:bg-accent/50"
                title={`Apply preset (${preset.repos.length} repos)`}
              >
                {preset.name}
              </button>
              <button
                type="button"
                aria-label={`Delete preset ${preset.name}`}
                disabled={busy}
                onClick={() => onDeletePreset(preset.id)}
                className="px-1 py-0.5 text-muted-foreground hover:text-destructive"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {savingPreset ? (
        <div className="flex items-center gap-1.5">
          <Input
            value={presetName}
            maxLength={60}
            placeholder="Preset name (e.g. Commerce Stack)"
            disabled={busy}
            onChange={(e) => onPresetNameChange(e.currentTarget.value)}
            className="h-6 flex-1 text-2xs"
          />
          <Button
            type="button"
            size="sm"
            className="h-6 px-2 text-2xs"
            disabled={busy || presetName.trim().length === 0}
            onClick={onSavePreset}
          >
            Save
          </Button>
        </div>
      ) : null}
    </>
  );
}
