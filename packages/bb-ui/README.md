# `@euanguo/bb-ui`

Canonical mirror of BB's official shared UI primitives (`packages/shared-ui` via `packages/plugin-registry/r/*.json` in `get-bb/bb`, MIT licensed).

Keeping these base components synced verbatim from upstream ensures every third-party BB skin (for example `chatgpt-skin`) matches plugin dialogs, drawers, menus, tooltips, hover cards, inputs, switches, tabs, and badges through BB's native DOM hooks (`data-radix-*`, `data-bb-portaled-overlay`, `data-persistent-drawer-*`, Tailwind class tokens).

## Commands

Run from the repository root:

```sh
# Pull the latest upstream `packages/plugin-registry/r` from get-bb/bb and sync all plugins
node scripts/sync-bb-ui.mjs

# Pull a specific git ref / commit SHA or from a local get-bb/bb checkout
node scripts/sync-bb-ui.mjs --ref <git-ref>
node scripts/sync-bb-ui.mjs --bb-dir /path/to/bb

# Re-mirror root `packages/bb-ui/src/` to subscribing plugins offline
node scripts/sync-bb-ui.mjs --sync-plugins

# Verify zero drift between `packages/bb-ui/src/` and all plugin mirrors
node scripts/sync-bb-ui.mjs --check
```

## Subscribing in a Plugin

Why plugins receive a mirrored closure rather than a workspace symlink: when BB installs a plugin from Git (`bb plugin install <url> --plugin <name>`), `npm install --omit=dev` runs only inside the plugin directory, and `esbuild` resolves unshimmed packages relative to the bundled source file's directory. Mirroring the declared closure directly into `<plugin>/bb-ui/` guarantees:

1. Standalone Git / local / npm installs build cleanly with `bb plugin build .`.
2. BB's Tailwind Oxide scanner automatically indexes all component classes.
3. Byte-for-byte parity with root `packages/bb-ui/` is enforced by `node scripts/sync-bb-ui.mjs --check`.

Add `<plugin>/bb-ui.json`:

```json
{
  "outDir": "bb-ui",
  "items": ["button", "dialog", "dropdown-menu", "input", "popover", "select", "switch", "tabs", "textarea", "tooltip"]
}
```

Then run `node scripts/sync-bb-ui.mjs --sync-plugins`. Do not hand-edit mirrored files under `packages/bb-ui/src/` or `plugins/<name>/bb-ui/`; put plugin-specific composition (such as `overlayCoordinator` wiring or custom card layout) in a thin wrapper outside `bb-ui/`.
