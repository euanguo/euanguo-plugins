import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cssPath = path.join(pluginRoot, "themes/chatgpt.css");
const packagePath = path.join(pluginRoot, "package.json");

const [css, packageJsonText] = await Promise.all([
  readFile(cssPath, "utf8"),
  readFile(packagePath, "utf8"),
]);
const packageJson = JSON.parse(packageJsonText);

const lightSectionStart = css.indexOf("/* 2. Light mode");
const darkSectionStart = css.indexOf("/* 3. Dark mode");
assert.notEqual(lightSectionStart, -1, "missing light mode section");
assert.notEqual(darkSectionStart, -1, "missing dark mode section");

function modeBlock(selector, from = 0) {
  const start = css.indexOf(selector, from);
  assert.notEqual(start, -1, `missing theme block: ${selector}`);
  const bodyStart = css.indexOf("{", start);
  const bodyEnd = css.indexOf("\n}", bodyStart);
  assert.notEqual(bodyStart, -1, `missing opening brace: ${selector}`);
  assert.notEqual(bodyEnd, -1, `missing closing brace: ${selector}`);
  return css.slice(bodyStart + 1, bodyEnd);
}

function assertDeclarations(block, names, mode) {
  for (const name of names) {
    assert.match(
      block,
      new RegExp(`(?:^|\\n)\\s*${name}\\s*:`),
      `${mode} must declare ${name}`,
    );
  }
}

test("manifest points at existing theme assets", async () => {
  const themes = packageJson.bb?.themes ?? [];
  assert.equal(themes.length, 1);

  const [theme] = themes;
  assert.equal(theme.id, "chatgpt");
  assert.equal(theme.css, "./themes/chatgpt.css");

  for (const relativePath of [
    theme.css,
    theme.codeTheme?.dark,
    theme.codeTheme?.light,
  ]) {
    assert.equal(typeof relativePath, "string");
    await stat(path.resolve(pluginRoot, relativePath));
  }
});

test("theme stays within BB's stylesheet limit", async () => {
  const { size } = await stat(cssPath);
  assert.ok(size < 256 * 1024, `theme CSS is ${size} bytes`);
});

test("light and dark blocks cover BB's current semantic roles", () => {
  const required = [
    "--background",
    "--foreground",
    "--primary-foreground",
    "--destructive-foreground",
    "--secondary",
    "--accent",
    "--muted",
    "--surface-recessed-solid",
    "--surface-recessed-soft-solid",
    "--surface-raised-solid",
    "--surface-selected",
    "--surface-selected-border",
    "--border-hairline",
    "--border-seam",
    "--sidebar-border",
    "--sidebar-ring",
    "--timeline-accent",
    "--version-upgrade",
  ];

  assertDeclarations(
    modeBlock(":root,\n.light", lightSectionStart),
    required,
    "light",
  );
  assertDeclarations(modeBlock(".dark", darkSectionStart), required, "dark");
});

test("ANSI foreground pairs stay complete in both modes", () => {
  for (const [mode, block] of [
    ["light", modeBlock(":root,\n.light", lightSectionStart)],
    ["dark", modeBlock(".dark", darkSectionStart)],
  ]) {
    for (let index = 0; index < 16; index += 1) {
      assert.match(block, new RegExp(`--ansi-${index}\\s*:`), `${mode} ansi-${index}`);
      assert.match(
        block,
        new RegExp(`--ansi-bg-fg-${index}\\s*:`),
        `${mode} ansi-bg-fg-${index}`,
      );
    }
  }
});

test("source-owned hooks replace stale class-string selectors", () => {
  const requiredHooks = [
    "[data-bb-portaled-overlay]",
    "[data-radix-menu-content]",
    "[data-radix-context-menu-content]",
    "[data-radix-hover-card-content]",
    "[data-persistent-drawer-content]",
    "[data-testid=\"command-palette\"]",
    "[data-palette-input-band]",
    "[data-promptbox-typeahead-menu]",
    "[data-promptbox]",
    "[data-tab-pill]",
    "[data-page-scroll-viewport].thread-scrollbar",
    ".text-destructive",
    "[data-highlighted]",
    ".text-destructive:hover",
  ];

  for (const hook of requiredHooks) {
    assert.ok(css.includes(hook), `missing source hook: ${hook}`);
  }

  const forbidden = [
    "form.group\\/promptbox",
    ".group\\/tab-pill",
    "[data-radix-select-trigger]",
    "#thread-detail-secondary-panel aside",
    'button[class*="border-border bg-transparent',
    'button[class*="w-fit max-w-full min-w-0"]',
    '[data-radix-menu-content] [role=menuitem]:hover',
  ];

  for (const selector of forbidden) {
    assert.ok(!css.includes(selector), `stale selector remains: ${selector}`);
  }
});

test("desktop sizing does not erase coarse-pointer targets", () => {
  assert.match(
    css,
    /@media \(min-width: 48rem\), \(pointer: fine\)/,
    "desktop-only sizing gate is missing",
  );

  const footerRule =
    ".bb-app-shell [data-follow-up-composer-footer] {\n    min-height: 1.75rem !important;";
  const footerIndex = css.indexOf(footerRule);
  assert.notEqual(footerIndex, -1, "desktop footer sizing rule is missing");
  const mediaIndex = css.lastIndexOf(
    "@media (min-width: 48rem), (pointer: fine)",
    footerIndex,
  );
  assert.notEqual(mediaIndex, -1, "footer sizing must be inside a desktop gate");
  assert.ok(
    !css.slice(mediaIndex, footerIndex).includes("\n}\n"),
    "footer sizing escaped its desktop media query",
  );

  const promptActionRule =
    "button:is(\n      [class~=\"size-auto\"][class~=\"h-8\"],\n      [class~=\"size-8\"][class~=\"p-0\"]\n    ):not([data-promptbox-submit-action]) {\n    width: 1.75rem !important;";
  const promptActionIndex = css.indexOf(promptActionRule);
  assert.notEqual(
    promptActionIndex,
    -1,
    "desktop composer action sizing rule is missing",
  );
  const promptActionMediaIndex = css.lastIndexOf(
    "@media (min-width: 48rem), (pointer: fine)",
    promptActionIndex,
  );
  assert.notEqual(
    promptActionMediaIndex,
    -1,
    "composer action sizing must be inside a desktop gate",
  );
  assert.ok(
    !css
      .slice(promptActionMediaIndex, promptActionIndex)
      .includes("\n}\n"),
    "composer action sizing escaped its desktop media query",
  );
});

test("split toolbar buttons keep a flat shared seam", () => {
  assert.ok(
    css.includes(
      'button[class~="h-7"][class~="rounded-md"][class~="bg-transparent"].rounded-r-none',
    ),
    "left SplitButton half is missing its joined outer-radius rule",
  );
  assert.ok(
    css.includes(
      'button[class~="h-7"][class~="rounded-md"][class~="bg-transparent"].rounded-l-none',
    ),
    "right SplitButton half is missing its joined outer-radius rule",
  );
  assert.match(
    css,
    /\.rounded-r-none\s*\{\s*border-radius:\s*var\(--chatgpt-radius-lg\)\s+0\s+0\s+var\(--chatgpt-radius-lg\)\s*!important;/,
  );
  assert.match(
    css,
    /\.rounded-l-none\s*\{\s*border-radius:\s*0\s+var\(--chatgpt-radius-lg\)\s+var\(--chatgpt-radius-lg\)\s+0\s*!important;/,
  );
});

test("menu selection backgrounds use the 10px control radius", () => {
  assert.match(
    css,
    /\[role=menuitemradio\]\s*\)\s*\{\s*border-radius:\s*var\(--chatgpt-radius-md\)\s*!important;/,
  );
  assert.match(
    css,
    /\[cmdk-root\] \[cmdk-item\],\s*\[cmdk-root\] \[cmdk-group-heading\]\s*\{\s*border-radius:\s*var\(--chatgpt-radius-md\)\s*!important;/,
  );
});

test("tooltip styling is scoped to host or source portal hooks", () => {
  assert.doesNotMatch(css, /(?:^|\n)\[role=tooltip\]\s*\{/);
  assert.match(css, /\[data-bb-portaled-overlay\]\[role=tooltip\]/);
  assert.match(css, /\[data-radix-tooltip-content\]/);
});

test("CSS braces are balanced", () => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  for (const character of withoutComments) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    assert.ok(depth >= 0, "unexpected closing brace");
  }
  assert.equal(depth, 0, "unbalanced CSS braces");
});
