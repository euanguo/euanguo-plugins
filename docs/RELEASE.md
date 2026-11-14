# Publish to the BB Community marketplace

The marketplace lists plugin metadata. The source code stays in a public Git repository or npm package. `antigravity-cli` is published in the [BB Community marketplace](https://github.com/get-bb/marketplace); `marketplace-entry.template.json` is the reference entry for marketplace updates.

The steps below follow the [Community marketplace contribution instructions](https://github.com/get-bb/marketplace#submit-a-plugin). Recheck them before submitting because the marketplace contract can change independently of BB.

## 1. Prepare a public release

Choose the public author name and GitHub account that will own the listing. The current Git remote is `https://github.com/ols-md/bb-plugin-antigravity.git`; verify that it is public and contains the intended release before submitting. Add public repository metadata to `package.json` and use the prepared listing in [marketplace-entry.template.json](marketplace-entry.template.json). Do not put an email address in the author field.

Review the exact files and Git history to publish. Build and validate the release:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
npm run smoke -- --modes
npm pack --dry-run
```

The optional `npm run smoke -- --prompt` sends a real prompt and can consume quota. Also verify a clean Git-source installation, streaming, cancellation, approval allow/deny, editing, and resumed conversations in BB. Validate macOS/Linux before claiming support there.

Publish the reviewed commit and an immutable `v0.1.1` tag when ready. No npm publication is required for a Git-source listing. Do not move a released tag; use a new version for fixes.

The prepared listing uses `range: "^0.1.0"` so BB can discover compatible updates from future release tags. Do not combine `ref` and `range`.

## 2. Prepare the marketplace pull request

Fork [get-bb/marketplace](https://github.com/get-bb/marketplace) and create a contribution branch. Add these files to the fork:

| Plugin checkout | Marketplace fork |
| --- | --- |
| Filled `docs/marketplace-entry.template.json` | `entries/antigravity-cli.json` |
| `assets/icon.svg` | `icons/antigravity-cli-<hash>.svg` |
| `PLUGIN_OVERVIEW.md` | `overview/antigravity-cli.md` |
| Real BB screenshots, if useful | `screenshots/antigravity-cli/` |

Keep the filename equal to the entry ID. Check `reserved-plugin-ids.json` and existing entries for collisions. `agents-and-providers` is the current category for this plugin. Set `author.github` to the account responsible for later listing changes.

Use the current [v2 entry schema](https://github.com/get-bb/marketplace/blob/main/schema/marketplace-v2.schema.json). Do not edit the generated marketplace documents.

Screenshots may use PNG, JPEG, or WebP, at least 1200 pixels wide and no larger than 2 MiB each, with at most six images. Use a non-private test workspace and omit personal or account data. Reference them with `./screenshots/antigravity-cli/<filename>` in the entry. Icons may be SVG, PNG, or WebP and must be 256 KB or less.

The overview must be UTF-8, at most 4000 characters, and use supported Markdown with absolute HTTPS links. Raw HTML, images, tables, footnotes, and task lists are rejected in marketplace overviews; those restrictions do not apply to the repository README.

## 3. Validate and submit

Inside the marketplace fork, run its documented checks:

```sh
npm ci
npm run build
npm test
npm run gate:v1
npm run check
```

The checks validate metadata and the remote release source. Commit only this plugin's entry and assets, push the contribution branch, and open a pull request against `get-bb/marketplace`.

Marketplace CI and a maintainer review the source and behavior. Merging publishes the listing; users still choose whether to install or update it. A compatible release within a tracking range usually needs no listing PR. Source, branding, ownership, description, screenshot, or pinned-version changes need another PR.

## Current release status

The [public GitHub repository](https://github.com/ols-md/bb-plugin-antigravity) and BB Community marketplace listing (`antigravity-cli`, tracking `^0.1.0`) are live and verified on Windows. macOS and Linux validation remains open.

## Privacy gate

Complete the public contribution and release checks in [SECURITY.md](../SECURITY.md#public-contribution-and-release-checks) before every push and release. CI scans credentials; manually review screenshots, commit metadata, and package contents for personal information. Keep signed-in CLI smoke tests outside public PR automation.
