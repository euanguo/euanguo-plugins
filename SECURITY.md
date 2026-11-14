# Security and privacy

This is a full-trust BB provider plugin. Install only from a source you trust.

The plugin registers one provider and wraps BB's ACP bridge to map Plan/Build onto native CLI modes. It launches `agy` through the shared bridge, with fixed arguments and no shell command construction, credential parser, custom network endpoint, listener, or database. The trusted agent-host PATH selects the executable; do not place an untrusted `agy` earlier on PATH.

The plugin stores its enable, request-sandbox, and automatic-approval booleans in BB settings. Existing credentials remain managed by Antigravity. The plugin does not copy or bundle them. Prompts, workspace context, and tool results are processed by Antigravity and its service under Google's policies; BB and the CLI may retain their normal conversation records and diagnostics. Disabling CLI telemetry does not disable service processing or those records.

Antigravity's normal approval checks stay enabled in Accept edits mode by default. The opt-in automatic approval setting answers ACP permission requests without manual review, including commands requesting execution outside the CLI sandbox. It preserves the selected permission mode and direct ACP filesystem restrictions and does not override a host policy denying escalation. Full access also makes BB's shared bridge approve ACP permission requests automatically. Plan mode is a native CLI behavior, not enforced read-only access. These checks are not an operating-system sandbox. Only open trusted workspaces. Dependency and upstream bridge security remain part of this plugin's trust boundary.

Do not post credentials or raw private session logs in public issues. Report a suspected issue privately to the repository maintainer through GitHub's private security reporting on [ols-md/bb-plugin-antigravity](https://github.com/ols-md/bb-plugin-antigravity).

## Local task state

Background task tracking saves descriptions, task/thread identifiers, and output/transcript paths in `~/.bb/plugin-data/bb-plugin-antigravity/background-tasks.json` (or the directory selected by `BB_ANTIGRAVITY_TASK_STATE_DIR`). Descriptions can include command text. Records expire after three days when state is processed; this is not a timed secure-erasure guarantee. Treat this file and CLI transcripts as private runtime data, and do not attach them to public issues without reviewing and redacting them.

## Public contribution and release checks

Before committing, review `git diff --cached` and `git diff --cached --name-only`. Check for credentials, personal emails, local paths, logs, account identifiers, and conversation data. Use synthetic fixtures and a clean test workspace for screenshots. Secret scanners do not detect all personal information. Ignoring a file does not remove it from Git history once tracked.

Use your GitHub-provided `noreply` commit email if you want email privacy, and verify it with `git var GIT_AUTHOR_IDENT` before committing. Never put credentials in issues, PR descriptions, workflow files, or agent instructions.

Pull requests run typechecks, tests, a dependency audit, and a redacted Gitleaks history scan on GitHub-hosted runners. They do not run signed-in CLI smoke tests. Keep workflow permissions read-only, pin Actions to full commit hashes, and never run untrusted PR code with secrets or on a personal/self-hosted runner. Keep secret scanning, push protection, and private vulnerability reporting enabled in repository settings.

Before releasing, build and inspect `npm pack --dry-run` and review screenshots. Confirm the package excludes source maps, environment files, runtime state, and private diagnostics. Run signed-in smoke tests separately on a trusted machine.

If a credential is exposed, revoke or rotate it immediately, then remove it and assess history cleanup. Deleting a file or rewriting history does not revoke the credential or remove existing copies.
