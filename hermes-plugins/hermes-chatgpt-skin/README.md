# ChatGPT Skin for Hermes

A Hermes Desktop theme plugin that applies the ChatGPT desktop visual language
without patching the app:

- paper and graphite surface ramps;
- neutral hover, selected, and open-row states;
- compact/searchable menu rows with inset corners and keyboard-selected state;
- the OpenAI radius ladder and optional superellipse corners;
- quiet hairline overlays with restrained shadows;
- a frosted, 25px composer;
- light and dark Shiki-compatible surfaces and a matching terminal palette.

The plugin is a single uncompiled ESM file. It registers one `DesktopTheme`,
applies it once on first install, and adds a command-palette action for applying
it again later.

## Install

```sh
mkdir -p "$HOME/.hermes/desktop-plugins"
ln -s "$PWD/desktop" "$HOME/.hermes/desktop-plugins/hermes-chatgpt-skin"
```

If copying instead of linking, copy this directory so the folder name remains
`hermes-chatgpt-skin`.

Restart Hermes Desktop, or run **Reload desktop plugins** from the command
palette. The first load selects **ChatGPT** automatically. After that, pick it
under **Settings -> Appearance -> Theme**, or run:

```text
Theme: Apply ChatGPT Skin
```

## What it covers

The source audit covers the shell, all top-level routes, settings subpages,
panes, overlays, chat transcript, composer, command palette, notifications,
tool approvals, diffs, and the UI primitives shared by the remaining pages.
See [SELECTOR_AUDIT.md](SELECTOR_AUDIT.md) for the source map.

The theme intentionally does not add settings UI or user preferences. It also
does not preserve the host app's stock 2.5px control geometry: larger radii,
row spacing, and the ChatGPT type rhythm are part of the skin.

## Development

```sh
npm test
npm run audit:source -- "$HOME/.hermes/hermes-agent"
```

`npm test` checks the plugin contract, palette data, scoped CSS hooks, and
one-time activation. The source audit checks the selectors against the local
Hermes checkout and prints the revision it verified.

No install or build step is required; the tests use only Node's standard
library.

## Maintenance

All selectors prefer, in order:

1. semantic Hermes CSS tokens;
2. theme-owned scopes such as `data-hermes-theme`;
3. source-authored `data-slot`, `data-tour`, `role`, and `data-state` hooks;
4. a narrow documented fallback.

Run the source audit after updating Hermes. A failure names the file and hook
that changed; update the narrow rule rather than adding a broad DOM override.

