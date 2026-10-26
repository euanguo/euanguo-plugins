import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const sourceRoot = process.argv[2] ?? process.env.BB_SOURCE;
if (sourceRoot === undefined) {
  console.error(
    "Usage: npm run audit:source -- /absolute/path/to/get-bb/bb",
  );
  process.exit(2);
}

const root = path.resolve(sourceRoot);
const checks = [
  {
    label: "theme tokens",
    file: "apps/app/src/components/ui/theme.css",
    needles: [
      "--surface-selected:",
      "--surface-selected-border:",
      "--surface-recessed-solid:",
      "--surface-recessed-soft-solid:",
      "--surface-raised-solid:",
      "--border-hairline:",
      "--border-seam:",
      "--sidebar-ring:",
      "--timeline-accent:",
    ],
  },
  {
    label: "portal scope",
    file: "packages/shared-ui/src/lib/portal-scope.ts",
    needles: ['"data-bb-portaled-overlay"', '"data-bb-plugin-root"'],
  },
  {
    label: "responsive overlay",
    file: "packages/shared-ui/src/components/ui/responsive-overlay.tsx",
    needles: [
      'data-persistent-drawer-content=""',
      'data-persistent-drawer-handle=""',
      'role="dialog"',
    ],
  },
  {
    label: "menu primitives",
    file: "packages/shared-ui/src/components/ui/dropdown-menu.tsx",
    needles: [
      "DropdownMenuPrimitive.Content",
      "MENU_ITEM_LAST_HOVERED_CLASS",
      "variant === \"destructive\"",
    ],
  },
  {
    label: "composer root",
    file: "plugins/composer/src/PromptBoxInternal.tsx",
    needles: [
      'data-promptbox=""',
      'data-promptbox-submit-action=""',
      'data-promptbox-submit-group=""',
    ],
  },
  {
    label: "composer typeahead",
    file: "plugins/composer/src/ComposerPopupHost.tsx",
    needles: ['data-promptbox-typeahead-menu=""'],
  },
  {
    label: "tab pill",
    file: "apps/app/src/components/ui/tab-pill.tsx",
    needles: ["data-tab-pill=\"\"", "data-tab-pill-close"],
  },
  {
    label: "command palette",
    file: "apps/app/src/components/commands/CommandPalette.tsx",
    needles: ['data-testid="command-palette"', "DialogContent"],
  },
  {
    label: "command palette bands",
    file: "apps/app/src/components/commands/PaletteInputBand.tsx",
    needles: ["data-palette-input-band"],
  },
  {
    label: "command palette results",
    file: "apps/app/src/components/commands/PaletteShell.tsx",
    needles: ["data-palette-results-clip", "data-palette-results-viewport"],
  },
  {
    label: "conversation scroll",
    file: "apps/app/src/components/ui/bottom-anchored-scroll-body.tsx",
    needles: ['data-page-scroll-viewport=""', '"thread-scrollbar'],
  },
  {
    label: "Markdown preview",
    file: "apps/app/src/components/secondary-panel/FilePreview.tsx",
    needles: ['"@container/page min-h-full"'],
  },
];

let commit = "unknown";
try {
  commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch (error) {
  console.error(`Cannot read git revision from ${root}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const failures = [];
for (const check of checks) {
  const filePath = path.join(root, check.file);
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    failures.push(`${check.label}: missing ${check.file}`);
    continue;
  }

  for (const needle of check.needles) {
    if (!text.includes(needle)) {
      failures.push(`${check.label}: ${check.file} no longer contains ${needle}`);
    }
  }
}

console.log(`BB source: ${root}`);
console.log(`Commit: ${commit}`);
console.log(`Checks: ${checks.length}`);

if (failures.length > 0) {
  console.error("\nSelector contract failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Selector contract: ok");
