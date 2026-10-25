import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
const app = await readFile(new URL("../app.tsx", import.meta.url), "utf8");
const inbox = await readFile(
  new URL("../components/inbox/thread-inbox.tsx", import.meta.url),
  "utf8",
);
const card = await readFile(
  new URL("../components/inbox/thread-card.tsx", import.meta.url),
  "utf8",
);
const settings = await readFile(
  new URL("../components/settings/nest-settings.tsx", import.meta.url),
  "utf8",
);
const projectGroup = await readFile(
  new URL("../components/inbox/project-node.tsx", import.meta.url),
  "utf8",
);
const projectColorsHook = await readFile(
  new URL("../hooks/use-project-colors.ts", import.meta.url),
  "utf8",
);
const preferences = await readFile(
  new URL("../lib/preferences.ts", import.meta.url),
  "utf8",
);
const contract = await readFile(
  new URL("../host/contract.ts", import.meta.url),
  "utf8",
);

describe("Nest settings contract", () => {
  it("declares every palette and behavior setting with safe defaults", () => {
    assert.match(server, /bb\.settings\.define\(/);
    for (const key of [
      "palettePreset",
      "workingColor",
      "workflowColor",
      "agentColor",
      "commandColor",
      "planColor",
      "goalColor",
      "waitingColor",
      "unreadColor",
      "errorColor",
      "idleColor",
      "staleColor",
      "prReviewColor",
      "prChecksColor",
      "prReadyColor",
      "prMergedColor",
      "prDraftColor",
      "prBlockedColor",
      "prClosedColor",
      "rowLayout",
      "worktreeLabel",
      "statusDisplay",
      "defaultChildExpansion",
      "showProviderIcons",
      "showPullRequestMetadata",
      "showRelativeTime",
      "showChildCount",
      "showThreadLocation",
    ]) {
      assert.match(server, new RegExp(`${key}:`));
    }
    assert.match(server, /default: "Default"/);
    assert.match(server, /default: "Expanded"/);
    assert.doesNotMatch(server, new RegExp(["row", "Density"].join("")));
    assert.doesNotMatch(server, new RegExp(["Row", " density"].join("")));
  });

  it("registers one settings preview and reads live settings", () => {
    assert.match(app, /app\.slots\.settingsSection\(/);
    assert.match(app, /component: NestSettingsSection/);
    assert.match(inbox, /const settings = useSettings\(\)/);
    assert.match(inbox, /resolveNestPreferences\(settings\.values\)/);
    assert.match(inbox, /style=\{nestPreferenceStyle\(preferences\)/);
    assert.match(settings, /familyStatusPresentation/);
    assert.match(settings, /<FamilyStatusIcon/);
    assert.match(settings, /<FamilyStatusBadge/);
    for (const label of [
      "working",
      "needs-you",
      "unread",
      "failed",
      "inactive",
      "stale",
    ]) {
      assert.match(settings, new RegExp(`"${label}"`));
    }
  });

  it("organizes the preview into the four public configuration groups", () => {
    for (const [id, title] of [
      ["appearance", "Appearance"],
      ["threads", "Thread list"],
      ["projects", "Projects and workspaces"],
      ["advanced", "Advanced behavior"],
    ] as const) {
      assert.equal(
        settings.split("id=\"" + id + "\"").length - 1,
        1,
      );
      assert.match(settings, new RegExp("title=\\\"" + title + "\\\""));
    }
    assert.match(settings, /Nest always uses Compact rows/);
    assert.match(settings, /Current layout:/);
    assert.match(settings, /Compact rows/);
    assert.equal(settings.split("data-nest-settings-group={id}").length - 1, 1);
  });

  it("edits durable project-id colors and paints only project letter badges", () => {
    assert.match(server, /PROJECT_COLOR_MIGRATION/);
    assert.match(server, /listProjectColors:/);
    assert.match(server, /setProjectColor:/);
    assert.match(server, /resetProjectColor:/);
    assert.match(server, /bb\.sdk\.projects\.get\(\{ projectId \}\)/);
    assert.match(server, /PROJECT_COLOR_CHANNEL/);
    assert.match(server, /bb\.realtime\.publish\(PROJECT_COLOR_CHANNEL/);

    assert.match(settings, /useSidebarThreads\(\)/);
    assert.match(settings, /data-nest-project-color-settings/);
    assert.match(settings, /type="color"/);
    assert.match(settings, /Badge color for \{project\.name\}/);
    assert.match(settings, /Save badge color for \$\{project\.name\}/);
    assert.match(settings, /Reset badge color for \$\{project\.name\}/);
    assert.match(settings, /Color changed elsewhere/);
    assert.match(settings, /aria-live="polite"/);

    assert.match(inbox, /useProjectColors\(\)/);
    assert.match(inbox, /projectColorOverrides=\{projectColorOverrides\}/);
    assert.match(projectGroup, /projectBadgePresentation/);
    assert.match(projectGroup, /data-nest-project-badge/);
    assert.match(projectGroup, /backgroundColor: badge\.backgroundColor/);
    assert.match(projectGroup, /color: badge\.foregroundColor/);
    assert.match(projectColorsHook, /useCoalescedRealtime\("project-colors"/);
    assert.match(projectColorsHook, /previous === "reconnecting"/);
  });

  it("uses optional metadata and layout preferences without changing defaults", () => {
    assert.match(card, /"py-1"/);
    assert.match(card, /"h-6"/);
    assert.match(card, /defaultExpanded: preferences\.defaultChildrenExpanded/);
    assert.match(card, /preferences\.showProviderIcons/);
    assert.match(card, /preferences\.showPullRequestMetadata/);
    assert.match(card, /preferences\.showRelativeTime/);
    // Non-essential fields are gated on the placement preference, which is what
    // makes a single-column row possible without losing them.
    assert.match(card, /preferences\.rowDetails === "hover"/);
    assert.match(card, /const showRowDetails = !detailsOnHover/);
  });

  it("uses a semantic full-row selection target and keeps navigation separate", () => {
    assert.match(card, /data-nest-selection-target=\{thread\.id\}/);
    assert.match(card, /aria-pressed=/);
    assert.match(card, /disabled=\{selectionDisabledReason !== null\}/);
    assert.match(card, /selectionDisabledReason === null/);
    assert.match(card, /selected: !selected/);
    assert.match(card, /shiftKey: event\.shiftKey/);
    assert.match(card, /interactive=\{!selectionMode\}/);
    assert.match(card, /disabled=\{selectionMode\}/);
    // The line around the trailing cluster is `pointer-events-none`, so a
    // control inside it is clickable only if it opts back in. Without this the
    // children chip and the park buttons were decoration.
    assert.match(card, /interactive \? "pointer-events-auto" : "pointer-events-none"/);
    assert.match(card, /actions\.open\(thread\.id/);
  });
});

const readSource = (relative: string) =>
  readFile(new URL(`../${relative}`, import.meta.url), "utf8");

/**
 * Project icons arrive from Orca (see THIRD_PARTY_NOTICES.md), and they arrive
 * in pieces that have to agree: a host that reads the checkout, a store that
 * remembers what it said, an RPC that carries it, and a badge that draws it.
 * These pin each seam, and pin the switch that turns the whole chain off.
 */
describe("Nest project icon contract", () => {
  it("declares detection as a setting that is on unless it is turned off", () => {
    const start = server.indexOf("autoProjectIcons: {");
    assert.notEqual(start, -1, "server declares the toggle");
    const descriptor = server.slice(start, start + 400);
    assert.match(descriptor, /type: "boolean"/);
    assert.match(descriptor, /default: true/);
    // The sidebar reads it with the same fallback, so a value the app has not
    // loaded yet still means "on".
    assert.match(
      preferences,
      /autoProjectIcons: readBoolean\(values\?\.autoProjectIcons, true\)/,
    );
  });

  it("reads the checkout through the host, never through the server", async () => {
    const hostEntry = await readSource("host.ts");
    assert.match(contract, /detectProjectIcon: \{/);
    assert.match(hostEntry, /detectProjectIcon: async \(input\)/);
    assert.match(server, /worktreeHost\s*\.call\(\s*"detectProjectIcon"/);
    // The server is bundled for a browser-ish resolver, so a filesystem import
    // there is a build error rather than a mistake to review.
    assert.doesNotMatch(server, /from "node:fs/);
  });

  it("stores what was found and what was looked for", () => {
    assert.match(server, /PROJECT_ICON_MIGRATION/);
    assert.match(server, /createProjectIconStore\(db\)/);
    assert.match(server, /listProjectIcons: \{/);
    assert.match(server, /detectProjectIcon: \{/);
    assert.match(server, /listProjectIcons\(\)/);
    assert.match(server, /PROJECT_ICON_CHANNEL/);
    assert.match(server, /bb\.realtime\.publish\(PROJECT_ICON_CHANNEL/);
    assert.match(server, /canonicalProjectIcon\(/);
    // Off means off: no probe is dialled while the setting is false.
    assert.match(server, /values\.autoProjectIcons !== true/);
  });

  it("asks once per project and draws the answer over the letter", async () => {
    const hook = await readSource("hooks/use-project-icons.ts");
    assert.match(hook, /useCoalescedRealtime\("project-icons"/);
    assert.match(hook, /rpc\.call\("detectProjectIcon", \{ projectId \}\)/);
    assert.match(hook, /asked\.current\.has\(id\)/);
    assert.match(hook, /defineStoreSnapshot<ProjectIconsSnapshot>/);
    assert.match(inbox, /useProjectIcons\(/);
    assert.match(inbox, /projectIcons=\{projectIcons\}/);
    assert.match(projectGroup, /projectIcons: ReadonlyMap<string, ProjectIcon>/);
    assert.match(projectGroup, /icon=\{projectIcons\.get\(node\.project\.id\)\}/);
    // The letter is what a project looks like with nothing to draw, so the
    // image may only ever be painted over it.
    assert.match(projectGroup, /<img/);
    assert.match(projectGroup, /onError=\{\(\) => setFailedSrc\(icon\.src\)\}/);
    assert.match(projectGroup, /projectBadgeLetter\(name\)/);
  });
});
