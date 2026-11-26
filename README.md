# euanguo-plugins

My [BB](https://getbb.app) and Hermes Desktop plugins, in one repository.

- BB plugins live under `plugins/<id>/` as ordinary plugin packages, indexed as
  a collection in `.bb/plugins.json`.
- Shared BB base UI primitives live at [`packages/bb-ui`](packages/bb-ui)
  (synced from `get-bb/bb`'s `packages/plugin-registry/r` via
  `node scripts/sync-bb-ui.mjs`), and subscribed plugins mirror their declared
  closure cleanly into `<plugin>/bb-ui/` (`--check` verified).
- Hermes Desktop plugins live under `hermes-plugins/<id>/`, each carrying a
  `plugin.yaml` manifest plus the `desktop/` half the app loads. That layout is
  what both `hermes plugins validate` and the desktop plugin installer accept.

| Plugin | Directory | What it does |
| --- | --- | --- |
| Antigravity CLI | [`plugins/antigravity-cli`](plugins/antigravity-cli) | Runs Antigravity CLI (`agy acp`) in BB with per-session isolation, background task promotion, extended async quiet hold, and usage/health checks. |
| ChatGPT Skin | [`plugins/chatgpt-skin`](plugins/chatgpt-skin) | A BB palette that reproduces the ChatGPT desktop app's surfaces, typography, and component states. |
| Harbor | [`plugins/harbor`](plugins/harbor) | Multi-repo Feature Cockpit & Parallel Workbench for BB: active/parked features, Feature Hub & Delivery Matrix, decoupled projects/workspaces, and agent access control. |
| Hermes ChatGPT Skin | [`hermes-plugins/hermes-chatgpt-skin`](hermes-plugins/hermes-chatgpt-skin) | The same ChatGPT desktop language as a Hermes Desktop theme plugin. |
| Nest *(legacy)* | [`plugins/nested-sidebar`](plugins/nested-sidebar) | Legacy group-first sidebar superseded by Harbor (Harbor includes one-click migration from Nest). |

## Install

Install Harbor or other BB plugins from the BB Plugin Marketplace or directly from this repository:

```sh
bb plugin install harbor
bb plugin install git:https://github.com/euanguo/euanguo-plugins.git --plugin antigravity-cli
bb plugin install git:https://github.com/euanguo/euanguo-plugins.git --plugin harbor
bb plugin install git:https://github.com/euanguo/euanguo-plugins.git --plugin nested-sidebar
bb plugin install git:https://github.com/euanguo/euanguo-plugins.git --plugin chatgpt-skin
```

Or pin a semver range over that plugin's release tags:

```sh
bb plugin install git:https://github.com/euanguo/euanguo-plugins.git@^0.1.0 \
  --subdirectory plugins/harbor --tag-prefix harbor/
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
`harbor/v0.1.0` or `nested-sidebar/v0.4.1`). Bump the plugin's `package.json`
version, commit, then tag that commit with the matching prefix.

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

## Privacy & Sanitization

Because this repository is public, real company repositories, internal group
names, real requirement titles, personal home paths, and non-public git remotes
are prohibited in tracked files. See [AGENTS.md](AGENTS.md) for the full policy
and neutral placeholder rules.

Enable the repository pre-commit guard once per clone:

```sh
git config core.hooksPath .githooks
node scripts/check-sanitization.mjs
```

On work machines, create a gitignored `.sanitization-blocklist.local` file at the
repository root with any employer-specific keywords or regex patterns you want
blocked locally before commit.

## History

The two BB plugins were previously published from their own repositories
(`bb-plugin-chatgpt-skin` and `bb-plugin-nested-sidebar`). Their full commit
history was merged into this repository with `git subtree`.

## License

Each plugin carries its own MIT license under its directory.
