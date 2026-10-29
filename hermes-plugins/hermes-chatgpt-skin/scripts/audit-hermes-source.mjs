import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultSource = path.join(process.env.HERMES_HOME ?? path.join(os.homedir(), '.hermes'), 'hermes-agent')
const sourceRoot = path.resolve(process.argv[2] ?? process.env.HERMES_SOURCE ?? defaultSource)

const sourceChecks = [
  {
    label: 'theme model',
    file: 'apps/desktop/src/themes/types.ts',
    needles: ['darkColors?: DesktopThemeColors', 'terminal?: DesktopTerminalPalette', 'customCSS?: string']
  },
  {
    label: 'theme paint',
    file: 'apps/desktop/src/themes/context.tsx',
    needles: [
      'root.dataset.hermesTheme = skinName',
      'root.dataset.hermesMode = rendered',
      'hermes-desktop-custom-css',
      '--dt-primary-solid',
      '--dt-font-sans',
      '--dt-line-height'
    ]
  },
  {
    label: 'theme registry',
    file: 'apps/desktop/src/themes/user-themes.ts',
    needles: ["export const THEMES_AREA = 'themes'", 'isValidTheme']
  },
  {
    label: 'routes',
    file: 'apps/desktop/src/app/routes.ts',
    needles: [
      'export const APP_ROUTES',
      'CAPABILITIES_ROUTE',
      'STARMAP_ROUTE',
      'SETTINGS_ROUTE',
      'COMMAND_CENTER_ROUTE'
    ]
  },
  {
    label: 'button primitive',
    file: 'apps/desktop/src/components/ui/button.tsx',
    needles: ['data-slot="button"', 'data-size={size}', 'data-variant={variant}']
  },
  {
    label: 'field primitives',
    file: 'apps/desktop/src/components/ui/input.tsx',
    needles: ['data-slot="input"', 'data-slot="input-group"']
  },
  {
    label: 'select primitive',
    file: 'apps/desktop/src/components/ui/select.tsx',
    needles: ['data-slot="select-trigger"', 'data-slot="select-content"', 'data-slot="select-item"']
  },
  {
    label: 'menu primitive',
    file: 'apps/desktop/src/components/ui/menu.ts',
    needles: ['menuSurfaceClass', 'menuItemClass', 'menuItemFocusClass']
  },
  {
    label: 'dropdown primitive',
    file: 'apps/desktop/src/components/ui/dropdown-menu.tsx',
    needles: [
      'data-slot="dropdown-menu-content"',
      'data-slot="dropdown-menu-item"',
      'data-slot="dropdown-menu-search"',
      'dropdownMenuRow',
      'useSearchSafeHover'
    ]
  },
  {
    label: 'context menu primitive',
    file: 'apps/desktop/src/components/ui/context-menu.tsx',
    needles: ['data-slot="context-menu-content"', 'data-slot="context-menu-item"']
  },
  {
    label: 'popover primitive',
    file: 'apps/desktop/src/components/ui/popover.tsx',
    needles: ['data-slot="popover-content"', 'popoverContentVariants']
  },
  {
    label: 'dialog primitive',
    file: 'apps/desktop/src/components/ui/dialog.tsx',
    needles: ['data-slot="dialog-overlay"', 'data-slot="dialog-content"', 'DialogPrimitive.Content']
  },
  {
    label: 'tooltip primitive',
    file: 'apps/desktop/src/components/ui/tooltip.tsx',
    needles: ['data-slot="tooltip-content"', 'data-slot="tooltip-arrow"']
  },
  {
    label: 'command primitive',
    file: 'apps/desktop/src/components/ui/command.tsx',
    needles: ['data-slot="command"', 'data-slot="command-item"', 'data-slot="command-input-wrapper"']
  },
  {
    label: 'card stack',
    file: 'apps/desktop/src/components/ui/card-stack.tsx',
    needles: ['data-slot="card-stack-surface"', 'data-slot="card-stack-edge"']
  },
  {
    label: 'sidebar primitive',
    file: 'apps/desktop/src/components/ui/sidebar.tsx',
    needles: ['data-slot="sidebar-menu-button"', 'data-slot="sidebar"', 'data-slot="sidebar-wrapper"']
  },
  {
    label: 'sessions sidebar',
    file: 'apps/desktop/src/app/chat/sidebar/index.tsx',
    needles: ['data-tour="sessions-sidebar"', 'data-tip-region=""']
  },
  {
    label: 'sidebar section labels',
    file: 'apps/desktop/src/app/shell/sidebar-label.tsx',
    needles: ['text-(--theme-primary)', 'tracking-[0.16em]', 'dither']
  },
  {
    label: 'status bar',
    file: 'apps/desktop/src/app/shell/statusbar-controls.tsx',
    needles: ['data-slot="statusbar"']
  },
  {
    label: 'pane tabs',
    file: 'apps/desktop/src/components/ui/pane-tab.tsx',
    needles: ['data-slot="pane-tab"', 'data-closeable', 'TAB_HORIZONTAL', 'TAB_VERTICAL']
  },
  {
    label: 'overlay shell',
    file: 'apps/desktop/src/app/overlays/overlay-view.tsx',
    needles: ['data-overlay-surface=""', 'data-glass-raised=""']
  },
  {
    label: 'overlay navigation',
    file: 'apps/desktop/src/app/overlays/overlay-split-layout.tsx',
    needles: ['data-tour="overlay-nav"', 'OverlaySplitLayout', 'OverlayMain', 'gap-0.5', 'ml-3.5']
  },
  {
    label: 'panel rows',
    file: 'apps/desktop/src/app/overlays/panel.tsx',
    needles: ['data-panel-row=', 'PanelHeader', 'PanelListRow']
  },
  {
    label: 'right sidebar',
    file: 'apps/desktop/src/app/right-sidebar/index.tsx',
    needles: ['RightSidebarPane', 'RightSidebarSectionHeader', 'FilesystemTab']
  },
  {
    label: 'composer',
    file: 'apps/desktop/src/app/chat/composer/index.tsx',
    needles: [
      'data-slot="composer-root"',
      'data-slot="composer-surface"',
      'data-slot="composer-fade"',
      '[grid-area:menu]',
      '[grid-area:controls]'
    ]
  },
  {
    label: 'composer controls',
    file: 'apps/desktop/src/app/chat/composer/control-classes.ts',
    needles: ['GHOST_ICON_BTN', 'PRIMARY_ICON_BTN', 'rounded-full']
  },
  {
    label: 'titlebar controls',
    file: 'apps/desktop/src/app/shell/titlebar-controls.tsx',
    needles: ['data-titlebar-cluster', 'aria-expanded', 'aria-label']
  },
  {
    label: 'model selector',
    file: 'apps/desktop/src/app/shell/model-catalog-menu.tsx',
    needles: ['dropdownMenuRow', 'DropdownMenuSearch', 'data-kb-active']
  },
  {
    label: 'model selector host',
    file: 'apps/desktop/src/app/chat/composer/model-pill.tsx',
    needles: ['className="w-72 p-0"', 'ModelMenuCloseContext.Provider']
  },
  {
    label: 'reasoning selector',
    file: 'apps/desktop/src/app/chat/composer/reasoning-pill.tsx',
    needles: ['className="w-52 p-0"', 'ModelMenuCloseContext.Provider']
  },
  {
    label: 'model picker dialog',
    file: 'apps/desktop/src/components/model-picker.tsx',
    needles: ['className="rounded-none bg-card"', 'bg-primary text-primary-foreground']
  },
  {
    label: 'voice selector',
    file: 'apps/desktop/src/app/chat/composer/voice-menu.tsx',
    needles: ['dropdownMenuRow', 'DropdownMenuCheckboxItem', 'DropdownMenuContent']
  },
  {
    label: 'search field',
    file: 'apps/desktop/src/components/ui/search-field.tsx',
    needles: ['border-b border-transparent', 'aria-label', 'focus-within:opacity-100']
  },
  {
    label: 'composer status stack',
    file: 'apps/desktop/src/app/chat/composer/status-stack/index.tsx',
    needles: ['data-slot="composer-status-stack"', 'composerDockCard']
  },
  {
    label: 'user message',
    file: 'apps/desktop/src/components/assistant-ui/thread/user-message.tsx',
    needles: [
      'data-slot="aui_user-message-root"',
      'data-slot="aui_user-bubble-actions"',
      'composer-human-message'
    ]
  },
  {
    label: 'code card',
    file: 'apps/desktop/src/components/chat/code-card.tsx',
    needles: ['data-slot="code-card"', 'data-slot="code-card-body"']
  },
  {
    label: 'tool rows',
    file: 'apps/desktop/src/components/assistant-ui/tool/fallback.tsx',
    needles: ['data-slot="tool-block"', 'data-tool-row=""']
  },
  {
    label: 'approvals',
    file: 'apps/desktop/src/components/assistant-ui/tool/approval.tsx',
    needles: ['data-slot="tool-approval-card"', 'data-slot="tool-approval-actions"']
  },
  {
    label: 'diffs',
    file: 'apps/desktop/src/components/chat/diff-lines.tsx',
    needles: ['data-slot="file-diff-panel"']
  },
  {
    label: 'notifications',
    file: 'apps/desktop/src/components/notifications.tsx',
    needles: ['STACK_SURFACE', '<CardStack', '<Alert']
  },
  {
    label: 'command palette',
    file: 'apps/desktop/src/app/command-palette/index.tsx',
    needles: ['DialogPrimitive.Content', 'HUD_SURFACE', '<Command']
  },
  {
    label: 'settings subpages',
    file: 'apps/desktop/src/app/settings/subpages.ts',
    needles: ['APPEARANCE_SUBPAGES', 'CONFIG_SUBPAGES', 'OTHER_SUBPAGES']
  }
]

const pageFiles = [
  'apps/desktop/src/app/chat/index.tsx',
  'apps/desktop/src/app/settings/index.tsx',
  'apps/desktop/src/app/command-center/index.tsx',
  'apps/desktop/src/app/session-import/index.tsx',
  'apps/desktop/src/app/capabilities/index.tsx',
  'apps/desktop/src/app/messaging/index.tsx',
  'apps/desktop/src/app/webhooks/index.tsx',
  'apps/desktop/src/app/artifacts/index.tsx',
  'apps/desktop/src/app/cron/index.tsx',
  'apps/desktop/src/app/profiles/index.tsx',
  'apps/desktop/src/app/agents/index.tsx',
  'apps/desktop/src/app/starmap/index.tsx'
]

const pluginHooks = [
  '[data-hermes-theme="chatgpt"]',
  '[data-slot="button"]',
  '[data-slot="input"]',
  '[data-slot="select-trigger"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="context-menu-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="dialog-content"]',
  '[data-slot="tooltip-content"]',
  '[data-slot="command-item"]',
  '[data-slot="command-item"][class~="bg-primary"]',
  '[data-slot="command"]',
  '[class~="rounded-none"]',
  '[data-kb-active]',
  '[data-slot="dropdown-menu-sub-trigger"][data-highlighted]',
  '[data-slot="card-stack-surface"]',
  '[data-slot="sidebar-menu-button"]',
  '[data-slot="sidebar-menu-sub-button"]',
  '[data-tour="sessions-sidebar"]',
  '[data-tour="page-tabs"]',
  '[class~="text-(--theme-primary)"]',
  '[class~="dither"]',
  '[data-slot="statusbar"]',
  '[data-slot="pane-tab"]',
  '[data-tree-tab="workspace"]',
  '[data-titlebar-cluster="left"]',
  '[data-slot="pane-tab"][data-vertical][aria-selected="true"]',
  '[data-slot="switch"]',
  '[data-slot="tabs-list"]',
  '[data-overlay-surface]',
  '[data-glass-raised]',
  '[data-tour="overlay-nav"]',
  '[data-panel-row]',
  '[data-panel-row] + [data-panel-row]',
  '[data-slot="composer-root"]',
  '[data-slot="composer-surface"]',
  '[data-slot="composer-status-stack"]',
  '[data-slot="aui_user-message-root"]',
  '[data-slot="aui_user-bubble-actions"]',
  '[data-slot="aui_assistant-message-content"]',
  '[data-slot="code-card"]',
  '[data-slot="tool-block"]',
  '[data-slot="tool-approval-card"]',
  '[data-slot="aui_intro"]'
]

if (!existsSync(sourceRoot)) {
  console.error(`Hermes source not found: ${sourceRoot}`)
  process.exit(2)
}

let commit = 'unknown'
try {
  commit = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} catch (error) {
  console.error(`Cannot read git revision from ${sourceRoot}`)
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}

const failures = []
for (const check of sourceChecks) {
  const filePath = path.join(sourceRoot, check.file)
  let text
  try {
    text = await readFile(filePath, 'utf8')
  } catch {
    failures.push(`${check.label}: missing ${check.file}`)
    continue
  }

  for (const needle of check.needles) {
    if (!text.includes(needle)) {
      failures.push(`${check.label}: ${check.file} no longer contains ${needle}`)
    }
  }
}

for (const relativePath of pageFiles) {
  if (!existsSync(path.join(sourceRoot, relativePath))) {
    failures.push(`page: missing ${relativePath}`)
  }
}

const pluginSource = await readFile(path.join(pluginRoot, 'desktop', 'plugin.js'), 'utf8')
for (const hook of pluginHooks) {
  if (!pluginSource.includes(hook)) {
    failures.push(`plugin contract: missing ${hook}`)
  }
}

console.log(`Hermes source: ${sourceRoot}`)
console.log(`Commit: ${commit}`)
console.log(`Source checks: ${sourceChecks.length}`)
console.log(`Page entries: ${pageFiles.length}`)
console.log(`Plugin hooks: ${pluginHooks.length}`)

if (failures.length > 0) {
  console.error('\nContract failures:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Selector contract: ok')
