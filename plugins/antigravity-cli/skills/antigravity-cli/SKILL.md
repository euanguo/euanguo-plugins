---
name: antigravity-cli
description: Spawn, configure, or troubleshoot Antigravity CLI (antigravity-cli) threads in BB — models, reasoning levels (low, medium, high, xhigh, max), quota/usage windows, Build/Plan work modes, async background task stability, and sign-in.
---

# Antigravity CLI provider

Threads on the `antigravity-cli` provider run the locally installed Antigravity CLI (`agy acp --process-per-session --disable-telemetry`).

## Models and reasoning levels

`antigravity-cli` discovers models and per-model reasoning efforts from the signed-in CLI (`low`, `medium`, `high`, `xhigh`, `max`). Fixed-effort models report `supportedReasoningEfforts: []`.

- Pass `--json` when inspecting reasoning support:

```sh
bb provider models antigravity-cli --environment "$BB_ENVIRONMENT_ID" --json
```

- Pass reasoning level with `--reasoning-level` (not `--option`):

```sh
bb thread spawn --project "$BB_PROJECT_ID" --provider antigravity-cli --model gemini-4-argon --reasoning-level medium --prompt "..."
```

## Work modes and permissions

- **Work mode (`--option mode=<accept-edits|plan>`)**: `accept-edits` (**Build**, default) or `plan` (**Plan**).
- **Permission mode (`--permission-mode <accept-edits|full>`)**: `accept-edits` keeps approval checks (unless `autoApprove` is enabled); `full` auto-approves ACP permission requests.

## Settings

`Settings -> Installed plugins -> Antigravity CLI`:

- `command` (default `"agy"`): executable name or shared absolute path.
- `processPerSession` (default `true`): pass `--process-per-session` to isolate ACP workers per thread.
- `agentTurnQuietSeconds` (default `30`, range `5-300`): extend quiet tolerance before settling async/background-resumed turns as idle.
- `autoApprove` (default `false`): automatically approve ACP permission requests in Accept edits mode.
- `sandbox` (default `false`): pass `--sandbox` for new threads.
- `subagentsDisabled` (default `false`): instruct Antigravity to use BB thread delegation instead of native subagent tools.
- `commandDescriptionsEnabled` (default `true`): show `toolSummary` on command cards.
- `enabled` (default `true`): show or hide `antigravity-cli` in the provider picker.

## Usage, health, and skills

- Usage reads use `agy -p "/usage" --output-format json` (`provider/usage` and `provider-usage.v1`).
- Health probes verify CLI availability, `agy acp --help`, and cached/live auth state without creating conversations.
- Native skills load from workspace `.agents/skills` / `.agent/skills` and user `~/.gemini/antigravity-cli/skills`, `~/.gemini/skills`, `~/.gemini/config/skills`.
