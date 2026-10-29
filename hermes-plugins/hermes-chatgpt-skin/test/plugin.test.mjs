import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginPath = path.join(pluginRoot, 'desktop', 'plugin.js')
const source = await readFile(pluginPath, 'utf8')

const requested = []
const sandbox = {
  PALETTE_AREA: 'palette',
  THEMES_AREA: 'themes',
  requestTheme(name) {
    requested.push(name)
    return true
  },
  console: {
    log() {}
  }
}

const body = source
  .replace(/^import .* from '@hermes\/plugin-sdk'\s*$/m, '')
  .replace(/^export \{[^}]+\}\s*$/m, '')
  .replace('export default', 'globalThis.__plugin =')

vm.runInNewContext(`${body}\n;globalThis.__buildTheme = buildTheme; globalThis.__css = css;`, sandbox)

const plugin = sandbox.__plugin
const buildTheme = sandbox.__buildTheme
const css = sandbox.__css

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map(value => Number.parseInt(value, 16) / 255)
    .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

test('plugin uses the Hermes Desktop contract', () => {
  assert.equal(plugin.id, 'hermes-chatgpt-skin')
  assert.equal(typeof plugin.register, 'function')
  assert.doesNotMatch(source, /document\.(?:querySelector|getElementById)/)
  assert.doesNotMatch(source, /\beval\(|\bnew Function\(/)
})

test('theme carries light, dark, typography and terminal data', () => {
  const theme = buildTheme()

  assert.equal(theme.name, 'chatgpt')
  assert.equal(theme.label, 'ChatGPT')
  assert.equal(theme.colors.background, '#f6f6f6')
  assert.equal(theme.darkColors.background, '#181818')
  assert.equal(theme.typography.lineHeight, '1.625')
  assert.equal(theme.terminal.foreground, '#1a1c1f')
  assert.equal(theme.darkTerminal.foreground, '#e6e6e6')
  assert.equal(theme.customCSS, css)

  for (const colors of [theme.colors, theme.darkColors]) {
    for (const key of ['background', 'foreground', 'card', 'popover', 'primary', 'border', 'ring']) {
      assert.equal(typeof colors[key], 'string', `missing ${key}`)
      assert.ok(colors[key].length > 0)
    }

    assert.ok(contrast(colors.background, colors.foreground) >= 7, 'background/foreground contrast')
    assert.ok(contrast(colors.primary, colors.primaryForeground) >= 4.5, 'primary contrast')
  }

  for (const palette of [theme.terminal, theme.darkTerminal]) {
    for (const key of [
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'brightBlack',
      'brightRed',
      'brightGreen',
      'brightYellow',
      'brightBlue',
      'brightMagenta',
      'brightCyan',
      'brightWhite'
    ]) {
      assert.match(palette[key], /^#[0-9a-f]{6}$/i, `terminal ${key}`)
    }
  }
})

test('custom CSS is scoped and covers the source-owned surface hooks', () => {
  const requiredHooks = [
    '[data-slot="button"]',
    '[data-slot="input"]',
    '[data-slot="textarea"]',
    '[data-slot="select-trigger"]',
    '[data-slot="dropdown-menu-content"]',
    '[class~="rounded-none"]',
    '[data-kb-active]',
    '[data-slot="context-menu-content"]',
    '[data-slot="popover-content"]',
    '[data-slot="dialog-content"]',
    '[data-slot="tooltip-content"]',
    '[data-slot="command-item"]',
    '[data-slot="command"]',
    '[data-slot="card-stack-surface"]',
    '[data-slot="sidebar-menu-button"]',
    '[data-slot="sidebar-menu-sub-button"]',
    '[data-tour="sessions-sidebar"]',
    '[data-tour="page-tabs"]',
    '[class~="text-(--theme-primary)"]',
    '[class~="dither"]',
    '[data-slot="statusbar"]',
    '[data-slot="pane-tab"]',
    '[data-slot="switch"]',
    '[data-slot="tabs-list"]',
    '[data-overlay-surface]',
    '[data-glass-raised]',
    '[data-tour="overlay-nav"]',
    '[data-panel-row]',
    '[data-slot="composer-root"]',
    '[data-slot="composer-surface"]',
    '[data-slot="composer-fade"]',
    '[data-slot="composer-status-stack"]',
    '[data-slot="aui_user-message-root"]',
    '[data-slot="aui_user-bubble-actions"]',
    '[data-slot="aui_assistant-message-content"]',
    '[data-slot="code-card"]',
    '[data-slot="tool-block"]',
    '[data-slot="tool-approval-card"]',
    '[data-slot="aui_intro"]'
  ]

  for (const hook of requiredHooks) {
    assert.ok(css.includes(hook), `missing ${hook}`)
  }

  assert.ok(!css.includes('\n:root {'), 'unscoped root rule')
  assert.ok(!css.includes('var(--ring)'), 'undefined ring variable')
  for (const variable of ['primary', 'card', 'popover', 'background', 'foreground']) {
    assert.ok(!css.includes(`var(--${variable})`), `undefined ${variable} variable`)
  }
  assert.ok(Buffer.byteLength(css) < 128 * 1024, 'custom CSS is too large')
})

test('component geometry keeps the measured OpenAI radius and control ladder', () => {
  assert.match(css, /--chatgpt-radius-sm:\s*0\.46875rem/, '7.5px radius')
  assert.match(css, /--chatgpt-radius-md:\s*0\.625rem/, '10px radius')
  assert.match(css, /--chatgpt-radius-2xl:\s*1\.25rem/, '20px radius')
  assert.match(css, /--chatgpt-radius-3xl:\s*1\.5625rem/, '25px radius')

  assert.match(css, /\[data-size="icon-xs"\][\s\S]*radius-md/, '24px icon radius')
  assert.match(css, /\[data-size="icon-sm"\][\s\S]*radius-lg/, '32px icon radius')
  assert.match(css, /\[data-variant="default"\][\s\S]*chatgpt-primary-button-bg/, 'inverse primary button')
  assert.match(css, /\[data-tour="page-tabs"\] button[\s\S]*height:\s*2rem/, 'page tab height')
  assert.ok(css.includes('button[class~="group/text-tab"])[data-active="true"]'), 'page tab active state')
  assert.match(css, /\[data-slot="switch"\]\[class~="h-4"\]/, 'compact switch')
  assert.match(css, /\[data-slot="tooltip-content"\][\s\S]*radius-2xl/, 'tooltip radius')
  assert.match(css, /@media \(max-width: 47\.5rem\)[\s\S]*padding:\s*1rem/, 'narrow overlay gutter')
  assert.match(css, /width:\s*min\(20rem, 72vw,/, 'responsive intro wordmark')
})

test('interaction states and nested spacing are covered as component families', () => {
  assert.match(css, /\[class~="rounded-none"\][\s\S]*min-height:\s*1\.875rem/, 'compact menu row height')
  assert.match(css, /margin:\s*1px 0\.25rem/, 'compact menu inset')
  assert.match(
    css,
    /\[data-slot="dropdown-menu-sub-trigger"\]\[data-highlighted\]/,
    'searchable submenu hover'
  )
  assert.match(css, /\[data-slot="dropdown-menu-radio-item"\]\[data-highlighted\]/, 'radio hover')
  assert.match(css, /\[data-kb-active\][\s\S]*ui-control-active-background/, 'keyboard-selected row')
  assert.match(css, /\[data-tour="overlay-nav"\]\s*\{\s*gap:\s*4px;/, 'top-level nav rhythm')
  assert.match(css, /button\[data-tour\^="nav-"\][\s\S]*gap:\s*4px/, 'nested nav rhythm')
  assert.match(css, /\[data-panel-row\] \+ \[data-panel-row\][\s\S]*margin-top:\s*2px/, 'panel row gap')
  assert.match(css, /min-height:\s*2rem;[\s\S]*opacity:\s*1 !important/, 'filled search field')
  assert.match(css, /:has\(> svg\):hover[\s\S]*ui-control-hover-background/, 'search hover state')
  assert.match(css, /\[data-variant="default"\]:active[\s\S]*chatgpt-primary-button-active/, 'primary press state')
  assert.match(css, /\[data-variant="ghost"\][\s\S]*:active[\s\S]*ui-control-active-background/, 'quiet press state')
  assert.match(css, /\[data-slot="select-trigger"\][\s\S]*:hover:not\(:focus\)/, 'field hover state')
  assert.match(css, /\[data-slot="tabs-trigger"\]\[data-state="inactive"\]:hover/, 'tab hover state')
  assert.match(css, /\[data-slot="command"\]:not\(\[class~="rounded-none"\]\)/, 'standalone command radius')
  assert.match(
    css,
    /\[data-slot="command-item"\]\[class~="bg-primary"\][\s\S]*ui-control-active-background/,
    'current model row'
  )
  assert.match(
    css,
    /\[data-slot="command-item"\]\[class~="bg-primary"\][\s\S]*box-shadow:\s*inset/,
    'current model hairline'
  )
  assert.match(
    css,
    /\[data-slot="dropdown-menu-label"\][\s\S]*margin:\s*0 !important/,
    'menu section label aligns with rows'
  )
  assert.match(
    css,
    /\[data-slot="dropdown-menu-group"\][\s\S]*margin:\s*0 !important/,
    'menu group flush with the surface'
  )
  assert.ok(!css.includes('0.58'), 'stale reduced-opacity search rule')
})

test('mode contracts include the semantic role and state tokens', () => {
  for (const token of [
    '--ui-bg-chrome',
    '--ui-bg-sidebar',
    '--ui-bg-editor',
    '--ui-bg-elevated',
    '--ui-row-hover-background',
    '--ui-row-active-background',
    '--ui-control-hover-background',
    '--ui-control-active-background',
    '--ui-text-primary',
    '--ui-text-secondary',
    '--ui-text-tertiary',
    '--ui-text-quaternary',
    '--ui-stroke-primary',
    '--ui-stroke-secondary',
    '--ui-stroke-tertiary',
    '--ui-stroke-quaternary',
    '--ui-chat-surface-background',
    '--ui-sidebar-surface-background',
    '--ui-chat-bubble-background',
    '--chatgpt-link',
    '--chatgpt-primary-button-active',
    '--chatgpt-sidebar-search',
    '--dt-user-bubble',
    '--composer-fill',
    '--sidebar-accent'
  ]) {
    const occurrences = css.split(token).length - 1
    assert.ok(occurrences >= 2, `${token} must exist in both modes`)
  }

  assert.match(css, /--chatgpt-link:\s*#0169cc/, 'light link tint')
  assert.ok(contrast('#0169cc', '#f6f6f6') >= 4.5, 'light link contrast')
})

test('registration applies once and exposes a palette command', () => {
  requested.length = 0
  const storage = new Map()
  const registrations = []
  let disposed = false

  const makeContext = () => ({
    i18n: {
      register() {},
      t(key) {
        return key === 'apply' ? 'Theme: Apply ChatGPT Skin' : key
      }
    },
    onDispose(fn) {
      if (disposed) fn()
    },
    registerMany(contributions) {
      registrations.push(...contributions)
      return () => {
        disposed = true
      }
    },
    storage: {
      get(key, fallback) {
        return storage.has(key) ? storage.get(key) : fallback
      },
      set(key, value) {
        storage.set(key, value)
      }
    }
  })

  plugin.register(makeContext())

  assert.deepEqual(requested, ['chatgpt'])
  assert.equal(storage.get('installed'), true)
  assert.equal(registrations.length, 2)
  assert.equal(registrations[0].area, 'themes')
  assert.equal(registrations[0].data.name, 'chatgpt')
  assert.equal(registrations[1].area, 'palette')

  registrations[1].data.run()
  assert.deepEqual(requested, ['chatgpt', 'chatgpt'])

  plugin.register(makeContext())
  assert.deepEqual(requested, ['chatgpt', 'chatgpt'])
})
