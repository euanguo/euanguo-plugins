# Repository Guidelines & Public-Repo Sanitization Policy

This repository (`euanguo/euanguo-plugins`) is a **public** repository. Every contributor and coding agent must ensure that **no internal, proprietary, or machine-specific information** is written into source code, tests, mocks, docs, comments, screenshots, or commit messages — especially when developing on a work machine.

---

## 1. Strictly Forbidden in Tracked Files (严禁提交到公开仓库的内容)

Before staging, committing, or generating docs/tests/fixtures, verify that none of the following appear anywhere in tracked files:

1. **Company & Internal Project Identifiers**:
   - Employer or client repository names, internal monorepo/submodule names, internal product/team/group names or acronyms.
   - Real business requirement titles, internal PRD links, ticket IDs, or unreleased feature codenames.
   - Real local checkout names or live host environment/thread snapshots pasted from production BB installs (`env_*`, `thr_*` copied verbatim from live machines).
2. **Personal Machine Paths & Usernames**:
   - Real OS usernames or absolute home paths such as `/Users/<real-user>/...`, `/home/<real-user>/...`, or `C:\Users\<real-user>\...`.
3. **Internal Network, Remotes & Credentials**:
   - Private/internal Git hostnames or non-public `owner/repo` remote URLs in fixtures, tests, or docs.
   - Private RFC1918 IP addresses (`10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`), internal DNS suffixes (`.corp`, `.internal`, `.intranet`, `.localdomain`), API keys, tokens, or private keys.

---

## 2. Approved Neutral Placeholder Conventions (推荐占位命名)

Use neutral, obviously synthetic names when writing tests, fixtures, architecture docs, or UI prototypes:

- **Repositories / Projects**: `acme-app`, `acme-app-intl`, `acme-web`, `acme-web-shop`, `acme-sdk`, `sample-portal`, `sample-cli`, `sample-ledger`, `sandbox-repo`
- **Groups / Teams**: `Core`, `Infra`, `Apps`, `Work`, `Personal`, `Side`
- **Non-ASCII / CJK Example Feature Names**: `订单通知改造`, `结算流程重构`, `AI 示例插件 2`, `AI 文本摘要 2`, `AI 助手`
- **Filesystem Paths**: `/Users/example/...`, `/home/u/...`, `/repos/...`, `/work/...`, `/f/...`
- **Git Remotes**: `git@github.com:example/app.git`, `https://github.com/example-org/sample-portal.git`, `https://github.com/org-a/...` vs `https://github.com/org-b/...`
- **Author & Public Repo Metadata**: Genuine attribution (e.g., `euanguo/euanguo-plugins`, upstream MIT notices) may stay in `README.md`, `package.json`, `LICENSE`, and `THIRD_PARTY_NOTICES.md`.

---

## 3. Automated Guardrails (本地防泄漏与公司电脑配置)

1. **Pre-commit Hook (run once per clone)**:
   ```sh
   git config core.hooksPath .githooks
   ```
   Every `git commit` will run `node scripts/check-sanitization.mjs --staged` via `.githooks/pre-commit` and abort if any rule triggers.

2. **Local Blocklist on Company Machines (强烈建议在公司电脑配置)**:
   Create a gitignored `.sanitization-blocklist.local` file at the repository root (already excluded in `.gitignore`) listing your company's internal repo names, team acronyms, internal domains, and usernames — one entry per line (`#` comments and `/regex/flags` supported):
   ```text
   # Company-only blocklist (never committed to Git)
   my-company-repo-prefix
   internal-domain.example
   /secret-project-[a-z]+/i
   ```
   Both `node scripts/check-sanitization.mjs` and the pre-commit hook automatically load `.sanitization-blocklist.local` when present.

3. **Manual / Agent Pre-Push Gate**:
   Agents modifying any plugin or doc in this repository MUST run:
   ```sh
   node scripts/check-sanitization.mjs
   ```
   before committing or pushing changes, and MUST NOT echo company-specific terms even as negative examples inside tracked docs, tests, or scripts.
