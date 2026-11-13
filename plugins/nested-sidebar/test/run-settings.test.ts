import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseConductorJson,
  parseSettingsFile,
  parseSettingsToml,
} from "../app/scripts/settings.ts";

describe("run script settings", () => {
  it("reads the run command and the nonconcurrent default from TOML", () => {
    assert.deepEqual(
      parseSettingsToml('[scripts]\nrun = "pnpm dev"\n'),
      { run: "pnpm dev", runMode: "nonconcurrent" },
    );
    assert.deepEqual(
      parseSettingsToml('[scripts]\nrun = "pnpm dev"\nrunMode = "concurrent"\n'),
      { run: "pnpm dev", runMode: "concurrent" },
    );
  });

  it("ignores comments, other sections, and malformed values", () => {
    assert.deepEqual(
      parseSettingsToml('# note\n[other]\nrun = "nope"\n[scripts]\nrun = \'npm run dev\'\n'),
      { run: "npm run dev", runMode: "nonconcurrent" },
    );
    assert.deepEqual(parseSettingsToml("[scripts]\nrun = 42\n"), {
      run: null,
      runMode: "nonconcurrent",
    });
  });

  it("reads the older JSON file", () => {
    assert.deepEqual(
      parseConductorJson('{"scripts":{"run":"pnpm dev","runMode":"concurrent"}}'),
      { run: "pnpm dev", runMode: "concurrent" },
    );
    assert.deepEqual(parseConductorJson("not json"), {
      run: null,
      runMode: "nonconcurrent",
    });
  });

  it("picks the parser by file name", () => {
    assert.equal(
      parseSettingsFile("conductor.json", '{"scripts":{"run":"a"}}').run,
      "a",
    );
    assert.equal(
      parseSettingsFile(".conductor/settings.toml", '[scripts]\nrun = "b"\n').run,
      "b",
    );
  });
});
