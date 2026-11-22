---
name: antigravity-cli
description: Spawn, configure, or troubleshoot Antigravity CLI (antigravity-cli) threads in BB — models, reasoning levels (low, medium, high), quota/usage windows, Build/Plan work modes, permissions, and sign-in.
---

# Antigravity CLI provider

Threads on the `antigravity-cli` provider run the locally installed Antigravity CLI (`agy acp --disable-telemetry`) through BB's shared ACP bridge.

## Models and reasoning levels

`antigravity-cli` discovers models and per-model reasoning efforts from the signed-in CLI (`low`, `medium`, `high`; default `medium`). Fixed-effort models (such as `gpt-oss-120b-medium`) report `supportedReasoningEfforts: []`.

- Plain `bb provider models antigravity-cli` prints only the model table and `sessionOptions` (`mode`), omitting reasoning levels. Always pass `--json` when inspecting reasoning support:

```sh
bb provider models antigravity-cli --environment "$BB_ENVIRONMENT_ID" --json
```

- If a model reports `reasoningDiscovery: "unknown"`, probe that model explicitly:

```sh
bb provider models antigravity-cli --environment "$BB_ENVIRONMENT_ID" --selected-model <model-id> --json
```

- Pass reasoning level with `--reasoning-level` (not `--option`):

```sh
bb thread spawn --project "$BB_PROJECT_ID" --provider antigravity-cli --model gemini-4-argon --reasoning-level medium --prompt "..."
```

## Work modes and permissions

Work mode and permissions are separate controls:

- **Work mode (`--option mode=<accept-edits|plan>`)**:
  - `accept-edits` (**Build**, default): implement the task under the active permission policy.
  - `plan` (**Plan**): research and plan before implementation (behavioral mode, not enforced read-only access).
- **Permission mode (`--permission-mode <accept-edits|full>`)**:
  - `accept-edits`: workspace edits run with native Accept edits behavior; remaining ACP permission requests surface in BB unless automatic approval is enabled.
  - `full`: auto-approves ACP permission requests, including requests to run outside the CLI terminal sandbox.
  - `auto` is not supported by the shared ACP bridge.

## Requirements and settings

- `agy` must be installed and on `PATH` on the target host (`agy --version`, `agy acp --help`).
- Sign in on the target host with `agy acp --login`.
- Plugin settings (`Settings -> Installed plugins -> Antigravity CLI`):
  - `enabled` (default `true`): show or hide `antigravity-cli` in the provider picker.
  - `sandbox` (default `false`): pass `--sandbox` when starting new threads (when `false`, inherits CLI settings).
  - `autoApprove` (default `false`): automatically answer ACP permission requests in Accept edits mode on new turns, including requests to run outside the CLI sandbox. It preserves the selected permission mode and direct ACP filesystem restrictions; host policy denying escalation still applies. Full access already auto-approves requests.
  - `subagentsDisabled` (default `false`): prevent Antigravity CLI from using its native subagent tools (`invoke_subagent`, `define_subagent`, `manage_subagents`, `send_message`) so agents delegate subtasks via BB child threads (`bb thread spawn --parent-self`), and automatically deny native subagent approval requests.
  - `commandDescriptionsEnabled` (default `true`): show Antigravity's `toolSummary` description on command execution cards.

## Usage and quota limits

`antigravity-cli` reports per-model-group quota windows (`Gemini 7d`, `Gemini 5h`, `Claude/GPT 7d`, `Claude/GPT 5h`, `Argon 7d`) by running `agy -p "/usage" --output-format json` and exposing both `provider/usage` and BB's discoverable `provider-usage.v1` RPC source.

- Inspect live quota from the CLI or BB:

```sh
bb settings usage --refresh --json
```

## Limits

- Session fork/rewind (`fork: "none"`), manual `/compact`, service tiers, and native thread archive/rename are not supported.
- Native skills are indexed from workspace `.agents/skills` and `.agent/skills`, and from user `~/.gemini/antigravity-cli/skills`, `~/.gemini/skills`, and `~/.gemini/config/skills`.
