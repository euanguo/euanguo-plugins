import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFile(new URL("../" + relative, import.meta.url), "utf8");

const [editor, appearance, store, handler, roles, contract, server, settings] =
  await Promise.all([
    read("components/settings/palette-editor.tsx"),
    read("lib/appearance.ts"),
    read("lib/appearance-store.ts"),
    read("server/rpc/appearance.ts"),
    read("lib/color-roles.ts"),
    read("server/contract.ts"),
    read("server.ts"),
    read("components/settings/nest-settings.tsx"),
  ]);

describe("palette contract", () => {
  /**
   * One control per colour. The settings page used to draw the same eighteen
   * roles twice: eighteen hex fields in the host's form, which could be changed
   * but not seen, and a read-only swatch list in the plugin's section, which
   * could be seen but not changed. Both are gone; the swatch is the input.
   */
  it("draws a colour and edits it in the same control", () => {
    assert.match(editor, /type="color"/);
    assert.match(editor, /style=\{\{ backgroundColor: hex \}\}/);
    assert.match(editor, /aria-label=\{`\$\{label\} colour`\}/);
    // A swatch that is only a colour cannot be typed; a field that is only a
    // field cannot be seen. Both live on one row.
    assert.match(editor, /aria-label=\{`\$\{label\} hex`\}/);
  });

  /**
   * The swatch shows the **stored** value, not the resolved one.
   *
   * Resolved colours are theme tokens whenever the preset is not Custom, and
   * `<input type="color">` silently ignores a token — the first draft fed it the
   * resolved value and every picker opened on black. Reading the stored literal
   * hex makes the whole class of bug impossible instead of resolving it.
   */
  it("reads the stored hex, never a theme token", () => {
    assert.match(editor, /values\[keyOf\(role as SemanticColorRole\)\]/);
    assert.doesNotMatch(editor, /preferences\.colors/);
    assert.doesNotMatch(editor, /resolveToHex/);
    assert.doesNotMatch(editor, /getComputedStyle/);
  });

  it("keeps every role in one table, grouped by what it colours", () => {
    for (const group of ["status", "activity", "pull-request"]) {
      assert.ok(roles.includes(`group: "${group}"`), `${group} is a group`);
    }
    // Eighteen roles, once. The label a user reads and the setting key it maps
    // to both come from here rather than being restated per surface.
    const roleEntries = roles.match(/\{ role: "/g) ?? [];
    assert.equal(roleEntries.length, 18);
    for (const key of ["workingColor", "prClosedColor", "idleColor"]) {
      assert.ok(roles.includes(key), `${key} has a setting key`);
    }
  });

  /**
   * Choosing a colour is a request to see it. Storing one while a preset
   * overrides it would read as a broken control, so the preset follows.
   */
  it("switches the preset to Custom when a colour is chosen", () => {
    assert.match(settings, /palettePreset: "Custom"/);
  });
});

describe("appearance storage", () => {
  /**
   * The split that decides where a setting lives: the server reads an agent
   * switch when it decides whether to register a tool, so that stays a
   * descriptor. Nothing on the server reads a colour or a row layout, so those
   * are the plugin's — which is what lets the settings page draw them.
   */
  it("keeps only the descriptors the server reads", () => {
    const define = server.slice(
      server.indexOf("bb.settings.define({"),
      server.indexOf("const appearance = createAppearanceStore"),
    );
    assert.match(define, /AGENT_TOOL_SETTING_DESCRIPTORS/);
    for (const gone of [
      "rowLayout:",
      "palettePreset:",
      "workingColor:",
      "showRelativeTime:",
      "autoProjectIcons:",
    ]) {
      assert.ok(!define.includes(gone), `${gone} is not a descriptor`);
    }
  });

  it("writes through the plugin's store, and reads it back", () => {
    assert.match(store, /bb\.storage\.kv\.set/);
    assert.match(store, /bb\.storage\.kv\.get/);
    assert.match(handler, /bb\.realtime\.publish\(APPEARANCE_CHANNEL/);
    assert.match(contract, /getAppearance:/);
    assert.match(contract, /setAppearance:/);
    // The record comes back from a write, so a rejected value is visible to the
    // control that offered it instead of being silently dropped.
    assert.match(handler, /return next/);
  });

  /**
   * There is no migration, and that is a decision rather than an omission.
   *
   * `bb.settings.get()` answers only for keys the handle still declares, so
   * removing a descriptor makes its stored value unreachable. A migration would
   * always find nothing and then report success — worse than not having one,
   * because it would look like the values were carried over.
   */
  it("does not pretend to migrate values it cannot read", () => {
    assert.doesNotMatch(store, /migrateFromSettings/);
    assert.doesNotMatch(store, /MIGRATED_KV_KEY/);
    assert.doesNotMatch(server, /migrateFromSettings/);
    // The move is documented where the values live.
    assert.match(store, /one-time reset to the defaults/);
  });

  it("validates by the type each default declares", () => {
    assert.match(appearance, /validAppearanceValue/);
    for (const key of [
      "rowLayout:",
      "pageSize: DEFAULT_PAGE_SIZE",
      "workingColor: CUSTOM_COLOR_DEFAULTS.working",
      "groupByRepository: false",
    ]) {
      assert.ok(appearance.includes(key), `default present: ${key}`);
    }
  });
});
