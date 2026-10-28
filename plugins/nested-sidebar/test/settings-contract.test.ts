import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { readBackend } from "./_sources.ts";

const server = await readBackend();
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
const rpc = await readFile(
  new URL("../server/contract.ts", import.meta.url),
  "utf8",
);
const palette = await readFile(
  new URL("../components/settings/palette-editor.tsx", import.meta.url),
  "utf8",
);
const handler = await readFile(
  new URL("../server/rpc/appearance.ts", import.meta.url),
  "utf8",
);
const appearance = await readFile(
  new URL("../lib/appearance.ts", import.meta.url),
  "utf8",
);
const iconHandler = await readFile(
  new URL("../server/rpc/icons.ts", import.meta.url),
  "utf8",
);

describe("Nest settings contract", () => {
  /**
   * The split, stated once. A setting the server reads stays a descriptor; a
   * setting only the frontend draws lives in the appearance record. The two
   * lists together have to cover every key exactly once.
   */
  it("declares every setting, in the home that reads it", () => {
    assert.match(server, /bb\.settings\.define\(/);

    // The appearance record: everything no server code reads.
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
      "rowDetails",
      "worktreeLabel",
      "statusDisplay",
      "defaultChildExpansion",
      "pageSize",
      "showProviderIcons",
      "showPullRequestMetadata",
      "showRelativeTime",
      "showChildCount",
      "showThreadLocation",
      "showPinAction",
      "showSnoozeAction",
      "showSettleAction",
      "autoProjectIcons",
      "workspaceOwnership",
      "showUnregisteredWorktrees",
      "groupByRepository",
    ]) {
      assert.match(appearance, new RegExp(`\\b${key}:`), `${key} is stored`);
    }
    assert.match(appearance, /palettePreset: "Default"/);
    assert.match(appearance, /defaultChildExpansion: "Expanded"/);
    // The descriptor form keeps the switches the server reads, and nothing else.
    assert.match(server, /AGENT_TOOL_SETTING_DESCRIPTORS/);
    assert.doesNotMatch(server, new RegExp(["row", "Density"].join("")));
    assert.doesNotMatch(server, new RegExp(["Row", " density"].join("")));
  });

  it("registers one settings preview and reads live settings", () => {
    assert.match(app, /app\.slots\.settingsSection\(/);
    assert.match(app, /component: NestSettingsSection/);
    assert.match(inbox, /const \{ preferences \} = useAppearance\(\)/);
    assert.match(inbox, /style=\{nestPreferenceStyle\(preferences\)/);
    // The palette is one control that both shows a colour and changes it. The
    // read-only swatch list and the eighteen host hex fields are gone, so this
    // asserts the editor is wired rather than that a preview is drawn.
    assert.match(settings, /<PaletteEditor/);
    assert.match(palette, /type="color"/);
    assert.match(rpc, /setAppearance:/);
    assert.match(handler, /appearance\.set\(patch\)/);
  });

  it("orders the tabs by what a user comes here to change", () => {
    for (const [id, label] of [
      ["threads", "Thread list"],
      ["palette", "Palette"],
      ["projects", "Projects"],
      ["diagnostics", "Diagnostics"],
    ] as const) {
      assert.equal(
        settings.split(`id: "${id}"`).length - 1,
        1,
        `tab ${id} is declared once`,
      );
      assert.match(settings, new RegExp(`label: "${label}"`));
    }
    assert.match(settings, /<SettingsTabs/);
  });

  it("edits durable project-id colors and paints only project letter badges", () => {
    assert.match(server, /PROJECT_COLOR_MIGRATION/);
    assert.match(rpc, /listProjectColors:/);
    assert.match(rpc, /setProjectColor:/);
    assert.match(rpc, /resetProjectColor:/);
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

  it("lets each quick row action be shown or hidden independently", () => {
    for (const [label, key] of [
      ["Pin action", "showPinAction"],
      ["Snooze action", "showSnoozeAction"],
      ["Settle action", "showSettleAction"],
    ] as const) {
      assert.match(
        settings,
        new RegExp(
          `label="${label}"[\\s\\S]*?value=\\{values\\.${key}\\}[\\s\\S]*?set\\(\\{ ${key}: next \\}\\)`,
        ),
      );
      assert.match(
        card,
        new RegExp(`preferences\\.${key}`),
        `${key} reaches the row`,
      );
    }
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
    assert.match(card, /"pointer-events-none",/);
    assert.match(card, /\[&_a\]:pointer-events-auto/);
    assert.match(card, /\[&_button\]:pointer-events-auto/);
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
    // The one appearance setting the *server* reads — `detectProjectIcon` asks
    // it before probing a checkout — so the record is where it lives even
    // though the host form no longer draws it.
    assert.match(appearance, /autoProjectIcons: true,/);
    assert.match(iconHandler, /values\.autoProjectIcons !== true/);
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
    assert.match(rpc, /listProjectIcons: \{/);
    assert.match(rpc, /detectProjectIcon: \{/);
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
