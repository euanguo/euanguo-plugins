# euanguo-plugins

My [BB](https://getbb.app) and Hermes Desktop plugins, in one repository.

- BB plugins live under `plugins/<id>/` as ordinary plugin packages, indexed as
  a collection in `.bb/plugins.json`.
- Hermes Desktop plugins live under `hermes-plugins/<id>/`, each carrying a
  `plugin.yaml` manifest plus the `desktop/` half the app loads. That layout is
  what both `hermes plugins validate` and the desktop plugin installer accept.

| Plugin | Directory | What it does |
| --- | --- | --- |
| ChatGPT Skin | [`plugins/chatgpt-skin`](plugins/chatgpt-skin) | A BB palette that reproduces the ChatGPT desktop app's surfaces, typography, and component states. |
| Hermes ChatGPT Skin | [`hermes-plugins/hermes-chatgpt-skin`](hermes-plugins/hermes-chatgpt-skin) | The same ChatGPT desktop language as a Hermes Desktop theme plugin. |
| Nest | [`plugins/nested-sidebar`](plugins/nested-sidebar) | A group-first sidebar: project groups, worktree-aware thread trees, and activity that bubbles up. |

## Install

Install one plugin straight from this repository:

```sh
bb plugin install git:https://github.com/euanguo/euanguo-plugins.git --plugin nested-sidebar
bb plugin install git:https://github.com/euanguo/euanguo-plugins.git --plugin chatgpt-skin
```

Or pin a semver range over that plugin's release tags:

```sh
bb plugin install git:https://github.com/euanguo/euanguo-plugins.git@^0.4.1 \
  --subdirectory plugins/nested-sidebar --tag-prefix nested-sidebar/
```

Install the Hermes theme by linking its desktop half into the desktop plugin
folder:

```sh
mkdir -p "$HOME/.hermes/desktop-plugins"
ln -s "$PWD/hermes-plugins/hermes-chatgpt-skin/desktop" \
  "$HOME/.hermes/desktop-plugins/hermes-chatgpt-skin"
```

## Releases

Each plugin is versioned and tagged on its own as `<id>/vX.Y.Z` (for example
`nested-sidebar/v0.4.1`). Bump the plugin's `package.json` version, commit, then
tag that commit with the matching prefix.

## Submitting a Hermes plugin to the catalog

The Hermes plugin catalog is human-reviewed and merged upstream, so listing is
a PR to `NousResearch/hermes-agent`, not a local step.
`hermes-plugins/hermes-chatgpt-skin/CATALOG.md` records the exact procedure and
the admission rules that apply to a theme plugin.

## Development

Each plugin directory is self-contained. The Hermes theme needs no install or
build. For BB plugins, run `npm install` inside the directory, then
`npm run build` (or the scripts its `package.json` defines). See each plugin's
README for details.

## History

The two BB plugins were previously published from their own repositories
(`bb-plugin-chatgpt-skin` and `bb-plugin-nested-sidebar`). Their full commit
history was merged into this repository with `git subtree`.

## License

Each plugin carries its own MIT license under its directory.
