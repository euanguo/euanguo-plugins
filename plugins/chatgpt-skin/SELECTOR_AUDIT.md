# ChatGPT Skin Selector Audit

## Baseline

- Local BB: `0.47.2-nightly.40200590944.1`
- Upstream source: `get-bb/bb@3540a699e29034b53da32bb7efa6f5b4055209eb` (`2026-10-25`)
- Theme entry: `themes/chatgpt.css`

A shallow `get-bb/bb` checkout is evidence for selector ownership. The plugin
build does not read from that checkout and has no runtime dependency on it.

## Selector Policy

Selectors are chosen in this order:

1. **Semantic BB token.** Prefer changing a `--token` when every consumer should
   inherit the value.
2. **Stable source hook.** Prefer source-authored `data-*`, role, and element
   attributes such as `data-promptbox`, `data-tab-pill`,
   `data-persistent-drawer-content`, `data-bb-portaled-overlay`, and
   `data-radix-menu-content`.
3. **Independent class token.** If the source has no hook, match separate class
   tokens with `[class~="..."]`. Never rely on class ordering or a whitespace
   concatenation that Tailwind merge may rewrite.
4. **Narrow structural fallback.** Use a structural selector only when the
   source has no stable DOM marker. Keep it scoped to the smallest known
   component family.

Color state is left to BB's own utility composition when possible. A theme
selector should change geometry or missing surfaces, not replace a semantic
variant such as `text-destructive`.

## Source Map

| Surface | Primary source | Selector contract |
| --- | --- | --- |
| Theme token bridge | `apps/app/src/components/ui/theme.css` | `:root, .light`, `.dark` |
| Portaled overlays | `packages/shared-ui/src/lib/portal-scope.ts` | `[data-bb-portaled-overlay]` |
| Dropdown menu | `packages/shared-ui/src/components/ui/dropdown-menu.tsx` | `role=menu`, `[data-radix-menu-content]` |
| Context menu | `packages/shared-ui/src/components/ui/context-menu.tsx` | `role=menu`, `[data-radix-context-menu-content]` |
| Select | `packages/shared-ui/src/components/ui/select.tsx` | `role=listbox`, `[data-radix-select-content]` |
| Popover | `packages/shared-ui/src/components/ui/popover.tsx` | `[data-radix-popover-content]` |
| Dialog | `packages/shared-ui/src/components/ui/dialog.tsx` | `role=dialog`, `[data-radix-dialog-content]` |
| Alert dialog | `packages/shared-ui/src/components/ui/alert-dialog.tsx` | `role=alertdialog` |
| Hover card | `packages/shared-ui/src/components/ui/hover-card.tsx` | `[data-radix-hover-card-content]` |
| Responsive drawer | `packages/shared-ui/src/components/ui/responsive-overlay.tsx` | `[data-persistent-drawer-content]`, `[data-persistent-drawer-handle]` |
| Tooltip | `packages/shared-ui/src/components/ui/tooltip.tsx` | `role=tooltip`, `[data-radix-tooltip-content]` |
| Tab pill | `apps/app/src/components/ui/tab-pill.tsx` | `[data-tab-pill]`, `[data-tab-pill-close]` |
| Composer root | `plugins/composer/src/PromptBoxInternal.tsx` | `[data-promptbox]` |
| Composer actions | `plugins/composer/src/PromptBoxInternal.tsx` | `[data-promptbox-submit-action]`, action-row markers |
| Composer pickers | `apps/app/src/components/pickers/*` | `[data-promptbox-project-control]`, shrinkable/icon-only controls, stable option class tokens |
| Prompt stack | `apps/app/src/components/promptbox/banner/PromptStackCard.tsx` | `[data-promptbox-shell]` + `CONTEXT_CARD_CLASS` |
| Follow-up footer | `apps/app/src/components/promptbox/FollowUpPromptBox.tsx` | `[data-follow-up-composer-footer]` |
| Command palette | `apps/app/src/components/commands/CommandPalette.tsx` | `[data-testid=command-palette]`, `[data-palette-input-band]`, `[data-palette-results-clip]` |
| Mention/slash menu | `plugins/composer/src/ComposerPopupHost.tsx` | `[data-promptbox-typeahead-menu]` |
| Markdown preview | `apps/app/src/components/secondary-panel/FilePreview.tsx` | `[id^="thread-detail-secondary-panel"]` + content signature |
| Conversation scroll | `apps/app/src/components/ui/bottom-anchored-scroll-body.tsx` | `[data-page-scroll-viewport].thread-scrollbar` |

## Gaps Found And Fixed

### Token bridge

- Added the current BB tokens for solid recessed/raised surfaces, hairline and
  seam borders, sidebar foreground/border/ring, selected surfaces, timeline
  accent, and update emphasis.
- Replaced the stock primary-tinted `--surface-selected` with ChatGPT's quiet
  ink selection wash. BB also uses this token for loading skeletons; the stock
  value produced a large blue loading slab under the skin.
- Explicitly aliased `--background` / `--foreground` and the foreground roles
  used by cards, popovers, secondary controls, and accent surfaces.
- Set dark foregrounds on the blue/red fill tokens and route small
  `text-destructive` labels through `--destructive-text`. The measured bright
  accent remains the fill/decoration color instead of doubling as low-contrast
  text.
- In light mode, BB-only file/timeline accent text mixes the ChatGPT blue toward
  ink so it remains legible; dark mode keeps the measured bright blue.

### Semantic state corruption

- Removed broad menu item `:hover` rules that forced every row to
  `background: state-hover; color: ink`. The source composes destructive,
  selected, focused, and last-hovered variants itself; the old override erased
  destructive red on hover.
- Removed persistent selection backgrounds from checked menu radio/checkbox and
  option rows. Selection indicators remain; hover/focus surfaces come from the
  source state classes.

### Overlay coverage

- Extended the surface contract to context menus, alert dialogs, hover cards,
  side sheets, and both responsive drawer implementations.
- Added top-only rounding for bottom drawers instead of applying the desktop
  dialog's four-corner radius.
- Reset the extra wrapper around cmdk surfaces so command/picker menus do not
  stack two frosted backgrounds.
- Replaced the obsolete assumption that the main command palette is cmdk. It is
  now a dialog marked `data-testid=command-palette`.

### Inputs and settings

- Excluded `input[role=combobox]`, `input[type=search]`, and `[cmdk-input]` from
  the full control-fill rule. This fixes the settings search input becoming a
  white box and restores flat popup searches.
- Kept the bespoke settings-row dropdown scoped by its independent
  `border-border/60` and `bg-card` class tokens.
- Excluded combobox triggers from the outline-button treatment so a real
  `SelectTrigger` keeps the control fill.

### Responsive and touch behavior

- Desktop measurements are now gated by
  `@media (min-width: 48rem), (pointer: fine)`.
- Narrow coarse-pointer controls keep BB's larger source sizes instead of being
  shrunk by `!important` to 20, 24, or 28 pixels.
- This covers composer chips, submit/voice actions, prompt-stack footer targets,
  context indicators, and tab close affordances.

### Selector durability

- Removed concatenated `class*=` matches for composer chips, toolbar controls,
  compact icons, and header icon buttons.
- Migrated tab pills from `.group/tab-pill` to `data-tab-pill`.
- Migrated composer surfaces from `form.group/promptbox` to `data-promptbox`.
- Migrated mention menus from a long class triple to
  `data-promptbox-typeahead-menu` plus one stable class token.
- Scoped toolbar selectors by independent `h-7`, `rounded-md`, `border-border`,
  and `bg-transparent` class tokens.

### Layout regressions and integration

- Removed the permanent padding reservation on
  `.bb-sidebar-hover-actions-inset`; current BB owns that reservation and only
  applies it while row actions are revealed.
- Changed the Markdown preview selector from the default panel ID to
  `[id^="thread-detail-secondary-panel"]`, covering split panes whose IDs carry
  a pane suffix.
- Scoped the scrollbar gutter correction to
  `[data-page-scroll-viewport].thread-scrollbar` instead of every plugin scroll
  lane using the same class.
- Limited the corner-shape rule to rounded host/overlay elements instead of a
  universal descendant selector.

## Intentional Limits

- BB does not expose a public styling hook for every internal component. A few
  independent Tailwind class-token selectors remain as documented fallbacks.
- The theme still intentionally integrates with the Nest plugin's
  `data-bb-icon-button` marker and its rich sidebar hover card.
- ChatGPT's light warning text sample does not reliably clear WCAG AA on the
  light canvas. The theme preserves BB's safer `--warning-text` fallback instead
  of copying a lower-contrast value.
- CSS cannot guarantee future BB DOM stability. The contract test catches known
  regressions and stale selectors, while live browser checks remain necessary
  for layout and paint.

## Verification

```sh
cd plugins/chatgpt-skin
npm test
npm run audit:source -- /path/to/get-bb/bb
npm run build
bb plugin reload chatgpt-skin
```

Check both modes and both responsive presentations:

- command palette
- dropdown, context menu, select, alert dialog, tooltip
- settings search and editable controls
- new-thread and follow-up composers
- prompt-stack cards
- split secondary panel and Markdown preview
- narrow coarse-pointer drawer with source-sized touch controls
