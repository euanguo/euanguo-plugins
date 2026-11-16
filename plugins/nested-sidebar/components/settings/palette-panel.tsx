import { PaletteEditor } from "@/components/settings/palette-editor";
import { SettingsChoice } from "@/components/ui/settings-row";
import type { AppearanceValues } from "@/lib/domain/appearance";
import { PALETTE_PRESET_OPTIONS } from "@/lib/domain/preferences";
import type { SettingsSetter } from "@/components/ui/settings-row";

export function PalettePanel({
  values,
  preset,
  set,
}: {
  values: AppearanceValues;
  preset: string;
  set: SettingsSetter;
}) {
  return (
    <div className="space-y-4">
      <SettingsChoice
        label="Preset"
        hint="Custom is the only preset that reads the colours below."
        value={values.palettePreset as string}
        options={PALETTE_PRESET_OPTIONS}
        onChange={(value) => set({ palettePreset: value })}
      />
      <div className="border-t border-border/80 pt-3">
        <PaletteEditor
          values={values}
          preset={preset}
          // Choosing a colour is a request to see it, so the preset follows.
          // Storing one while a preset overrides it reads as a broken control.
          onChange={(patch) => set({ ...patch, palettePreset: "Custom" })}
        />
      </div>
    </div>
  );
}
