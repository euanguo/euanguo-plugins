# Listing hermes-chatgpt-skin in the Hermes plugin catalog

How this plugin gets from this repository into
`hermes plugins search` / the Desktop catalog browser.

## The mechanism

The catalog is **not** self-serve. It is a curated set of YAML files in
[`NousResearch/hermes-agent/plugin-catalog/`](https://github.com/NousResearch/hermes-agent/tree/main/plugin-catalog).
One file per plugin, each pinning a full 40-character commit SHA. A maintainer
reviews and merges the PR; there is no registry API to push to.

At runtime an installed Hermes fetches the published index from
`https://hermes-agent.nousresearch.com/docs/api/plugin-catalog.json`, so new
entries appear without a Hermes update. `hermes plugins install <name>` clones
the repo at the pinned SHA.

## Repository layout

This plugin ships the layout both the installer and the validator accept:

```text
hermes-plugins/hermes-chatgpt-skin/
├── plugin.yaml          # manifest: name, version, description, requires_hermes
├── desktop/
│   ├── plugin.js        # the Desktop theme plugin (loaded by the renderer)
│   └── LICENSE
├── scripts/             # audit tooling, never loaded by Hermes
├── test/
├── package.json         # dev scripts only; no runtime dependencies
├── README.md
└── SELECTOR_AUDIT.md
```

A root `plugin.js` also works for local installs, but
`hermes plugins validate` only accepts `desktop/plugin.js`, `__init__.py`, or
`plugin.json` as a loadable entry — so `desktop/` is the layout to publish.

## Local check before opening the PR

```sh
hermes plugins validate hermes-plugins/hermes-chatgpt-skin --install-deps
```

That is the same command catalog CI runs. Current result: **validation passed**,
with `security scan`, `no core override`, and `desktop surface` all green.

## The entry file

Add exactly one file to the upstream repo,
`plugin-catalog/hermes-chatgpt-skin.yaml`:

```yaml
name: hermes-chatgpt-skin
repo: https://github.com/euanguo/euanguo-plugins
subdir: hermes-plugins/hermes-chatgpt-skin
sha: <40-hex commit of this repo>
description: "ChatGPT desktop visual language for Hermes Desktop: paper and graphite surface ramps, neutral hover/selected/open row states, the OpenAI radius ladder, hairline overlays, and a frosted 25px composer. Light and dark palettes with matching terminal colors. Disclosure — no network calls, no telemetry, no credentials, no settings writes; registers only through the Desktop plugin SDK (THEMES_AREA, PALETTE_AREA, ctx.i18n, ctx.storage) and switches to the theme once on first install."
maintainer: euanguo
tier: community
category: desktop
requires_hermes: ">=0.22.0"
version: "0.1.0"
readme: true
platforms: [macos, linux, windows]
capabilities:
  provides_tools: []
  provides_hooks: []
  provides_middleware: []
  requires_env: []
```

`subdir` matters: this is a monorepo, so the catalog entry points at the plugin
directory rather than the repo root. Without it the installer would clone the
whole repository and find no `desktop/plugin.js`.

## Admission rules that apply to this plugin

The full list lives in
[`plugin-catalog/README.md`](https://github.com/NousResearch/hermes-agent/blob/main/plugin-catalog/README.md).
The ones this plugin must keep satisfying:

- **2 — Exact SHA pins.** `sha` is a full commit, never a branch or tag. Every
  release is a new PR.
- **3 — No self-updating code.** The plugin has no updater and must not grow
  one. Updates reach users only through a SHA-bump PR.
- **5 — Owner submission.** Only the repository owner or a major contributor
  may submit, which is satisfied here.
- **6 — Capabilities match reality.** The plugin registers no tools, hooks, or
  middleware, so the empty `capabilities:` block is accurate. Adding any of them
  means updating the entry.
- **8 — Desktop plugins stay inside the SDK surface.** This plugin only calls
  `requestTheme`, `ctx.registerMany`, `ctx.i18n`, and `ctx.storage`. It never
  queries the app DOM, patches prototypes, or uses `eval`. The CSS it ships is
  scoped to `:root[data-hermes-theme="chatgpt"]`, which Hermes injects itself.
- **9 — No runtime overrides of Hermes core.** Nothing is rebound.
- **13 — Risky behaviour is disclosed.** A theme has none: no network, no
  telemetry, no credentials, no reads outside its own storage. The disclosure
  line in `description` says so.
- **14 — Truthful compatibility metadata.** `requires_hermes: ">=0.22.0"`
  matches the `DesktopTheme.customCSS` surface the plugin depends on, and the
  same floor is declared in `plugin.yaml`.
- **15 — No skins of bundled plugins.** This is an independent ChatGPT-themed
  palette, not a fork of a bundled Hermes theme.

## Disclosure line

Rule 13 asks for a one-line summary in the PR description:

> No network calls, no telemetry, no credentials. Registers only through the
> Desktop plugin SDK (`THEMES_AREA`, `PALETTE_AREA`, `ctx.i18n`, `ctx.storage`),
> injects scoped CSS under `:root[data-hermes-theme="chatgpt"]`, and switches
> the active theme to ChatGPT once on first install.

## Release flow

1. Bump `version` in `plugin.yaml` and `package.json`.
2. `hermes plugins validate hermes-plugins/hermes-chatgpt-skin --install-deps`.
3. `npm test` and `npm run audit:source` inside the plugin directory.
4. Commit, push, tag `hermes-chatgpt-skin/vX.Y.Z`.
5. Open the catalog PR with `sha` set to that commit.

A version bump is not a new admission: rule 4 makes a SHA bump its own reviewed
PR, so the catalog entry moves in lockstep with releases.
