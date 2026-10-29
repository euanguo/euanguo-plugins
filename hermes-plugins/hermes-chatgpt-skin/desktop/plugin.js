/**
 * ChatGPT skin for Hermes Desktop.
 *
 * This is a declarative theme plugin: Hermes paints the palette, injects the
 * scoped custom CSS, and removes it when another skin is selected. The plugin
 * never queries or mutates the app DOM.
 */

import { PALETTE_AREA, requestTheme, THEMES_AREA } from '@hermes/plugin-sdk'

const ID = 'hermes-chatgpt-skin'
const THEME_NAME = 'chatgpt'

const light = {
  background: '#f6f6f6',
  foreground: '#1a1c1f',
  card: '#ffffff',
  cardForeground: '#1a1c1f',
  muted: '#ececec',
  mutedForeground: '#6f7073',
  popover: '#ffffff',
  popoverForeground: '#1a1c1f',
  primary: '#339cff',
  primaryForeground: '#0d0d0d',
  secondary: 'rgba(26, 28, 31, 0.05)',
  secondaryForeground: '#1a1c1f',
  accent: 'rgba(26, 28, 31, 0.08)',
  accentForeground: '#1a1c1f',
  border: 'rgba(26, 28, 31, 0.08)',
  input: 'rgba(26, 28, 31, 0.08)',
  ring: 'rgba(131, 195, 255, 0.76)',
  midground: '#339cff',
  midgroundForeground: '#0d0d0d',
  composerRing: 'rgba(131, 195, 255, 0.76)',
  destructive: '#ba2623',
  destructiveForeground: '#ffffff',
  sidebarBackground: '#ffffff',
  sidebarBorder: 'rgba(26, 28, 31, 0.08)',
  userBubble: '#f3f3f4',
  userBubbleBorder: 'transparent'
}

const dark = {
  background: '#181818',
  foreground: '#ffffff',
  card: '#232323',
  cardForeground: '#ffffff',
  muted: '#2f2f2f',
  mutedForeground: '#aeaeae',
  popover: '#2d2d2d',
  popoverForeground: '#ffffff',
  primary: '#339cff',
  primaryForeground: '#0d0d0d',
  secondary: 'rgba(255, 255, 255, 0.052)',
  secondaryForeground: '#ffffff',
  accent: 'rgba(255, 255, 255, 0.078)',
  accentForeground: '#ffffff',
  border: 'rgba(255, 255, 255, 0.084)',
  input: 'rgba(255, 255, 255, 0.084)',
  ring: 'rgba(131, 195, 255, 0.76)',
  midground: '#339cff',
  midgroundForeground: '#0d0d0d',
  composerRing: 'rgba(131, 195, 255, 0.76)',
  destructive: '#ff8a88',
  destructiveForeground: '#0d0d0d',
  sidebarBackground: '#282828',
  sidebarBorder: 'rgba(255, 255, 255, 0.084)',
  userBubble: '#202020',
  userBubbleBorder: 'transparent'
}

const typography = {
  fontSans:
    '"OpenAI Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", ' +
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif, ' +
    '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", emoji',
  fontMono:
    '"Berkeley Mono", "SF Mono", "JetBrains Mono", "IBM Plex Mono", "Source Code Pro", ' +
    'ui-monospace, Menlo, Consolas, "Liberation Mono", monospace, ' +
    '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", emoji',
  baseSize: '1rem',
  lineHeight: '1.625',
  letterSpacing: '0'
}

const terminal = {
  foreground: '#1a1c1f',
  cursor: '#339cff',
  selectionBackground: 'rgba(51, 156, 255, 0.25)',
  black: '#1a1c1f',
  red: '#e02e2a',
  green: '#00a240',
  yellow: '#c58d00',
  blue: '#339cff',
  magenta: '#924ff7',
  cyan: '#339cff',
  white: '#e6e6e6',
  brightBlack: '#8d8e8f',
  brightRed: '#e02e2a',
  brightGreen: '#00a240',
  brightYellow: '#c58d00',
  brightBlue: '#339cff',
  brightMagenta: '#924ff7',
  brightCyan: '#339cff',
  brightWhite: '#ffffff'
}

const darkTerminal = {
  foreground: '#e6e6e6',
  cursor: '#339cff',
  selectionBackground: 'rgba(51, 156, 255, 0.24)',
  black: '#181818',
  red: '#ff6764',
  green: '#40c977',
  yellow: '#ffd240',
  blue: '#339cff',
  magenta: '#ad7bf9',
  cyan: '#339cff',
  white: '#dfdfdf',
  brightBlack: '#bfbfbf',
  brightRed: '#ff6764',
  brightGreen: '#40c977',
  brightYellow: '#ffd240',
  brightBlue: '#339cff',
  brightMagenta: '#ad7bf9',
  brightCyan: '#339cff',
  brightWhite: '#dfdfdf'
}

const css = `
/* This file is injected only while the ChatGPT skin is active. */
:root[data-hermes-theme="chatgpt"] {
  --dt-line-height: 1.625;
  --dt-letter-spacing: 0;
  --dt-base-size: 1rem;

  --chatgpt-radius-sm: 0.46875rem;
  --chatgpt-radius-md: 0.625rem;
  --chatgpt-radius-lg: 0.78125rem;
  --chatgpt-radius-xl: 0.9375rem;
  --chatgpt-radius-2xl: 1.25rem;
  --chatgpt-radius-3xl: 1.5625rem;
  --chatgpt-overlay-blur: 8px;

  --conversation-text-base-size: 0.875rem;
  --conversation-base-line-height: calc(0.875rem * 1.625);
  --conversation-tool-base-size: 0.75rem;
  --conversation-caption-base-size: 0.75rem;
  --conversation-caption-base-line-height: 1rem;
  --paragraph-gap: 0.65rem;
  --turn-block-gap: 1.25rem;
  --tool-row-gap: 0.5rem;

  --composer-width: 55rem;
  --composer-surface-pad-x: 1rem;
  --composer-surface-pad-y: 0.625rem;
  --composer-control-gap: 0.25rem;

  --radius: 0.625rem;
  --radius-scalar: 0.8;

  --shadow-xs: 0 1px 2px rgb(0 0 0 / 0.04);
  --shadow-sm:
    0 0 0 0.5px rgb(0 0 0 / 0.06),
    0 2px 8px rgb(0 0 0 / 0.05);
  --shadow-md:
    0 0 0 0.5px rgb(0 0 0 / 0.08),
    0 8px 16px -4px rgb(0 0 0 / 0.12);
  --shadow-nous:
    0 0 0 0.5px rgb(0 0 0 / 0.08),
    0 2px 6px rgb(0 0 0 / 0.05),
    0 16px 40px -16px rgb(0 0 0 / 0.18);
  --stroke-nous: rgba(26, 28, 31, 0.08);

  --dt-primary-solid: #339cff !important;
  --dt-primary-solid-foreground: #0d0d0d !important;
  --ui-success: #40c977 !important;
}

/* Light: white panels over a quiet canvas. */
:root[data-hermes-theme="chatgpt"]:not(.dark) {
  --chatgpt-control: #ffffff;
  --chatgpt-select: #ffffff;
  --chatgpt-field-border: rgba(26, 28, 31, 0.08);
  --chatgpt-elevated: color-mix(in oklab, #ffffff 94%, transparent);
  --chatgpt-cmdk: color-mix(in oklab, #ffffff 96%, transparent);
  --chatgpt-elevated-ring: rgba(26, 28, 31, 0.08);
  --chatgpt-elevated-shadow: 0 8px 16px -4px rgb(0 0 0 / 0.12);
  --chatgpt-button-secondary: rgba(26, 28, 31, 0.05);
  --chatgpt-track-off: rgba(26, 28, 31, 0.1);
  --chatgpt-composer: color-mix(in oklab, #ffffff 86.5%, transparent);
  --chatgpt-code-surface: #f0f0f1;
  --chatgpt-link: #0169cc;
  --chatgpt-menu-hover: rgba(26, 28, 31, 0.08);
  --chatgpt-primary-button-bg: #1a1c1f;
  --chatgpt-primary-button-fg: #ffffff;
  --chatgpt-primary-button-hover: #303236;
  --chatgpt-primary-button-active: #44464a;
  --chatgpt-sidebar-search: rgba(26, 28, 31, 0.045);
  --chatgpt-danger-fill: #ff6764;
  --chatgpt-danger-ink: #1a1c1f;

  --ui-bg-chrome: #f6f6f6;
  --ui-bg-sidebar: #ffffff;
  --ui-bg-editor: #ffffff;
  --ui-bg-elevated: #ffffff;
  --ui-bg-card: rgba(26, 28, 31, 0.035);
  --ui-bg-input: #ffffff;
  --ui-bg-primary: rgba(26, 28, 31, 0.08);
  --ui-bg-secondary: rgba(26, 28, 31, 0.055);
  --ui-bg-tertiary: rgba(26, 28, 31, 0.04);
  --ui-bg-quaternary: rgba(26, 28, 31, 0.05);
  --ui-bg-quinary: rgba(26, 28, 31, 0.03);
  --ui-row-hover-background: rgba(26, 28, 31, 0.055);
  --ui-row-active-background: rgba(26, 28, 31, 0.08);
  --ui-row-open-background: rgba(26, 28, 31, 0.035);
  --ui-control-hover-background: rgba(26, 28, 31, 0.055);
  --ui-control-active-background: rgba(26, 28, 31, 0.08);
  --ui-text-primary: #1a1c1f;
  --ui-text-secondary: rgba(26, 28, 31, 0.65);
  --ui-text-tertiary: rgba(26, 28, 31, 0.5);
  --ui-text-quaternary: rgba(26, 28, 31, 0.34);
  --conversation-scaffold-text: rgba(26, 28, 31, 0.74);
  --conversation-scaffold-meta: rgba(26, 28, 31, 0.52);
  --ui-stroke-primary: rgba(26, 28, 31, 0.14);
  --ui-stroke-secondary: rgba(26, 28, 31, 0.084);
  --ui-stroke-tertiary: rgba(26, 28, 31, 0.06);
  --ui-stroke-quaternary: rgba(26, 28, 31, 0.04);
  --ui-sash-hover-border: rgba(26, 28, 31, 0.18);
  --ui-sash-hover-background: rgba(26, 28, 31, 0.05);
  --ui-surface-background: #ffffff;
  --ui-sidebar-surface-background: #ffffff;
  --ui-chat-surface-background: #f6f6f6;
  --ui-editor-surface-background: #f6f6f6;
  --ui-terminal-surface-background: #f6f6f6;
  --ui-widget-surface-background: #ffffff;
  --ui-chat-bubble-background: #ffffff;
  --ui-chat-bubble-opaque-background: #ffffff;
  --ui-inline-code-background: rgba(26, 28, 31, 0.06);
  --ui-inline-code-foreground: #1a1c1f;
  --ui-selection-background: rgba(51, 156, 255, 0.22);

  --ui-red: #e02e2a;
  --ui-orange: #fb6a22;
  --ui-yellow: #c58d00;
  --ui-green: #00a240;
  --ui-cyan: #339cff;
  --ui-blue: #339cff;
  --ui-purple: #924ff7;
  --ui-diff-add-border: #00a240;
  --ui-diff-add-background: rgba(0, 162, 64, 0.11);
  --ui-diff-add-foreground: #006c2b;
  --ui-diff-remove-border: #e02e2a;
  --ui-diff-remove-background: rgba(224, 46, 42, 0.1);
  --ui-diff-remove-foreground: #a91f1c;

  --sidebar: #ffffff;
  --sidebar-foreground: #1a1c1f;
  --sidebar-border: rgba(26, 28, 31, 0.08);
  --sidebar-accent: rgba(26, 28, 31, 0.055);
  --sidebar-accent-foreground: #1a1c1f;
  --sidebar-primary: #339cff;
  --sidebar-primary-foreground: #0d0d0d;
  --sidebar-ring: rgba(131, 195, 255, 0.76);
  --sidebar-edge-border: rgba(26, 28, 31, 0.075);
  --chrome-action-hover: rgba(26, 28, 31, 0.055);

  --composer-fill: color-mix(in srgb, #ffffff 86.5%, transparent);
  --dt-user-bubble: color-mix(in srgb, #f3f3f4 var(--user-bubble-keep, 100%), transparent);
  --dt-scrollbar-thumb: #8c8c8e;
}

/* Dark: graphite ground, lighter floating surfaces. */
:root[data-hermes-theme="chatgpt"].dark {
  --chatgpt-control: #2a2a2a;
  --chatgpt-select: #2a2a2a;
  --chatgpt-field-border: transparent;
  --chatgpt-elevated: color-mix(in oklab, #2d2d2d 94%, transparent);
  --chatgpt-cmdk: color-mix(in oklab, #2d2d2d 96%, transparent);
  --chatgpt-elevated-ring: rgba(255, 255, 255, 0.082);
  --chatgpt-elevated-shadow: 0 8px 16px -4px rgb(0 0 0 / 0.28);
  --chatgpt-button-secondary: rgba(255, 255, 255, 0.052);
  --chatgpt-track-off: rgba(255, 255, 255, 0.1);
  --chatgpt-composer: color-mix(in oklab, #2d2d2d 86.5%, transparent);
  --chatgpt-code-surface: #141414;
  --chatgpt-link: #339cff;
  --chatgpt-menu-hover: rgba(255, 255, 255, 0.078);
  --chatgpt-primary-button-bg: #ffffff;
  --chatgpt-primary-button-fg: #0d0d0d;
  --chatgpt-primary-button-hover: #ececec;
  --chatgpt-primary-button-active: #dcdcdc;
  --chatgpt-sidebar-search: rgba(255, 255, 255, 0.052);
  --chatgpt-danger-fill: #ff6764;
  --chatgpt-danger-ink: #0d0d0d;

  --ui-bg-chrome: #181818;
  --ui-bg-sidebar: #282828;
  --ui-bg-editor: #232323;
  --ui-bg-elevated: #2d2d2d;
  --ui-bg-card: rgba(255, 255, 255, 0.035);
  --ui-bg-input: #2a2a2a;
  --ui-bg-primary: rgba(255, 255, 255, 0.09);
  --ui-bg-secondary: rgba(255, 255, 255, 0.07);
  --ui-bg-tertiary: rgba(255, 255, 255, 0.05);
  --ui-bg-quaternary: rgba(255, 255, 255, 0.052);
  --ui-bg-quinary: rgba(255, 255, 255, 0.03);
  --ui-row-hover-background: rgba(255, 255, 255, 0.08);
  --ui-row-active-background: rgba(255, 255, 255, 0.08);
  --ui-row-open-background: rgba(255, 255, 255, 0.04);
  --ui-control-hover-background: rgba(255, 255, 255, 0.078);
  --ui-control-active-background: rgba(255, 255, 255, 0.12);
  --ui-text-primary: #ffffff;
  --ui-text-secondary: rgba(255, 255, 255, 0.65);
  --ui-text-tertiary: rgba(255, 255, 255, 0.5);
  --ui-text-quaternary: rgba(255, 255, 255, 0.34);
  --conversation-scaffold-text: rgba(255, 255, 255, 0.74);
  --conversation-scaffold-meta: rgba(255, 255, 255, 0.52);
  --ui-stroke-primary: rgba(255, 255, 255, 0.14);
  --ui-stroke-secondary: rgba(255, 255, 255, 0.084);
  --ui-stroke-tertiary: rgba(255, 255, 255, 0.06);
  --ui-stroke-quaternary: rgba(255, 255, 255, 0.04);
  --ui-sash-hover-border: rgba(255, 255, 255, 0.18);
  --ui-sash-hover-background: rgba(255, 255, 255, 0.05);
  --ui-surface-background: #232323;
  --ui-sidebar-surface-background: #282828;
  --ui-chat-surface-background: #181818;
  --ui-editor-surface-background: #181818;
  --ui-terminal-surface-background: #181818;
  --ui-widget-surface-background: #202020;
  --ui-chat-bubble-background: #232323;
  --ui-chat-bubble-opaque-background: #232323;
  --ui-inline-code-background: rgba(255, 255, 255, 0.07);
  --ui-inline-code-foreground: rgba(255, 255, 255, 0.88);
  --ui-selection-background: rgba(51, 156, 255, 0.24);

  --ui-red: #ff6764;
  --ui-orange: #fb6a22;
  --ui-yellow: #ffd240;
  --ui-green: #40c977;
  --ui-cyan: #339cff;
  --ui-blue: #339cff;
  --ui-purple: #ad7bf9;
  --ui-diff-add-border: #40c977;
  --ui-diff-add-background: rgba(64, 201, 119, 0.12);
  --ui-diff-add-foreground: #9ce8ba;
  --ui-diff-remove-border: #ff6764;
  --ui-diff-remove-background: rgba(255, 103, 100, 0.12);
  --ui-diff-remove-foreground: #ffaaa8;

  --sidebar: #282828;
  --sidebar-foreground: #ffffff;
  --sidebar-border: rgba(255, 255, 255, 0.084);
  --sidebar-accent: rgba(255, 255, 255, 0.08);
  --sidebar-accent-foreground: #ffffff;
  --sidebar-primary: #339cff;
  --sidebar-primary-foreground: #0d0d0d;
  --sidebar-ring: rgba(131, 195, 255, 0.76);
  --sidebar-edge-border: rgba(255, 255, 255, 0.12);
  --chrome-action-hover: rgba(255, 255, 255, 0.078);

  --composer-fill: color-mix(in srgb, #2d2d2d 86.5%, transparent);
  --dt-user-bubble: color-mix(in srgb, #202020 var(--user-bubble-keep, 100%), transparent);
  --dt-scrollbar-thumb: #9a9a9a;

  --shadow-sm:
    0 0 0 0.5px rgb(255 255 255 / 0.06),
    0 2px 8px rgb(0 0 0 / 0.24);
  --shadow-md:
    0 0 0 0.5px rgb(255 255 255 / 0.08),
    0 8px 16px -4px rgb(0 0 0 / 0.28);
  --shadow-nous:
    0 0 0 0.5px rgb(255 255 255 / 0.08),
    0 2px 6px rgb(0 0 0 / 0.2),
    0 18px 44px -18px rgb(0 0 0 / 0.55);
  --stroke-nous: rgba(255, 255, 255, 0.082);
}

@media (pointer: fine) {
  :root[data-hermes-theme="chatgpt"] {
    --composer-control-size: 1.75rem;
    --composer-control-primary-size: 2rem;
    --composer-voice-menu-size: 1.5rem;
  }
}

/* OpenAI radius ladder. Side-specific utilities keep their own corners so
   split buttons and fused controls never become two full pills. */
:root[data-hermes-theme="chatgpt"]
  :where(
    [class~="rounded-sm"]:not([class*="rounded-l-"]):not([class*="rounded-r-"]):not([class*="rounded-t-"]):not(
        [class*="rounded-b-"]
      )
  ) {
  border-radius: var(--chatgpt-radius-sm) !important;
}

:root[data-hermes-theme="chatgpt"]
  :where(
    [class~="rounded-md"]:not([class*="rounded-l-"]):not([class*="rounded-r-"]):not([class*="rounded-t-"]):not(
        [class*="rounded-b-"]
      )
  ) {
  border-radius: var(--chatgpt-radius-md) !important;
}

:root[data-hermes-theme="chatgpt"]
  :where(
    [class~="rounded-lg"]:not([class*="rounded-l-"]):not([class*="rounded-r-"]):not([class*="rounded-t-"]):not(
        [class*="rounded-b-"]
      )
  ) {
  border-radius: var(--chatgpt-radius-lg) !important;
}

:root[data-hermes-theme="chatgpt"]
  :where(
    [class~="rounded-xl"]:not([class*="rounded-l-"]):not([class*="rounded-r-"]):not([class*="rounded-t-"]):not(
        [class*="rounded-b-"]
      )
  ) {
  border-radius: var(--chatgpt-radius-xl) !important;
}

:root[data-hermes-theme="chatgpt"]
  :where(
    [class~="rounded-2xl"]:not([class*="rounded-l-"]):not([class*="rounded-r-"]):not([class*="rounded-t-"]):not(
        [class*="rounded-b-"]
      )
  ) {
  border-radius: var(--chatgpt-radius-2xl) !important;
}

:root[data-hermes-theme="chatgpt"]
  :where(
    [class~="rounded-3xl"]:not([class*="rounded-l-"]):not([class*="rounded-r-"]):not([class*="rounded-t-"]):not(
        [class*="rounded-b-"]
      )
  ) {
  border-radius: var(--chatgpt-radius-3xl) !important;
}

/* Side-specific utilities need the same ladder. Without these, split controls
   keep Hermes' stock 2.5px corners on the side that carries the utility. */
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-l-none"]) {
  border-top-left-radius: 0 !important;
  border-bottom-left-radius: 0 !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-r-none"]) {
  border-top-right-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
}

:root[data-hermes-theme="chatgpt"] :where([class~="rounded-l-sm"], [class~="rounded-tl-sm"]) {
  border-top-left-radius: var(--chatgpt-radius-sm) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-l-sm"], [class~="rounded-bl-sm"]) {
  border-bottom-left-radius: var(--chatgpt-radius-sm) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-r-sm"], [class~="rounded-tr-sm"]) {
  border-top-right-radius: var(--chatgpt-radius-sm) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-r-sm"], [class~="rounded-br-sm"]) {
  border-bottom-right-radius: var(--chatgpt-radius-sm) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-t-sm"], [class~="rounded-tl-sm"]) {
  border-top-left-radius: var(--chatgpt-radius-sm) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-t-sm"], [class~="rounded-tr-sm"]) {
  border-top-right-radius: var(--chatgpt-radius-sm) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-b-sm"], [class~="rounded-bl-sm"]) {
  border-bottom-left-radius: var(--chatgpt-radius-sm) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-b-sm"], [class~="rounded-br-sm"]) {
  border-bottom-right-radius: var(--chatgpt-radius-sm) !important;
}

:root[data-hermes-theme="chatgpt"] :where([class~="rounded-l-md"], [class~="rounded-tl-md"]) {
  border-top-left-radius: var(--chatgpt-radius-md) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-l-md"], [class~="rounded-bl-md"]) {
  border-bottom-left-radius: var(--chatgpt-radius-md) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-r-md"], [class~="rounded-tr-md"]) {
  border-top-right-radius: var(--chatgpt-radius-md) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-r-md"], [class~="rounded-br-md"]) {
  border-bottom-right-radius: var(--chatgpt-radius-md) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-t-md"], [class~="rounded-tl-md"]) {
  border-top-left-radius: var(--chatgpt-radius-md) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-t-md"], [class~="rounded-tr-md"]) {
  border-top-right-radius: var(--chatgpt-radius-md) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-b-md"], [class~="rounded-bl-md"]) {
  border-bottom-left-radius: var(--chatgpt-radius-md) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-b-md"], [class~="rounded-br-md"]) {
  border-bottom-right-radius: var(--chatgpt-radius-md) !important;
}

:root[data-hermes-theme="chatgpt"] :where([class~="rounded-l-lg"], [class~="rounded-tl-lg"]) {
  border-top-left-radius: var(--chatgpt-radius-lg) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-l-lg"], [class~="rounded-bl-lg"]) {
  border-bottom-left-radius: var(--chatgpt-radius-lg) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-r-lg"], [class~="rounded-tr-lg"]) {
  border-top-right-radius: var(--chatgpt-radius-lg) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-r-lg"], [class~="rounded-br-lg"]) {
  border-bottom-right-radius: var(--chatgpt-radius-lg) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-t-lg"], [class~="rounded-tl-lg"]) {
  border-top-left-radius: var(--chatgpt-radius-lg) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-t-lg"], [class~="rounded-tr-lg"]) {
  border-top-right-radius: var(--chatgpt-radius-lg) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-b-lg"], [class~="rounded-bl-lg"]) {
  border-bottom-left-radius: var(--chatgpt-radius-lg) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-b-lg"], [class~="rounded-br-lg"]) {
  border-bottom-right-radius: var(--chatgpt-radius-lg) !important;
}

:root[data-hermes-theme="chatgpt"] :where([class~="rounded-l-xl"], [class~="rounded-tl-xl"]) {
  border-top-left-radius: var(--chatgpt-radius-xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-l-xl"], [class~="rounded-bl-xl"]) {
  border-bottom-left-radius: var(--chatgpt-radius-xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-r-xl"], [class~="rounded-tr-xl"]) {
  border-top-right-radius: var(--chatgpt-radius-xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-r-xl"], [class~="rounded-br-xl"]) {
  border-bottom-right-radius: var(--chatgpt-radius-xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-t-xl"], [class~="rounded-tl-xl"]) {
  border-top-left-radius: var(--chatgpt-radius-xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-t-xl"], [class~="rounded-tr-xl"]) {
  border-top-right-radius: var(--chatgpt-radius-xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-b-xl"], [class~="rounded-bl-xl"]) {
  border-bottom-left-radius: var(--chatgpt-radius-xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-b-xl"], [class~="rounded-br-xl"]) {
  border-bottom-right-radius: var(--chatgpt-radius-xl) !important;
}

:root[data-hermes-theme="chatgpt"] :where([class~="rounded-l-2xl"], [class~="rounded-tl-2xl"]) {
  border-top-left-radius: var(--chatgpt-radius-2xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-l-2xl"], [class~="rounded-bl-2xl"]) {
  border-bottom-left-radius: var(--chatgpt-radius-2xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-r-2xl"], [class~="rounded-tr-2xl"]) {
  border-top-right-radius: var(--chatgpt-radius-2xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-r-2xl"], [class~="rounded-br-2xl"]) {
  border-bottom-right-radius: var(--chatgpt-radius-2xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-t-2xl"], [class~="rounded-tl-2xl"]) {
  border-top-left-radius: var(--chatgpt-radius-2xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-t-2xl"], [class~="rounded-tr-2xl"]) {
  border-top-right-radius: var(--chatgpt-radius-2xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-b-2xl"], [class~="rounded-bl-2xl"]) {
  border-bottom-left-radius: var(--chatgpt-radius-2xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-b-2xl"], [class~="rounded-br-2xl"]) {
  border-bottom-right-radius: var(--chatgpt-radius-2xl) !important;
}

:root[data-hermes-theme="chatgpt"] :where([class~="rounded-l-3xl"], [class~="rounded-tl-3xl"]) {
  border-top-left-radius: var(--chatgpt-radius-3xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-l-3xl"], [class~="rounded-bl-3xl"]) {
  border-bottom-left-radius: var(--chatgpt-radius-3xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-r-3xl"], [class~="rounded-tr-3xl"]) {
  border-top-right-radius: var(--chatgpt-radius-3xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-r-3xl"], [class~="rounded-br-3xl"]) {
  border-bottom-right-radius: var(--chatgpt-radius-3xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-t-3xl"], [class~="rounded-tl-3xl"]) {
  border-top-left-radius: var(--chatgpt-radius-3xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-t-3xl"], [class~="rounded-tr-3xl"]) {
  border-top-right-radius: var(--chatgpt-radius-3xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-b-3xl"], [class~="rounded-bl-3xl"]) {
  border-bottom-left-radius: var(--chatgpt-radius-3xl) !important;
}
:root[data-hermes-theme="chatgpt"] :where([class~="rounded-b-3xl"], [class~="rounded-br-3xl"]) {
  border-bottom-right-radius: var(--chatgpt-radius-3xl) !important;
}

/* Surfaces and chrome */
:root[data-hermes-theme="chatgpt"] body,
:root[data-hermes-theme="chatgpt"] [data-contrib-shell],
:root[data-hermes-theme="chatgpt"] [data-slot="sidebar-wrapper"] {
  background-color: var(--ui-bg-chrome);
  color: var(--ui-text-primary);
}

:root[data-hermes-theme="chatgpt"] [data-slot="sidebar"],
:root[data-hermes-theme="chatgpt"] [data-tour="sessions-sidebar"] {
  background-color: var(--ui-sidebar-surface-background);
  border-color: var(--ui-stroke-secondary);
}

:root[data-hermes-theme="chatgpt"] [data-slot="statusbar"] {
  height: 1.5rem;
  background-color: var(--ui-sidebar-surface-background);
  border-top: 1px solid var(--ui-stroke-tertiary);
}

:root[data-hermes-theme="chatgpt"] [data-overlay-surface] {
  background-color: rgb(0 0 0 / 0.22);
  backdrop-filter: blur(var(--chatgpt-overlay-blur));
  -webkit-backdrop-filter: blur(var(--chatgpt-overlay-blur));
}

@media (max-width: 47.5rem) {
  :root[data-hermes-theme="chatgpt"] [data-overlay-surface] {
    padding: 1rem !important;
  }
}

:root[data-hermes-theme="chatgpt"]
  div[class~="border-b"]:has(> input[type="text"][aria-label]):has(> svg) {
  min-height: 2rem;
  padding: 0 0.5rem;
  border: 1px solid transparent !important;
  border-radius: var(--chatgpt-radius-md);
  background-color: var(--chatgpt-sidebar-search) !important;
  opacity: 1 !important;
  transition:
    background-color 100ms ease-out,
    border-color 150ms ease-out;
}

:root[data-hermes-theme="chatgpt"]
  div[class~="border-b"]:has(> input[type="text"][aria-label]):has(> svg):hover {
  background-color: var(--ui-control-hover-background) !important;
}

:root[data-hermes-theme="chatgpt"]
  div[class~="border-b"]:has(> input[type="text"][aria-label]):has(> svg):focus-within {
  border-color: color-mix(in srgb, var(--dt-ring) 55%, var(--ui-stroke-secondary)) !important;
}

:root[data-hermes-theme="chatgpt"]
  div[class~="border-b"]:has(> input[type="text"][aria-label]):has(> svg)
  input {
  height: auto;
}

:root[data-hermes-theme="chatgpt"] [data-glass-raised] {
  border-color: var(--ui-stroke-secondary) !important;
  border-radius: var(--chatgpt-radius-2xl) !important;
  box-shadow: var(--shadow-nous) !important;
}

:root[data-hermes-theme="chatgpt"] .titlebar-icon-button,
:root[data-hermes-theme="chatgpt"] [data-titlebar-cluster] button {
  border-radius: var(--chatgpt-radius-md) !important;
}

/* Sidebar, panel and settings rows use one row radius. */
:root[data-hermes-theme="chatgpt"] [data-tour="sessions-sidebar"] .row-hover,
:root[data-hermes-theme="chatgpt"] [data-tour="sessions-sidebar"] [data-slot="row-button"],
:root[data-hermes-theme="chatgpt"] [data-tour="sessions-sidebar"] [data-slot="sidebar-menu-button"],
:root[data-hermes-theme="chatgpt"] [data-tour="sessions-sidebar"] [data-slot="sidebar-menu-sub-button"],
:root[data-hermes-theme="chatgpt"] [data-tour="overlay-nav"] .row-hover,
:root[data-hermes-theme="chatgpt"] [data-panel-row],
:root[data-hermes-theme="chatgpt"] [data-panel-row] [data-slot="row-button"] {
  border-radius: var(--chatgpt-radius-md) !important;
}

:root[data-hermes-theme="chatgpt"] [data-tour="sessions-sidebar"] [data-slot="sidebar-content"] {
  padding-inline: 0.75rem;
}

:root[data-hermes-theme="chatgpt"] [data-tour="sessions-sidebar"] [data-slot="sidebar-menu"],
:root[data-hermes-theme="chatgpt"] [data-tour="sessions-sidebar"] [data-slot="sidebar-group-content"] {
  gap: 2px;
}

:root[data-hermes-theme="chatgpt"]
  [data-tour="sessions-sidebar"]
  div:has(> input[type="text"][aria-label]):has(> svg) {
  width: 100%;
}

:root[data-hermes-theme="chatgpt"] [data-tour="sessions-sidebar"] button[data-slot="context-menu-trigger"] {
  height: auto !important;
  min-height: 2rem !important;
  padding: 0.375rem 0.625rem !important;
}

:root[data-hermes-theme="chatgpt"] [data-tour="sessions-sidebar"] div[data-slot="context-menu-trigger"].row-hover {
  min-height: 2rem !important;
}

:root[data-hermes-theme="chatgpt"] [data-tour="overlay-nav"] .row-hover,
:root[data-hermes-theme="chatgpt"] [data-panel-row] {
  height: auto !important;
  min-height: 2rem !important;
}

:root[data-hermes-theme="chatgpt"] [data-tour="overlay-nav"] {
  gap: 4px;
}

:root[data-hermes-theme="chatgpt"]
  [data-tour="overlay-nav"]
  div:has(> button[data-tour^="nav-"]) {
  gap: 4px !important;
}

:root[data-hermes-theme="chatgpt"]
  [data-tour="overlay-nav"]
  > div:not(.relative):not([aria-hidden]) {
  margin-top: 2px;
}

:root[data-hermes-theme="chatgpt"] [data-panel-row] + [data-panel-row] {
  margin-top: 2px;
}

:root[data-hermes-theme="chatgpt"] [data-slot="profile-dropdown"] {
  min-height: 1.5rem !important;
  border-radius: var(--chatgpt-radius-md) !important;
  padding-inline: 0.5rem !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="kbd"] {
  border-radius: 0.25rem !important;
}

:root[data-hermes-theme="chatgpt"]
  :is([class~="rounded-[6px]"], [class~="rounded-[8px]"], [class~="rounded-[9px]"]) {
  border-radius: var(--chatgpt-radius-md) !important;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="tool-block"]
  [class~="rounded-[0.3125rem]"] {
  border-radius: var(--chatgpt-radius-md) !important;
}

:root[data-hermes-theme="chatgpt"]
  [class~="text-[0.64rem]"][class~="font-semibold"][class~="uppercase"][class~="tracking-[0.16em]"][class~="text-(--theme-primary)"] {
  color: var(--ui-text-tertiary) !important;
  font-weight: 500 !important;
  letter-spacing: 0.02em !important;
  text-transform: none !important;
}

:root[data-hermes-theme="chatgpt"]
  [class~="text-[0.64rem]"][class~="font-semibold"][class~="uppercase"][class~="tracking-[0.16em]"][class~="text-(--theme-primary)"]
  [class~="dither"] {
  display: none !important;
}

/* A closeable tab reserves 1.75rem on its right for the hover X. The tab must
   stay as tall as that reserved strip, or the close button overflows the tab's
   own rounded box and reads as a glyph floating outside it. */
:root[data-hermes-theme="chatgpt"] [data-slot="pane-tab"]:not([data-vertical]) {
  height: calc(100% - 0.25rem) !important;
  margin-block: 0.125rem;
  border-color: transparent !important;
  border-radius: var(--chatgpt-radius-md) !important;
  background-color: transparent !important;
  box-shadow: none !important;
  font-size: 0.75rem;
}

:root[data-hermes-theme="chatgpt"] [data-slot="pane-tab"][data-closeable] {
  min-height: 1.875rem;
}

:root[data-hermes-theme="chatgpt"] [role="tablist"]:has(> [data-slot="pane-tab"]) {
  align-items: center;
  gap: 2px;
  padding-inline: 4px;
}

:root[data-hermes-theme="chatgpt"]
  [role="tab"][data-closeable]
  > span:last-child
  > button
  svg {
  opacity: 0.7;
}

:root[data-hermes-theme="chatgpt"]
  [role="tab"][data-closeable]
  > span:last-child
  > button:hover
  svg {
  opacity: 1;
}

:root[data-hermes-theme="chatgpt"] [data-slot="pane-tab"]:not([data-vertical])[data-active="true"] {
  background-color: var(--ui-control-active-background) !important;
  color: var(--ui-text-primary) !important;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="pane-tab"]:not([data-vertical])[data-active="false"]:hover {
  background-color: var(--ui-control-hover-background) !important;
}

:root[data-hermes-theme="chatgpt"]
  [role="tablist"]:has(> [data-slot="pane-tab"])
  > [data-slot="pane-tab"][data-active="true"] {
  background-color: var(--ui-control-active-background) !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="pane-tab"][data-vertical] {
  border-radius: var(--chatgpt-radius-sm) !important;
  background-color: transparent !important;
  box-shadow: none !important;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="pane-tab"][data-vertical][data-active="true"] {
  background-color: var(--ui-control-active-background) !important;
  color: var(--ui-text-primary) !important;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="pane-tab"][data-vertical][aria-selected="true"] {
  background-color: var(--ui-control-active-background) !important;
  color: var(--ui-text-primary) !important;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="pane-tab"][data-vertical][data-active="false"]:hover {
  background-color: var(--ui-control-hover-background) !important;
}

/* Workspace session tabs are PaneTab markup wrapped by ContextMenuTrigger,
   so the wrapper overwrites data-slot. data-tree-tab survives the merge. */
:root[data-hermes-theme="chatgpt"] [role="tab"][data-tree-tab="workspace"] {
  height: calc(100% - 0.25rem) !important;
  min-width: 10rem;
  margin-block: 0.125rem;
  margin-inline: 1px;
  border-color: transparent !important;
  border-radius: var(--chatgpt-radius-md) !important;
  background-color: transparent !important;
  box-shadow: none !important;
  font-size: 0.75rem;
}

:root[data-hermes-theme="chatgpt"]
  [role="tab"][data-tree-tab="workspace"][aria-selected="true"] {
  background-color: var(--ui-control-active-background) !important;
  color: var(--ui-text-primary) !important;
}

:root[data-hermes-theme="chatgpt"]
  [role="tab"][data-tree-tab="workspace"]:not([aria-selected="true"]):hover {
  background-color: var(--ui-control-hover-background) !important;
}

:root[data-hermes-theme="chatgpt"] [role="tab"][data-closeable] {
  --pane-tab-close-width: 1.75rem;
}

:root[data-hermes-theme="chatgpt"]
  [role="tab"][data-tree-tab="workspace"][data-closeable] {
  padding-inline-end: 1.75rem !important;
}

:root[data-hermes-theme="chatgpt"]
  [role="tab"][data-closeable]
  > span:last-child {
  align-items: center;
  justify-content: center;
  width: var(--pane-tab-close-width);
}

:root[data-hermes-theme="chatgpt"]
  [role="tab"][data-closeable]
  > span:last-child
  > button {
  width: 1.5rem !important;
  height: 1.5rem !important;
  border-radius: var(--chatgpt-radius-sm) !important;
}

:root[data-hermes-theme="chatgpt"]
  [role="tab"][data-closeable]
  > span:last-child
  > button:hover {
  background-color: var(--ui-control-hover-background) !important;
}

/* The left titlebar cluster is positioned for the expanded sidebar. In the
   28px collapsed rail it overhangs the main pane, so center it on the rail. */
:root[data-hermes-theme="chatgpt"]
  [data-titlebar-cluster="left"]:has(> button[aria-expanded="false"]) {
  --titlebar-controls-left: 0.125rem !important;
}

/* Floating surfaces */
:root[data-hermes-theme="chatgpt"]
  :is(
    [data-slot="dropdown-menu-content"],
    [data-slot="dropdown-menu-sub-content"],
    [data-slot="context-menu-content"],
    [data-slot="context-menu-sub-content"],
    [data-slot="select-content"],
    [data-slot="popover-content"]
  ) {
  border-color: var(--ui-stroke-secondary) !important;
  border-radius: var(--chatgpt-radius-2xl) !important;
  box-shadow: var(--shadow-md) !important;
  backdrop-filter: blur(var(--chatgpt-overlay-blur)) saturate(1.08);
  -webkit-backdrop-filter: blur(var(--chatgpt-overlay-blur)) saturate(1.08);
}

:root[data-hermes-theme="chatgpt"] [role="dialog"][data-state]:not([data-variant="media-lightbox"]),
:root[data-hermes-theme="chatgpt"] [data-slot="dialog-content"]:not([data-variant="media-lightbox"]) {
  border: 1px solid var(--chatgpt-elevated-ring) !important;
  border-radius: var(--chatgpt-radius-2xl) !important;
  background-color: var(--chatgpt-elevated) !important;
  box-shadow:
    0 0 0 0.5px var(--chatgpt-elevated-ring),
    var(--chatgpt-elevated-shadow) !important;
  backdrop-filter: blur(var(--chatgpt-overlay-blur));
  -webkit-backdrop-filter: blur(var(--chatgpt-overlay-blur));
}

:root[data-hermes-theme="chatgpt"] [data-slot="dialog-content"][data-variant="media-lightbox"] {
  background: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

:root[data-hermes-theme="chatgpt"] [data-slot="dialog-content"] > div[class~="p-4"],
:root[data-hermes-theme="chatgpt"] [data-slot="dialog-content"] > div > div[class~="p-4"] {
  gap: 1rem !important;
  padding: 1.25rem !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="dialog-overlay"] {
  background-color: rgb(0 0 0 / 0.22);
  backdrop-filter: blur(var(--chatgpt-overlay-blur));
  -webkit-backdrop-filter: blur(var(--chatgpt-overlay-blur));
}

:root[data-hermes-theme="chatgpt"] [data-slot="sheet-content"] {
  border-color: var(--ui-stroke-secondary);
  background-color: var(--ui-sidebar-surface-background);
  box-shadow: var(--shadow-nous);
}

:root[data-hermes-theme="chatgpt"]
  :where(
    :is(
        [data-slot="dropdown-menu-item"],
        [data-slot="dropdown-menu-checkbox-item"],
        [data-slot="dropdown-menu-radio-item"],
        [data-slot="dropdown-menu-sub-trigger"],
        [data-slot="context-menu-item"],
        [data-slot="context-menu-checkbox-item"],
        [data-slot="context-menu-radio-item"],
        [data-slot="context-menu-sub-trigger"],
        [data-slot="select-item"],
        [data-slot="command-item"]
      ):not([class~="rounded-none"])
  ) {
  border-radius: var(--chatgpt-radius-md) !important;
  min-height: 1.875rem;
  padding-block: 0.375rem;
}

:root[data-hermes-theme="chatgpt"]
  :is(
    [data-slot="dropdown-menu-content"],
    [data-slot="dropdown-menu-sub-content"]
  )
  :is(
    [data-slot="dropdown-menu-item"],
    [data-slot="dropdown-menu-checkbox-item"],
    [data-slot="dropdown-menu-radio-item"],
    [data-slot="dropdown-menu-sub-trigger"]
  )[class~="rounded-none"] {
  border-radius: var(--chatgpt-radius-md) !important;
  min-height: 1.875rem !important;
  padding-block: 0.25rem !important;
}

:root[data-hermes-theme="chatgpt"]
  :is(
    [data-slot="dropdown-menu-content"][class~="p-0"],
    [data-slot="dropdown-menu-sub-content"][class~="p-0"]
  )
  :is(
    [data-slot="dropdown-menu-item"],
    [data-slot="dropdown-menu-checkbox-item"],
    [data-slot="dropdown-menu-radio-item"],
    [data-slot="dropdown-menu-sub-trigger"]
  )[class~="rounded-none"] {
  margin: 1px 0.25rem !important;
}

:root[data-hermes-theme="chatgpt"]
  :is([data-slot="dropdown-menu-content"], [data-slot="dropdown-menu-sub-content"])
  [data-slot="dropdown-menu-label"] {
  margin: 0 !important;
  padding-inline: 0.625rem !important;
  padding-block: 0.25rem 0.125rem !important;
  letter-spacing: 0.02em !important;
}

:root[data-hermes-theme="chatgpt"]
  :is([data-slot="dropdown-menu-content"], [data-slot="dropdown-menu-sub-content"])
  [data-slot="dropdown-menu-group"] {
  margin: 0 !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="command-item"] {
  min-height: 2rem;
}

:root[data-hermes-theme="chatgpt"] [data-slot="command"]:not([class~="rounded-none"]) {
  border-radius: var(--chatgpt-radius-2xl) !important;
}

:root[data-hermes-theme="chatgpt"]
  :is(
    [data-slot="dropdown-menu-separator"],
    [data-slot="context-menu-separator"],
    [data-slot="select-separator"],
    [data-slot="command-separator"]
  ) {
  margin-inline: 0.25rem;
  background-color: var(--ui-stroke-tertiary) !important;
}

:root[data-hermes-theme="chatgpt"]
  :is(
    [data-slot="dropdown-menu-item"]:focus,
    [data-slot="dropdown-menu-checkbox-item"]:focus,
    [data-slot="dropdown-menu-radio-item"]:focus,
    [data-slot="dropdown-menu-sub-trigger"]:focus,
    [data-slot="context-menu-item"]:focus,
    [data-slot="context-menu-checkbox-item"]:focus,
    [data-slot="context-menu-radio-item"]:focus,
    [data-slot="context-menu-sub-trigger"]:focus,
    [data-slot="select-item"]:focus,
    [data-slot="dropdown-menu-item"][data-highlighted],
    [data-slot="dropdown-menu-checkbox-item"][data-highlighted],
    [data-slot="dropdown-menu-radio-item"][data-highlighted],
    [data-slot="dropdown-menu-sub-trigger"][data-highlighted],
    [data-slot="context-menu-item"][data-highlighted],
    [data-slot="context-menu-checkbox-item"][data-highlighted],
    [data-slot="context-menu-radio-item"][data-highlighted],
    [data-slot="context-menu-sub-trigger"][data-highlighted],
    [data-slot="command-item"][data-selected="true"]
  ):not([data-variant="destructive"]):not(.text-destructive) {
  background-color: var(--chatgpt-menu-hover) !important;
}

:root[data-hermes-theme="chatgpt"]
  :is(
    [data-slot="dropdown-menu-content"][class~="p-0"] [data-kb-active],
    [data-slot="dropdown-menu-sub-trigger"][data-state="open"]
  ) {
  background-color: var(--ui-control-active-background) !important;
  color: var(--ui-text-primary) !important;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="dialog-content"]
  [data-slot="command"][class~="rounded-none"][class~="bg-card"]
  [data-slot="command-item"][class~="bg-primary"] {
  background-color: var(--ui-control-active-background) !important;
  color: var(--ui-text-primary) !important;
  box-shadow: inset 0 0 0 1px var(--ui-stroke-secondary);
  font-weight: 500;
}

:root[data-hermes-theme="chatgpt"] [data-slot="command"] {
  color: var(--ui-text-primary);
}

:root[data-hermes-theme="chatgpt"] [data-slot="command-input-wrapper"] {
  border-color: var(--ui-stroke-tertiary);
}

:root[data-hermes-theme="chatgpt"] [data-slot="command-group"] [cmdk-group-heading] {
  color: var(--ui-text-tertiary) !important;
  font-weight: 500 !important;
  letter-spacing: 0 !important;
  text-transform: none !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="tooltip-content"] {
  border: 1px solid var(--ui-stroke-secondary) !important;
  border-radius: var(--chatgpt-radius-2xl) !important;
  background-color: var(--dt-popover) !important;
  color: var(--dt-popover-foreground) !important;
  box-shadow: none !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="tooltip-arrow"] {
  fill: var(--dt-popover) !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="card-stack-surface"] {
  border-color: var(--chatgpt-elevated-ring) !important;
  border-radius: var(--chatgpt-radius-2xl) !important;
  background-color: var(--chatgpt-elevated) !important;
  box-shadow:
    0 0 0 0.5px var(--chatgpt-elevated-ring),
    var(--chatgpt-elevated-shadow) !important;
  backdrop-filter: blur(var(--chatgpt-overlay-blur));
  -webkit-backdrop-filter: blur(var(--chatgpt-overlay-blur));
}

:root[data-hermes-theme="chatgpt"] [data-slot="card-stack-edge"] {
  border-radius: var(--chatgpt-radius-2xl) !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="alert"] {
  border-radius: var(--chatgpt-radius-lg) !important;
}

/* Buttons and form controls */
:root[data-hermes-theme="chatgpt"]
  :where(
    :is(button, a)[data-size]:not([data-variant="text"]):not([data-variant="link"]):not([data-size="grip"]):not(
        [data-size^="icon"]
      ):not([class~="rounded-none"]):not([class*="rounded-l-"]):not([class*="rounded-r-"]):not(
        [class*="rounded-t-"]
      ):not([class*="rounded-b-"]):not([class*="rounded-full"])
  ) {
  border-radius: var(--chatgpt-radius-md) !important;
}

:root[data-hermes-theme="chatgpt"]
  :where(
    :is(button, a):is([data-size="icon-xs"], [data-size="icon-titlebar"]):not([class*="rounded-full"])
  ) {
  border-radius: var(--chatgpt-radius-md) !important;
}

:root[data-hermes-theme="chatgpt"]
  :where(:is(button, a):is([data-size="icon"], [data-size="icon-sm"]):not([class*="rounded-full"])) {
  border-radius: var(--chatgpt-radius-lg) !important;
}

:root[data-hermes-theme="chatgpt"]
  :where(:is(button, a)[data-size="icon-lg"]:not([class*="rounded-full"])) {
  border-radius: var(--chatgpt-radius-xl) !important;
}

:root[data-hermes-theme="chatgpt"] :where(:is(button, a)[data-size="micro"]) {
  border-radius: var(--chatgpt-radius-sm) !important;
}

:root[data-hermes-theme="chatgpt"]
  :where(:is(button, a)[data-size]:is([data-size="lg"])):not([data-variant="text"]):not([data-variant="link"]) {
  border-radius: var(--chatgpt-radius-lg) !important;
}

:root[data-hermes-theme="chatgpt"]
  :where(:is(button, a)[data-size][class~="rounded-r-none"]:not([class*="rounded-full"])) {
  border-top-left-radius: var(--chatgpt-radius-md) !important;
  border-bottom-left-radius: var(--chatgpt-radius-md) !important;
}

:root[data-hermes-theme="chatgpt"]
  :where(:is(button, a)[data-size][class~="rounded-l-none"]:not([class*="rounded-full"])) {
  border-top-right-radius: var(--chatgpt-radius-md) !important;
  border-bottom-right-radius: var(--chatgpt-radius-md) !important;
}

:root[data-hermes-theme="chatgpt"] :is(button, a)[data-size="default"]:not([data-variant="text"]):not(
    [data-variant="link"]
  ):not([data-size^="icon"]) {
  min-height: 2rem;
}

:root[data-hermes-theme="chatgpt"]
  :is(button, a)[data-size="sm"]:not([data-variant="text"]):not([data-variant="link"]) {
  min-height: 1.75rem;
}

:root[data-hermes-theme="chatgpt"]
  :is(button, a)[data-size="sm"]:is([data-variant="default"], [data-variant="destructive"]) {
  min-height: 2rem;
}

:root[data-hermes-theme="chatgpt"]
  :is(button, a)[data-size="xs"]:not([data-variant="text"]):not([data-variant="link"]) {
  min-height: 1.75rem;
}

:root[data-hermes-theme="chatgpt"]
  :is(button, a)[data-size="lg"]:not([data-variant="text"]):not([data-variant="link"]) {
  min-height: 2.5rem;
}

:root[data-hermes-theme="chatgpt"] :is(button, a)[data-variant="outline"] {
  background-color: var(--chatgpt-button-secondary) !important;
  border-color: transparent !important;
  box-shadow: none !important;
}

:root[data-hermes-theme="chatgpt"] :is(button, a)[data-variant="outline"]:hover {
  background-color: var(--ui-control-hover-background) !important;
}

:root[data-hermes-theme="chatgpt"] :is(button, a)[data-variant="default"] {
  background-color: var(--chatgpt-primary-button-bg) !important;
  color: var(--chatgpt-primary-button-fg) !important;
  box-shadow: none !important;
}

:root[data-hermes-theme="chatgpt"] :is(button, a)[data-variant="default"]:hover {
  background-color: var(--chatgpt-primary-button-hover) !important;
  color: var(--chatgpt-primary-button-fg) !important;
}

:root[data-hermes-theme="chatgpt"]
  :is(button, a)[data-variant="default"]:active:not(:disabled):not([aria-disabled="true"]) {
  background-color: var(--chatgpt-primary-button-active) !important;
}

:root[data-hermes-theme="chatgpt"]
  :is(button, a)[data-variant]:is([data-variant="outline"], [data-variant="secondary"], [data-variant="ghost"], [data-variant="chip"]):active:not(
    :disabled
  ):not([aria-disabled="true"]):not(.text-destructive) {
  background-color: var(--ui-control-active-background) !important;
  color: var(--ui-text-primary) !important;
}

:root[data-hermes-theme="chatgpt"] :is(button, a)[data-variant="destructive"] {
  background-color: var(--chatgpt-danger-fill) !important;
  color: var(--chatgpt-danger-ink) !important;
}

:root[data-hermes-theme="chatgpt"] :is(button, a)[data-variant="destructive"]:hover {
  background-color: color-mix(in oklab, var(--chatgpt-danger-fill) 90%, var(--ui-bg-chrome)) !important;
}

:root[data-hermes-theme="chatgpt"]
  :is(button, a)[data-variant="destructive"]:active:not(:disabled):not([aria-disabled="true"]) {
  background-color: color-mix(in oklab, var(--chatgpt-danger-fill) 82%, var(--ui-bg-chrome)) !important;
}

:root[data-hermes-theme="chatgpt"] :is(button, a)[data-size]:focus-visible {
  box-shadow: 0 0 0 0.1875rem color-mix(in srgb, var(--dt-ring) 46%, transparent) !important;
}

:root[data-hermes-theme="chatgpt"]:not(.dark) [class~="text-primary"] {
  color: var(--chatgpt-link) !important;
}

:root[data-hermes-theme="chatgpt"] :is(button, a)[data-variant="textStrong"] {
  color: var(--ui-text-secondary) !important;
  font-size: 0.75rem;
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_msg-actions"] :is(button, a)[data-size],
:root[data-hermes-theme="chatgpt"] [data-slot="aui_user-message-root"] :is(button, a)[data-size],
:root[data-hermes-theme="chatgpt"] :is(button, a)[data-variant="text"],
:root[data-hermes-theme="chatgpt"] :is(button, a)[data-variant="link"] {
  border-radius: 0 !important;
  box-shadow: none !important;
}

:root[data-hermes-theme="chatgpt"]
  :is([data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"], [data-slot="input-group"]) {
  border-color: var(--chatgpt-field-border) !important;
  border-radius: var(--chatgpt-radius-md) !important;
  background-color: var(--chatgpt-control) !important;
  box-shadow: none !important;
}

:root[data-hermes-theme="chatgpt"]
  :is([data-slot="input"], [data-slot="select-trigger"], [data-slot="input-group"]) {
  min-height: 2rem !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="input-group"] [data-slot="input"] {
  min-height: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

:root[data-hermes-theme="chatgpt"]
  :is(
    [data-slot="input"],
    [data-slot="textarea"],
    [data-slot="select-trigger"],
    [data-slot="input-group"]
  ):hover:not(:focus):not(:focus-within):not([data-state="open"]) {
  border-color: color-mix(
    in srgb,
    var(--chatgpt-field-border) 55%,
    var(--ui-stroke-primary)
  ) !important;
}

:root[data-hermes-theme="chatgpt"]
  :is(
    [data-slot="input"],
    [data-slot="textarea"],
    [data-slot="select-trigger"],
    [data-slot="input-group"]
  ):is(:focus, :focus-within, [data-state="open"]) {
  border-color: transparent !important;
  box-shadow: 0 0 0 1px var(--dt-ring) !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="textarea"] {
  min-height: 4rem;
}

:root[data-hermes-theme="chatgpt"] [data-slot="checkbox"],
:root[data-hermes-theme="chatgpt"] [data-slot="checkbox-mark"] {
  border-color: var(--ui-stroke-primary) !important;
  border-radius: 0.25rem !important;
}

:root[data-hermes-theme="chatgpt"]
  :is([data-slot="checkbox"], [data-slot="checkbox-mark"])[data-state="checked"],
:root[data-hermes-theme="chatgpt"]
  :is([data-slot="checkbox"], [data-slot="checkbox-mark"])[data-state="indeterminate"] {
  border-color: var(--dt-primary) !important;
  background-color: var(--dt-primary) !important;
  color: var(--dt-primary-foreground) !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="switch"] {
  width: 2rem !important;
  height: 1.25rem !important;
  border-color: transparent !important;
  background-color: var(--chatgpt-track-off) !important;
  box-shadow: none !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="switch"][data-state="checked"] {
  background-color: var(--dt-primary) !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="switch-thumb"] {
  width: 1rem !important;
  height: 1rem !important;
  background-color: #ffffff !important;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.2) !important;
  transform: none !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="switch"][data-state="unchecked"] [data-slot="switch-thumb"] {
  translate: 0.125rem 0 !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="switch"][data-state="checked"] [data-slot="switch-thumb"] {
  translate: 0.875rem 0 !important;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="switch"][class~="h-4"][class~="w-7"] {
  width: 1.75rem !important;
  height: 1rem !important;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="switch"][class~="h-4"][class~="w-7"]
  [data-slot="switch-thumb"] {
  width: 0.75rem !important;
  height: 0.75rem !important;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="switch"][class~="h-4"][class~="w-7"][data-state="checked"]
  [data-slot="switch-thumb"] {
  translate: 0.75rem 0 !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="tabs-list"] {
  height: 2.375rem !important;
  border-radius: var(--chatgpt-radius-lg) !important;
  background-color: var(--ui-bg-tertiary);
}

:root[data-hermes-theme="chatgpt"] [data-slot="tabs-trigger"] {
  height: 1.875rem !important;
  border-radius: var(--chatgpt-radius-md) !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="tabs-trigger"][data-state="inactive"]:hover {
  background-color: var(--ui-control-hover-background);
}

:root[data-hermes-theme="chatgpt"] [data-slot="tabs-trigger"][data-state="active"] {
  background-color: var(--dt-card);
  box-shadow: var(--shadow-xs);
}

:root[data-hermes-theme="chatgpt"] [data-slot="badge"] {
  border-radius: 0.375rem !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="pagination-button"],
:root[data-hermes-theme="chatgpt"] [data-slot="pagination-previous"],
:root[data-hermes-theme="chatgpt"] [data-slot="pagination-next"] {
  border-radius: var(--chatgpt-radius-sm) !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="slider"] {
  accent-color: var(--dt-primary);
}

:root[data-hermes-theme="chatgpt"]
  div[class~="inline-grid"][class~="grid-flow-col"][class~="rounded-[5px]"] {
  min-height: 1.875rem !important;
  border-radius: var(--chatgpt-radius-md) !important;
  padding: 0.1875rem !important;
}

:root[data-hermes-theme="chatgpt"]
  div[class~="inline-grid"][class~="grid-flow-col"][class~="rounded-[5px]"] > button {
  min-height: 1.5rem !important;
  border-radius: var(--chatgpt-radius-sm) !important;
  font-size: 0.75rem !important;
}

:root[data-hermes-theme="chatgpt"]
  div[class~="inline-grid"][class~="grid-flow-col"][class~="rounded-[5px]"]
  > button[aria-pressed="true"] {
  background-color: var(--ui-bg-elevated) !important;
  color: var(--ui-text-primary) !important;
  box-shadow: var(--shadow-xs) !important;
}

:root[data-hermes-theme="chatgpt"]
  :is([data-tour="page-tabs"] button, button[class~="group/text-tab"]) {
  height: 2rem !important;
  min-height: 2rem !important;
  padding-inline: 0.625rem !important;
  border-radius: var(--chatgpt-radius-md) !important;
  background-color: transparent !important;
  color: var(--ui-text-secondary) !important;
  text-decoration: none !important;
}

:root[data-hermes-theme="chatgpt"]
  :is([data-tour="page-tabs"] button, button[class~="group/text-tab"]):hover {
  background-color: var(--ui-control-hover-background) !important;
  color: var(--ui-text-primary) !important;
}

:root[data-hermes-theme="chatgpt"]
  :is([data-tour="page-tabs"] button, button[class~="group/text-tab"])[data-active="true"] {
  background-color: var(--ui-bg-elevated) !important;
  color: var(--ui-text-primary) !important;
  box-shadow:
    0 0 0 0.5px var(--ui-stroke-secondary),
    var(--shadow-xs) !important;
}

:root[data-hermes-theme="chatgpt"]
  :is([data-tour="page-tabs"] button, button[class~="group/text-tab"])
  span {
  text-decoration-line: none !important;
}

:root[data-hermes-theme="chatgpt"]
  :is([data-tour="page-tabs"] button, button[class~="group/text-tab"])
  > span + span {
  padding: 0.0625rem 0.3125rem;
  border-radius: 0.375rem;
  background-color: var(--ui-bg-tertiary);
  color: var(--ui-text-tertiary) !important;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 47.5rem) {
  :root[data-hermes-theme="chatgpt"] [data-tour="page-tabs"] button {
    background-color: var(--ui-bg-elevated) !important;
    box-shadow:
      0 0 0 0.5px var(--ui-stroke-secondary),
      var(--shadow-xs) !important;
  }
}

/* Transcript typography */
:root[data-hermes-theme="chatgpt"] [data-slot="aui_thread-content"],
:root[data-hermes-theme="chatgpt"] [data-slot="aui_user-message-root"] .composer-human-message,
:root[data-hermes-theme="chatgpt"] [data-slot="composer-rich-input"] {
  -webkit-locale: "en";
}

:root[data-hermes-theme="chatgpt"] [data-slot="composer-rich-input"] {
  font-family: var(--dt-font-sans) !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_assistant-message-content"] {
  font-size: var(--conversation-text-font-size);
  line-height: var(--dt-line-height);
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_assistant-message-content"] .aui-md {
  line-height: var(--dt-line-height);
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_assistant-message-content"] .aui-md :where(p) {
  margin-block: var(--paragraph-gap) 0;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="aui_assistant-message-content"]
  .aui-md
  :where(h1, h2, h3, h4) {
  font-weight: 600;
  letter-spacing: -0.012em;
  line-height: 1.35;
  margin-block: 1.5rem 0.5rem;
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_assistant-message-content"] .aui-md :where(h1) {
  font-size: 1.375em;
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_assistant-message-content"] .aui-md :where(h2) {
  font-size: 1.25em;
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_assistant-message-content"] .aui-md :where(h3) {
  font-size: 1.125em;
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_assistant-message-content"] .aui-md :where(h4) {
  font-size: 1em;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="aui_assistant-message-content"]
  .aui-md
  :where(ul, ol) {
  margin-block: 0.625rem;
  padding-left: 1.35em;
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_assistant-message-content"] .aui-md :where(li) {
  margin-block: 0.3rem;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="aui_assistant-message-content"]
  .aui-md
  :where(blockquote) {
  margin-block: 0.75rem;
  padding: 0.25rem 0 0.25rem 0.9rem;
  border-left: 2px solid var(--ui-stroke-secondary);
  color: var(--ui-text-secondary);
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="aui_assistant-message-content"]
  .aui-md
  :where(th, td) {
  border-color: var(--ui-stroke-tertiary);
  padding: 0.45rem 0.75rem;
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_assistant-message-content"] .aui-md :where(th) {
  font-weight: 600;
}

:root[data-hermes-theme="chatgpt"]
  :is(
    [data-slot="aui_assistant-message-content"] .aui-md :not(pre) > code,
    [data-slot="aui_user-inline-code"]
  ) {
  border-radius: 0.25rem;
  background: var(--ui-inline-code-background);
  color: var(--ui-inline-code-foreground);
  font-size: 0.88em;
  padding: 0.08em 0.3em;
}

:root[data-hermes-theme="chatgpt"]
  :is([data-slot="code-card"], [data-slot="aui_user-fence"], [data-streamdown="code-block"]) {
  border-radius: var(--chatgpt-radius-lg) !important;
  background-color: var(--chatgpt-code-surface) !important;
  box-shadow: none !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="code-card"] pre {
  border-radius: inherit;
}

/* User messages */
:root[data-hermes-theme="chatgpt"] .composer-human-message {
  border: 0 !important;
  border-radius: var(--chatgpt-radius-2xl) !important;
  background-color: var(--dt-user-bubble) !important;
  box-shadow: none !important;
  padding: 0.625rem 0.875rem;
  line-height: var(--dt-line-height);
  --human-msg-line-height: var(--dt-line-height);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_user-message-root"] [data-slot="aui_user-bubble-actions"] {
  width: fit-content;
  max-width: min(78%, 44rem);
  margin-inline-start: auto;
  overflow-wrap: anywhere;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="aui_user-message-root"]
  [data-slot="aui_user-bubble-actions"]
  .composer-human-message {
  width: fit-content;
  max-width: 100%;
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_user-inline-text"] {
  line-height: var(--dt-line-height);
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_user-bubble-actions"] {
  border-radius: var(--chatgpt-radius-2xl);
}

/* Tool rows, status stack and approvals */
:root[data-hermes-theme="chatgpt"] [data-conversation-scaffold] {
  color: var(--conversation-scaffold-text);
  opacity: 0.8;
}

:root[data-hermes-theme="chatgpt"] [data-slot="status-row"] {
  border-radius: var(--chatgpt-radius-md) !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="tool-block"] {
  min-width: 0;
  max-width: 100%;
}

:root[data-hermes-theme="chatgpt"] [data-slot="composer-status-stack"] > div {
  border-color: var(--ui-stroke-secondary) !important;
  border-radius: var(--chatgpt-radius-2xl) var(--chatgpt-radius-2xl) 0 0 !important;
  background-color: var(--composer-fill) !important;
  box-shadow: none !important;
  backdrop-filter: blur(0.75rem) saturate(1.12);
  -webkit-backdrop-filter: blur(0.75rem) saturate(1.12);
}

:root[data-hermes-theme="chatgpt"] [data-slot="tool-approval-card"] {
  border-radius: inherit;
}

:root[data-hermes-theme="chatgpt"] [data-slot="tool-approval-actions"] [data-slot="button"] {
  border-radius: var(--chatgpt-radius-md) !important;
}

/* Composer */
:root[data-hermes-theme="chatgpt"] [data-slot="composer-root"] {
  --composer-fill: color-mix(in srgb, var(--dt-card) 82%, transparent);
  border-radius: var(--chatgpt-radius-3xl) !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="composer-root"][data-thread-scrolled-up] {
  --composer-fill: color-mix(in srgb, var(--dt-card) 74%, transparent);
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="composer-dock"]:is(:hover, :focus-within)
  [data-slot="composer-root"][data-thread-scrolled-up] {
  --composer-fill: color-mix(in srgb, var(--dt-card) 82%, transparent);
}

:root[data-hermes-theme="chatgpt"] [data-slot="composer-surface"] {
  border: 1px solid var(--ui-stroke-secondary) !important;
  border-radius: var(--chatgpt-radius-3xl) !important;
  background-color: var(--chatgpt-composer) !important;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.04),
    0 2px 8px rgb(0 0 0 / 0.04),
    0 4px 80px 8px rgb(0 0 0 / 0.025) !important;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    opacity 150ms ease-out;
}

:root[data-hermes-theme="chatgpt"].dark [data-slot="composer-surface"] {
  border-color: rgb(255 255 255 / 0.12) !important;
  box-shadow: inset 0 0 1px 0 rgb(255 255 255 / 0.2) !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="composer-surface"]:focus-within {
  border-color: color-mix(in srgb, var(--dt-composer-ring) 68%, var(--ui-stroke-secondary)) !important;
}

/* Hermes loads its own stylesheets AFTER the injected skin <style>, so a
   variable override on :root loses to the host's later declaration. Padding is
   therefore written straight onto the surface, as longhands with !important,
   which no later host rule can beat. */
:root[data-hermes-theme="chatgpt"] [data-slot="composer-fade"] {
  padding-inline: 1rem !important;
  padding-block: 0.75rem 0.625rem !important;
}

/* The control row is a three-column grid (menu / input / controls). Both edge
   columns carry the surface's own 1rem padding, so the leading "+" and the
   trailing send cluster sit one full gutter from the rounded edge instead of
   kissing it. */
:root[data-hermes-theme="chatgpt"] [data-slot="composer-fade"] [class~="[grid-area:menu]"] {
  padding-inline-start: 0;
  margin-inline-start: -0.125rem;
  transform: none !important;
  translate: 0 !important;
  align-self: center !important;
  align-items: center !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="composer-fade"] [class~="[grid-area:menu]"] > button {
  border-radius: 9999px !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="composer-rich-input"] {
  min-height: 2.75rem;
  padding-block: 0.5rem 0.25rem !important;
  padding-inline: 0.25rem !important;
  line-height: var(--dt-line-height);
  font-size: var(--conversation-text-font-size);
}

/* The voice primary and its engine picker ship as a fused split control. In the
   composer the primary must stay the rightmost, fully round action, so the
   engine picker becomes a separate round ghost button to its left. */
:root[data-hermes-theme="chatgpt"]
  [data-slot="composer-fade"]
  span:has(> button[class~="rounded-l-none"]) {
  gap: 0.25rem;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="composer-fade"]
  span:has(> button[class~="rounded-l-none"])
  > button[class~="rounded-l-none"] {
  order: -1;
  width: var(--composer-control-size) !important;
  height: var(--composer-control-size) !important;
  border-radius: 9999px !important;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="composer-fade"]
  span:has(> button[class~="rounded-l-none"])
  > button[class~="rounded-r-none"] {
  border-radius: 9999px !important;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="composer-fade"]
  :is([data-tour="model-pill"], [data-testid="reasoning-pill"]) {
  border-radius: 9999px !important;
  padding-inline: 0.65rem !important;
}

:root[data-hermes-theme="chatgpt"]
  [data-slot="composer-fade"]
  button[type="submit"]:disabled {
  background-color: var(--chatgpt-track-off) !important;
  color: var(--ui-text-tertiary) !important;
  opacity: 1 !important;
}

:root[data-hermes-theme="chatgpt"] [data-slot="composer-attachments"] {
  padding-inline: 0;
}

:root[data-hermes-theme="chatgpt"] [data-slot="composer-completion-drawer"] {
  border-color: var(--ui-stroke-secondary);
  border-radius: var(--chatgpt-radius-2xl);
  background-color: var(--chatgpt-elevated);
  box-shadow:
    0 0 0 0.5px var(--chatgpt-elevated-ring),
    var(--chatgpt-elevated-shadow);
  backdrop-filter: blur(var(--chatgpt-overlay-blur));
  -webkit-backdrop-filter: blur(var(--chatgpt-overlay-blur));
}

/* Media and empty chat */
:root[data-hermes-theme="chatgpt"]
  :is(
    [data-slot="aui_markdown-image"] img,
    [data-slot="aui_generated-image"] img,
    [data-slot="aui_embedded-images"] img,
    [data-slot="aui_artifact-card"]
  ) {
  border-radius: var(--chatgpt-radius-lg);
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_intro"] .wordmark {
  width: min(20rem, 72vw, calc(100% - 1rem)) !important;
  color: var(--ui-text-primary) !important;
  font-family: var(--dt-font-sans);
  font-weight: 600;
  letter-spacing: -0.035em;
  text-transform: none;
  mix-blend-mode: normal;
}

:root[data-hermes-theme="chatgpt"] [data-slot="aui_intro"] p:last-child {
  color: var(--ui-text-tertiary);
}

/* Selection and scrollbars */
:root[data-hermes-theme="chatgpt"] ::selection {
  background: var(--ui-selection-background);
}

@supports (corner-shape: superellipse(1.5)) {
  :root[data-hermes-theme="chatgpt"] [class*="rounded"]:not([class*="rounded-full"]) {
    corner-shape: superellipse(1.5);
  }
}
`

function buildTheme() {
  return {
    name: THEME_NAME,
    label: 'ChatGPT',
    description:
      'The ChatGPT desktop visual language for Hermes: graphite and paper surfaces, neutral row states, OpenAI radii, hairline edges, quiet overlays, and a frosted composer.',
    colors: light,
    darkColors: dark,
    typography,
    terminal,
    darkTerminal,
    customCSS: css
  }
}

const LOCALES = {
  en: {
    apply: 'Theme: Apply ChatGPT Skin'
  },
  zh: {
    apply: '主题：应用 ChatGPT 皮肤'
  }
}

export default {
  id: ID,
  name: 'ChatGPT Skin',
  description: 'ChatGPT desktop styling for Hermes: light and dark palettes, geometry, and component states.',
  register(ctx) {
    ctx.i18n.register(LOCALES)

    const disposers = ctx.registerMany([
      {
        id: 'theme',
        area: THEMES_AREA,
        data: buildTheme()
      },
      {
        id: 'apply',
        area: PALETTE_AREA,
        data: {
          id: 'chatgpt-skin.apply',
          label: ctx.i18n.t('apply'),
          keywords: ['chatgpt', 'theme', 'skin', 'openai', 'appearance', 'theme', 'skin'],
          run: () => requestTheme(THEME_NAME)
        }
      }
    ])

    // Installing is an explicit act. Apply once, then respect later manual picks.
    if (!ctx.storage.get('installed', false)) {
      ctx.storage.set('installed', true)
      requestTheme(THEME_NAME)
    }

    ctx.onDispose(disposers)
    console.log('[hermes-chatgpt-skin] registered')
  }
}

export { buildTheme, css, dark, light, THEME_NAME, typography }
