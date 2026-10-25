# euanguo-plugins

My [BB](https://getbb.app) plugins, in one repository. Each plugin lives under
`plugins/<id>/` as an ordinary plugin package with its own `package.json`, and
`.bb/plugins.json` indexes them as a collection.

| Plugin | Directory | What it does |
| --- | --- | --- |
| ChatGPT Skin | [`plugins/chatgpt-skin`](plugins/chatgpt-skin) | A BB palette that reproduces the ChatGPT desktop app's surfaces, typography, and component states. |
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

## Releases

Each plugin is versioned and tagged on its own as `<id>/vX.Y.Z` (for example
`nested-sidebar/v0.4.1`). Bump the plugin's `package.json` version, commit, then
tag that commit with the matching prefix.

## Development

Each plugin directory is self-contained: run `npm install` inside it, then
`npm run build` (or the scripts its `package.json` defines). See each plugin's
README for details.

## History

Both plugins were previously published from their own repositories
(`bb-plugin-chatgpt-skin` and `bb-plugin-nested-sidebar`). Their full commit
history was merged into this repository with `git subtree`.

## License

Each plugin carries its own MIT license under its directory.
