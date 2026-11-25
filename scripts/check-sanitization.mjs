#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";

const REPO_ROOT = process.cwd();
const LOCAL_BLOCKLIST_PATH = ".sanitization-blocklist.local";

const SAFE_HOME_USERS = new Set([
  "example",
  "u",
  "user",
  "users",
  "demo",
  "runner",
  "alice",
  "bob",
  "dev",
  "test",
  "username",
  "your-user",
]);

const SAFE_REMOTE_PREFIXES = [
  "example/",
  "example-org/",
  "example-user/",
  "org-a/",
  "org-b/",
  "owner/",
  "user/",
  "your-org/",
  "acme/",
  "sample/",
  "euanguo/euanguo-plugins",
  "euanguo/bb-plugin-",
  "nousresearch/",
  "get-bb/",
  "ols-md/",
];

const IGNORED_PATH_PREFIXES = [
  ".git/",
  ".oil-ui/",
  "node_modules/",
  "dist/",
];

const IGNORED_EXACT_PATHS = new Set([
  "package-lock.json",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  LOCAL_BLOCKLIST_PATH,
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yaml",
  ".yml",
  ".css",
  ".txt",
  ".sh",
  ".html",
  ".svg",
]);

function isScannedPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  if (IGNORED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix) || normalized.includes(`/${prefix}`))) {
    return false;
  }
  const base = normalized.split("/").pop() ?? "";
  if (IGNORED_EXACT_PATHS.has(normalized) || IGNORED_EXACT_PATHS.has(base)) {
    return false;
  }
  const ext = extname(base).toLowerCase();
  return ext === "" ? base === "pre-commit" || base === ".gitignore" : TEXT_EXTENSIONS.has(ext);
}

function listFiles(stagedOnly) {
  const args = stagedOnly
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"]
    : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"];
  const raw = execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return raw.split("\0").filter((entry) => entry.length > 0 && isScannedPath(entry));
}

function readContent(filePath, stagedOnly) {
  try {
    if (stagedOnly) {
      return execFileSync("git", ["show", `:${filePath}`], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
    }
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function loadLocalBlocklist() {
  if (!existsSync(LOCAL_BLOCKLIST_PATH)) return [];
  const rules = [];
  const raw = readFileSync(LOCAL_BLOCKLIST_PATH, "utf8");
  for (const rawLine of raw.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const regexMatch = line.match(/^\/(.+)\/([a-z]*)$/u);
    if (regexMatch) {
      const flags = regexMatch[2].includes("g") ? regexMatch[2] : `${regexMatch[2]}g`;
      rules.push({ name: "local-blocklist", regex: new RegExp(regexMatch[1], flags) });
    } else {
      const escaped = line.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      rules.push({ name: "local-blocklist", regex: new RegExp(escaped, "giu") });
    }
  }
  return rules;
}

const STRUCTURAL_RULES = [
  {
    name: "private-home-path",
    regex: /(?:\/(?:Users|home)|[A-Za-z]:\\\\?Users)([/\\])([A-Za-z0-9._-]+)(?=[/\\]|["'`)\s,]|$)/gu,
    check(match) {
      const user = match[2];
      if (!user || SAFE_HOME_USERS.has(user.toLowerCase())) return false;
      return true;
    },
  },
  {
    name: "private-network-host",
    regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:corp|internal|intranet|localdomain))\b/giu,
    check() {
      return true;
    },
  },
  {
    name: "non-public-git-remote",
    regex: /(?:(?:https?|ssh):\/\/(?:[^@\s"'`]+@)?|git@)([A-Za-z0-9.-]+)[:/]([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+?)\.git\b/giu,
    check(match) {
      const slug = (match[2] ?? "").toLowerCase();
      return !SAFE_REMOTE_PREFIXES.some((prefix) => slug.startsWith(prefix));
    },
  },
  {
    name: "credential-or-key",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/gu,
    check() {
      return true;
    },
  },
];

function scan() {
  const stagedOnly = process.argv.includes("--staged");
  const files = listFiles(stagedOnly);
  const localRules = loadLocalBlocklist();
  const findings = [];

  for (const filePath of files) {
    const content = readContent(filePath, stagedOnly);
    if (content === null || content.includes("\0")) continue;

    const lines = content.split(/\r?\n/u);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const rule of STRUCTURAL_RULES) {
        rule.regex.lastIndex = 0;
        let m;
        while ((m = rule.regex.exec(line)) !== null) {
          if (rule.check(m)) {
            findings.push({
              file: filePath,
              line: i + 1,
              rule: rule.name,
              snippet: m[0],
            });
          }
        }
      }
      for (const rule of localRules) {
        rule.regex.lastIndex = 0;
        const m = rule.regex.exec(line);
        if (m) {
          findings.push({
            file: filePath,
            line: i + 1,
            rule: rule.name,
            snippet: m[0],
          });
        }
      }
    }
  }

  if (findings.length > 0) {
    console.error(`\n[sanitization] Found ${findings.length} potential sensitive reference(s):`);
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line} [${f.rule}] ${f.snippet}`);
    }
    console.error("\nSee AGENTS.md for approved placeholder conventions and remediation steps.");
    process.exit(1);
  }

  const scope = stagedOnly ? "staged" : "repository";
  console.log(`[sanitization] Passed (${files.length} ${scope} files checked, 0 violations).`);
}

scan();
