import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  COLOR_GROUP_LABELS,
  COLOR_GROUPS,
  COLOR_SETTING_KEYS,
  SEMANTIC_COLOR_ROLE_DEFINITIONS,
  type ColorGroup,
} from "@/lib/color-roles";
import {
  CUSTOM_COLOR_DEFAULTS,
  type SemanticColorRole,
} from "@/lib/preferences";
import type { AppearanceKey, AppearanceValues } from "@/lib/appearance";

const HEX = /^#[0-9A-F]{6}$/i;

/** The setting key a role is stored under. */
const keyOf = (role: SemanticColorRole) =>
  COLOR_SETTING_KEYS[role] as AppearanceKey;

/**
 * The palette: the eighteen semantic colours, each drawn as the thing it
 * colours and changeable on the spot.
 *
 * It reads the **stored** value, not the resolved one. Those differ whenever
 * the preset is not Custom: a resolved colour is then a theme token
 * (`var(--primary, …)`), while what is stored is the literal hex that Custom
 * would use. Showing the stored value is what makes the editor honest — you see
 * what you set, and a note says whether the preset is currently overriding it.
 *
 * That also removes a whole class of bug: an `<input type="color">` silently
 * ignores a token, so a picker fed the resolved value opened on black.
 */
export function PaletteEditor({
  values,
  preset,
  disabled,
  onChange,
}: {
  values: AppearanceValues;
  /** The preset in effect. Only Custom reads the eighteen colours. */
  preset: string;
  disabled?: boolean;
  onChange: (patch: Partial<Record<AppearanceKey, string>>) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const resetGroup = (group: ColorGroup) => {
    const patch: Record<string, string> = {};
    for (const { role } of SEMANTIC_COLOR_ROLE_DEFINITIONS) {
      if (groupFor(role) !== group) continue;
      patch[keyOf(role as SemanticColorRole)] = CUSTOM_COLOR_DEFAULTS[
        role as SemanticColorRole
      ].toUpperCase();
    }
    onChange(patch as Partial<Record<AppearanceKey, string>>);
  };

  return (
    <div className="space-y-2">
      {preset === "Custom" ? null : (
        <p className="rounded border border-border/80 px-2 py-1.5 text-2xs leading-relaxed text-muted-foreground">
          The preset <span className="font-medium text-foreground">{preset}</span>{" "}
          is in effect, so these colours are not drawn. Changing one switches the
          preset to <span className="font-medium text-foreground">Custom</span>.
        </p>
      )}

      {error === null ? null : (
        <p id={errorId} className="text-2xs text-destructive">
          {error}
        </p>
      )}

      {COLOR_GROUPS.map((group) => {
        const roles = SEMANTIC_COLOR_ROLE_DEFINITIONS.filter(
          (definition) => definition.group === group,
        );
        return (
          <div key={group} data-nest-color-group={group} className="space-y-1 pt-3 first:pt-0">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                {COLOR_GROUP_LABELS[group]}
              </p>
              <Button variant="link"
                className="text-2xs text-muted-foreground hover:text-foreground"
                disabled={disabled}
                onClick={() => resetGroup(group)}
              >
                Reset
              </Button>
            </div>
            <ul className="grid grid-cols-2 gap-1">
              {roles.map(({ role, label }) => (
                <li key={role}>
                  <ColorSwatchField
                    role={role as SemanticColorRole}
                    label={label}
                    value={
                      values[keyOf(role as SemanticColorRole)] as string
                    }
                    busy={disabled === true}
                    onChange={(next) => {
                      if (!HEX.test(next)) {
                        setError("A colour must be six hex digits, like #3B82F6.");
                        return;
                      }
                      setError(null);
                      onChange({ [keyOf(role as SemanticColorRole)]: next.toUpperCase() });
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function groupFor(role: string): ColorGroup | null {
  return (
    SEMANTIC_COLOR_ROLE_DEFINITIONS.find((entry) => entry.role === role)?.group ??
    null
  );
}

/**
 * One colour: a swatch you can click, and the hex it currently holds.
 *
 * The `<input type="color">` is stretched over the swatch and left transparent,
 * so the native picker opens from anywhere on it while the drawing stays the
 * plugin's. The hex is a real field for anyone who has the value already, and
 * is the only way to type one.
 */
function ColorSwatchField({
  role,
  label,
  value,
  busy,
  onChange,
}: {
  role: SemanticColorRole;
  label: string;
  /** The stored literal hex. Always a hex, because that is what is written. */
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const hex = HEX.test(value) ? value.toUpperCase() : CUSTOM_COLOR_DEFAULTS[role];
  const shown = typed ?? hex;

  return (
    <div
      data-nest-color-role={role}
      className={cn(
        "flex items-center gap-1.5 rounded border border-border/80 px-1.5 py-1",
        busy && "opacity-60",
      )}
    >
      <label className="relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded border border-black/25 focus-within:ring-1 focus-within:ring-ring">
        <span className="sr-only">{label} colour</span>
        <span
          aria-hidden
          className="absolute inset-0 rounded"
          style={{ backgroundColor: hex }}
        />
        <input
          type="color"
          value={hex}
          disabled={busy}
          aria-label={`${label} colour`}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-wait"
        />
      </label>
      <span className="min-w-0 flex-1 truncate text-2xs text-foreground/85">
        {label}
      </span>
      <input
        value={shown}
        disabled={busy}
        aria-label={`${label} hex`}
        maxLength={7}
        spellCheck={false}
        onChange={(event) => setTyped(event.currentTarget.value.toUpperCase())}
        onBlur={() => {
          if (typed !== null && typed !== hex) onChange(typed);
          setTyped(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setTyped(null);
            event.currentTarget.blur();
          }
        }}
        className={cn(
          "w-14 shrink-0 rounded border border-transparent bg-transparent px-0.5 text-right font-mono text-[10px] uppercase",
          "text-muted-foreground hover:border-input focus-visible:border-input focus-visible:text-foreground focus-visible:outline-none",
        )}
      />
    </div>
  );
}
