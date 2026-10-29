# Hermes Selector Audit

## Baseline

- Hermes source: `/Users/verger/.hermes/hermes-agent`
- Revision checked: `79f7de0f82736071709694c6e9a95c9fedef7828`
- Plugin entry: `desktop/plugin.js`
- Theme name: `chatgpt`

The plugin is loaded by Hermes Desktop from
`$HERMES_HOME/desktop-plugins/hermes-chatgpt-skin/plugin.js` (the published desktop half). It uses only the
desktop plugin SDK and the sanctioned `DesktopTheme.customCSS` field.

## Selector Policy

Selectors are deliberately ordered by durability:

1. semantic UI tokens (`--ui-*`, `--dt-*`, `--sidebar-*`, `--composer-*`);
2. source-owned primitive markers (`data-slot`);
3. source-owned navigation markers (`data-tour`);
4. semantic roles and states (`role`, `data-state`, `aria-*`);
5. a narrow class-token fallback only where a primitive has no marker.

The stylesheet is scoped to `:root[data-hermes-theme="chatgpt"]`. Hermes sets
that attribute before injecting the theme CSS and removes the style element
when the user switches themes.

## Front-End Inventory

### Shell and navigation

| Surface | Source | Hook |
| --- | --- | --- |
| App shell | `apps/desktop/src/app/contrib/controller.tsx` | `data-contrib-shell` |
| Sessions sidebar | `apps/desktop/src/app/chat/sidebar/index.tsx` | `data-tour="sessions-sidebar"` |
| Sidebar primitives | `apps/desktop/src/components/ui/sidebar.tsx` | `data-slot="sidebar*"` |
| Session and panel rows | `sidebar/session-row.tsx`, `overlays/panel.tsx` | `.row-hover`, `data-panel-row`, `data-slot="row-button"` |
| Sidebar section labels | `apps/desktop/src/app/shell/sidebar-label.tsx` | exact class-token signature; dither mark hidden |
| Status bar | `apps/desktop/src/app/shell/statusbar-controls.tsx` | `data-slot="statusbar"` |
| Titlebar controls | `apps/desktop/src/app/shell/titlebar-controls.tsx` | `.titlebar-icon-button`, `[data-titlebar-cluster]` |
| Pane tabs | `apps/desktop/src/components/ui/pane-tab.tsx` | `data-slot="pane-tab"` |
| Route overlays | `apps/desktop/src/app/overlays/overlay-view.tsx` | `data-overlay-surface`, `data-glass-raised` |
| Overlay navigation | `apps/desktop/src/app/overlays/overlay-split-layout.tsx` | `data-tour="overlay-nav"` |

### Top-level routes

| Route | Source |
| --- | --- |
| Chat and new chat | `app/chat/index.tsx` |
| Settings | `app/settings/index.tsx` |
| Command Center | `app/command-center/index.tsx` |
| Session import | `app/session-import/index.tsx` |
| Capabilities | `app/capabilities/index.tsx` |
| Messaging | `app/messaging/index.tsx` |
| Webhooks | `app/webhooks/index.tsx` |
| Artifacts | `app/artifacts/index.tsx` |
| Cron | `app/cron/index.tsx` |
| Profiles | `app/profiles/index.tsx` |
| Agents | `app/agents/index.tsx` |
| Starmap | `app/starmap/index.tsx` |

These pages share the same overlay, row, card, form, menu, dialog, and table
primitives, so they inherit the skin without page-specific color literals.

### Settings destinations

The settings route is one shell with nested sections and subpages:

- Appearance: general, theme, typography, window layout, chat display, pet.
- Model: main, fallbacks, auxiliary, delegation, Mixture of Agents.
- Chat: behavior, attachments.
- Workspace: projects, shell, files.
- Safety: approvals, privacy, checkpoints.
- Browser: profile, network.
- Memory & Context: persistent memory, context/compression.
- Voice: conversation, transcription, speech.
- Advanced: desktop, runtime, tools, terminal, output.
- Gateways: connection, devices, managed updates.
- Billing: overview, plans.
- Keyboard: shortcuts, HUD gesture, screen capture.
- Notifications: alerts, sounds.
- Sessions: archived, default directory.
- Vault: credentials, sources.
- About: updates, uninstall.
- Providers, API keys, Plugins, and per-plugin settings pages.

Source: `app/settings/subpages.ts`, `constants.ts`, and each setting component
under `app/settings/`.

### Panes and working surfaces

| Surface | Source | Hook |
| --- | --- | --- |
| Chat workspace | `app/chat/index.tsx` | `data-chat-surface` |
| Files pane | `app/right-sidebar/index.tsx`, `files/tree.tsx` | shared row/tree primitives |
| Review pane | `app/right-sidebar/review/*` | shared rows, diffs, buttons |
| Terminal | `app/right-sidebar/terminal/*` | terminal theme tokens |
| Logs/browser/preview | `app/right-sidebar/*`, chat log components | shared surface tokens |
| Composer | `app/chat/composer/index.tsx` | `data-slot="composer-*"` |
| Composer status stack | `app/chat/composer/status-stack/index.tsx` | `data-slot="composer-status-stack"` |

### Overlays and navigation

| Surface | Source | Hook |
| --- | --- | --- |
| Dropdown menu | `components/ui/dropdown-menu.tsx` | `data-slot="dropdown-menu-content"` |
| Context menu | `components/ui/context-menu.tsx` | `data-slot="context-menu-content"` |
| Select | `components/ui/select.tsx` | `data-slot="select-content"` |
| Popover | `components/ui/popover.tsx` | `data-slot="popover-content"` |
| Dialog / alert dialog | `components/ui/dialog.tsx` and Radix roles | `role="dialog"`, `data-slot="dialog-content"` |
| Side sheet | `components/ui/sheet.tsx` | `data-slot="sheet-content"` |
| Tooltip | `components/ui/tooltip.tsx` | `data-slot="tooltip-content"` |
| Command palette | `app/command-palette/index.tsx` | Radix dialog content, `data-slot="command"` |
| Toast and approval stack | `components/notifications.tsx`, `components/ui/card-stack.tsx` | `data-slot="card-stack-surface"` |
| Inline approval card | `components/assistant-ui/tool/approval.tsx` | `data-slot="tool-approval-card"` |

### Shared controls

| Family | Source | Hook or token |
| --- | --- | --- |
| Button and icon button | `components/ui/button.tsx` | `data-slot="button"`, `data-variant`, `data-size` |
| Input / Textarea | `components/ui/input.tsx`, `textarea.tsx` | `data-slot="input"`, `data-slot="textarea"` |
| Input group | `components/ui/input.tsx` | `data-slot="input-group"` |
| Select trigger | `components/ui/select.tsx` | `data-slot="select-trigger"` |
| Search field | `components/ui/search-field.tsx` | shared search chrome |
| Switch | `components/ui/switch.tsx` | `data-slot="switch"`, `data-slot="switch-thumb"` |
| Checkbox | `components/ui/checkbox.tsx` | `data-slot="checkbox"` |
| Slider | `components/ui/slider.tsx` | `data-slot="slider"` |
| Tabs | `components/ui/tabs.tsx` | `data-slot="tabs-list"`, `data-slot="tabs-trigger"` |
| Segmented control | `components/ui/segmented-control.tsx` | narrow class-token fallback |
| Badge | `components/ui/badge.tsx` | `data-slot="badge"` |
| Alert | `components/ui/alert.tsx` | `data-slot="alert"` |
| Progress | `components/ui/progress.tsx` | semantic primary / destructive tokens |
| Pagination | `components/ui/pagination.tsx` | `data-slot="pagination-*"` |
| Empty / error / loading | `components/ui/empty-state.tsx`, `error-state.tsx`, `loader.tsx` | shared text and semantic tokens |

### Complete shared primitive inventory

The source audit checks every primitive family that can appear inside a route,
overlay, pane, or transcript surface:

| Primitive | Source | Skin coverage |
| --- | --- | --- |
| Alert | `alert.tsx` | semantic surface tokens, 12.5px radius |
| Badge / Pill | `badge.tsx` | compact 6px radius, semantic tones |
| Button | `button.tsx` | 10px controls, 10–15px icon ladder, inverse primary fill |
| Card stack / toast | `card-stack.tsx` | 20px raised surface and edge |
| Checkbox | `checkbox.tsx` | 4px box, blue checked state |
| Command / command palette | `command.tsx` | 20px palette shell, 32px rows, 10px row radius |
| Connector card / row | `connector-card.tsx` | shared widget surface and semantic text tokens |
| Context menu | `context-menu.tsx` | 20px surface, 30px rows, inset separators |
| Dialog | `dialog.tsx` | 20px shell, 20px body padding, inverse primary action |
| Dropdown menu | `dropdown-menu.tsx` | 20px surface, 30px rows, neutral hover; compact/searchable rows get 10px inset corners |
| Fan menu | `fan-menu.tsx` | shared button, tooltip, and popover treatment |
| Input / textarea / input group | `input.tsx`, `textarea.tsx` | 32px field, 10px radius, transparent dark edge |
| Kbd | `kbd.tsx` | 4px keycap |
| Pagination | `pagination.tsx` | 7.5px compact controls |
| Pane tab | `pane-tab.tsx` | 24–30px rounded tab, neutral active fill |
| Popover | `popover.tsx` | 20px floating surface, menu rows inherit menu geometry |
| Progress / slider | `progress.tsx`, `slider.tsx` | blue accent on neutral track |
| Scroll area | `scroll-area.tsx` | themed hover-only thumb |
| Select | `select.tsx` | 32px trigger, 20px menu, 30px options |
| Separator | `separator.tsx` | hairline tertiary stroke |
| Sheet | `sheet.tsx` | sidebar surface, 20px edge treatment |
| Search field | `search-field.tsx` | 32px underline fields, 10px inset fill, visible empty state |
| Sidebar | `sidebar.tsx` | 32px rows, 10px row radius, sub-row coverage |
| Skeleton | `skeleton.tsx` | 10px base radius and neutral pulse |
| Switch | `switch.tsx` | 32×20 default and 28×16 compact, 16/12px thumbs |
| Tabs | `tabs.tsx` | 38px track, 30px trigger, 12.5px track radius |
| Text tab / responsive tabs | `text-tab.tsx`, `tab-dropdown.tsx` | 32px pill tabs, active raised surface |
| Tooltip | `tooltip.tsx` | 20px compact tip, hairline edge, no shadow |

### Chat transcript

| Surface | Source | Hook |
| --- | --- | --- |
| Thread content | `components/assistant-ui/thread/*` | `data-slot="aui_thread-content"` |
| User message | `components/assistant-ui/thread/user-message.tsx` | `data-slot="aui_user-message-root"` |
| User bubble wrapper | same | `data-slot="aui_user-bubble-actions"` |
| User bubble | same | `.composer-human-message` |
| Assistant prose | same | `data-slot="aui_assistant-message-content"` |
| Markdown headings, lists, tables, quotes | assistant-ui renderer | scoped `.aui-md` nodes |
| Inline code | assistant-ui renderer | scoped inline-code tokens |
| Code card | `components/chat/code-card.tsx` | `data-slot="code-card"`, `data-slot="code-card-body"` |
| Tool rows | `components/assistant-ui/tool/fallback.tsx` | `data-slot="tool-block"`, `data-tool-row` |
| Thinking and run scaffolding | `components/chat/*` | `data-conversation-scaffold` |
| File diffs | `components/chat/diff-lines.tsx` | `data-slot="file-diff-panel"` |
| Images and artifacts | assistant-ui embed components | `data-slot="aui_*image*"`, `aui_artifact-card` |
| Empty chat intro | `components/assistant-ui/*` | `data-slot="aui_intro"` |

### Composer

| Surface | Source | Hook |
| --- | --- | --- |
| Dock/root/surface | `app/chat/composer/index.tsx` | `data-slot="composer-dock"`, `composer-root`, `composer-surface` |
| Editable field | `app/chat/composer/index.tsx` | `data-slot="composer-rich-input"` |
| Control row | `app/chat/composer/controls.tsx` | composer control-size tokens |
| Model / reasoning pills | `model-pill.tsx`, `reasoning-pill.tsx` | `data-tour="model-pill"`, `data-testid="reasoning-pill"` |
| Completion drawer | `completion-drawer.tsx` | `data-slot="composer-completion-drawer"` |
| Attachments | `attachments.tsx` | `data-slot="composer-attachments"` |
| Queue and status rows | `status-stack/*` | `data-slot="composer-status-stack"`, `data-slot="status-row"` |
| Send / stop | `controls.tsx`, `control-classes.ts` | submit button, `rounded-full` exclusion |

## Intentional Limits

- Hermes does not let a theme supply a Shiki grammar or token map. The skin
  themes every code surface around Shiki but leaves syntax colors to Hermes.
- Some composed controls do not expose a `data-slot`. The segmented control and
  media-lightbox shell keep narrow class-token rules because that is the
  smallest source-owned seam available. `SidebarPanelLabel` is matched by its
  full independent class-token signature so its brand-blue heading and dither
  mark can become the neutral ChatGPT section label.
- The skin changes geometry as well as color. It does not preserve the stock
  2.5px button/input radius, because the larger OpenAI radius ladder is part of
  the design language.
- Plugin custom CSS is a renderer surface. A future Hermes DOM refactor can
  invalidate a selector; `npm run audit:source` is the tripwire for that.

## Interaction-State Audit

The first passes were surface-first: they checked tokens, slot hooks, and the
outer shell of each component. That missed state and container layers:

- `dropdownMenuRow` deliberately sets `rounded-none` for edge-to-edge compact
  menus, so the shared rounded menu rule skipped model, reasoning, voice, and
  connector menus entirely;
- searchable menus suppress Radix's hover-to-focus and report hover through
  `data-highlighted`; sub-triggers, radio items, and checkbox items were not in
  the first state selector;
- the selected model uses `data-kb-active`, and an open submenu uses
  `data-state="open"`; neither is a `:focus` or `:hover` state;
- menu content with `p-0` gives the surface its 20px radius but leaves rows
  flush to the edge; the radius has to be paired with row inset;
- settings navigation spacing is owned by nested containers (`gap-0.5`,
  `ml-3.5`), not by the row buttons alone;
- `SearchField` has underline and box variants; styling one sidebar instance
  did not cover the other underline fields across overlays and page headers.

The contract now audits normal, hover, keyboard-selected, open, and compact
row states as separate families:

| Family | Durable state hook | Applied treatment |
| --- | --- | --- |
| Compact menu rows | `[class~="rounded-none"]` | 30px high, 10px radius, 4px inset in `p-0` content |
| Search-safe hover | `[data-highlighted]` on item, sub-trigger, radio, checkbox | neutral menu-hover fill |
| Keyboard selection | `[data-kb-active]` | stronger active-row fill |
| Open submenu | `[data-state="open"]` | active-row fill and primary text |
| Current model | command row with `bg-primary` inside the model dialog | neutral active fill plus a hairline, not a solid blue slab |
| Nested command surface | `[class~="rounded-none"][class~="bg-card"]` | keeps the dialog section square; only standalone command surfaces get 20px |
| Pressed buttons | `:active` on primary, outline, secondary, ghost, chip, destructive | stronger fill without moving the box |
| Editable controls | `:hover` excluding focus/open | hairline strengthens before the 1px focus edge |
| Settings navigation | nested `button[data-tour^="nav-"]` containers | 4px top-level and nested rhythm |
| Panel lists | `[data-panel-row] + [data-panel-row]` | 2px row gap |
| Underline search | `border-b` wrapper with icon + aria-labelled input | 32px filled control |

## Visual QA Fixes

The browser-hosted Desktop was exercised in light and dark modes at 1280px and
430px widths. Three passes of computed-style and screenshot checks exposed the
following integration details, all of which are now part of the contract:

- composer focus reads `--dt-composer-ring`; Hermes does not define a bare
  `--ring` custom property, so using it silently reset the focused border to
  `currentColor`;
- the empty-chat wordmark is capped at 20rem or 72vw and uses the primary ink
  instead of the blue accent;
- sidebar section labels use the neutral tertiary ink and hide the decorative
  dither mark, while keeping the host's layout;
- light-mode `text-primary` uses `#0169cc` for WCAG AA link contrast, while
  primary fills keep the measured `#339cff`;
- Tooltip, Dropdown, and Select wrappers replace the Button's `data-slot`, so
  button geometry keys on `data-size` and `data-variant` instead;
- `:where()` keeps the shared button and menu-row geometry low-specificity, so
  composer pills, command rows, and split controls can override it cleanly;
- default buttons use ChatGPT's inverse ink fill; blue remains the link, focus,
  checked-switch, and selected-accent colour;
- icon buttons follow the measured 10 / 12.5 / 15px ladder instead of one
  radius for every square control;
- side-specific `rounded-*` utilities get the same ladder, so split buttons and
  fused controls keep one continuous outer edge;
- page tabs are 32px raised pills; pane tabs are 24–30px rounded tabs instead
  of blue underlines, and the narrow page-tab dropdown uses the same raised
  pill;
- the sidebar search is a full-width 32px field rather than a 30%-opacity
  content-width hint;
- underline search fields are 32px filled controls with a hover state and a
  1px focus edge; sidebar, overlay, and page-header searches now read as inputs;
- compact/searchable dropdown rows get a 30px height, 10px radius, and a 4px
  inset even when the source row carries `rounded-none`;
- searchable `data-highlighted` rows use the neutral menu-hover fill, while
  `data-kb-active` and open submenus use the stronger active fill;
- the full model dialog keeps its command section square inside the rounded
  dialog and marks the current model with the same neutral active fill as the
  composer picker, plus a hairline because this picker has no check glyph;
- pressed primary and quiet buttons add a stronger active fill, while text and
  destructive actions keep their own colours;
- fields strengthen their hairline on hover and use only the 1px focus edge;
- settings navigation uses 4px gaps at both levels, nested groups get a 2px
  offset, and panel-list rows get a 2px gap;
- composer model and reasoning controls are true 32px pills after lowering the
  shared button rule's specificity;
- the compact switch is 28×16 with a 12px thumb, while the default remains
  32×20 with a 16px thumb;
- mobile overlays use a 16px gutter, and the empty-chat wordmark caps at 320px
  or 72vw so it no longer dominates a 430px viewport.

## Verification

```sh
cd hermes-plugins/hermes-chatgpt-skin
npm test
npm run audit:source -- "$HOME/.hermes/hermes-agent"
```

Manual smoke check after reload:

- light and dark appearance;
- chat, settings, capabilities, command-center, and command palette;
- sidebar row hover/selected/open states;
- model, reasoning, voice, and connector menu hover/open states;
- menu, select, dialog, sheet, and tooltip;
- settings navigation spacing and panel-list spacing;
- underline search hover/focus across sidebar, overlays, and page headers;
- composer focus, disabled send, queue/status stack, and popped-out composer;
- user bubble, assistant markdown, code card, tool row, approval card, diff;
- files, review, terminal, notifications, and an empty/error state.
