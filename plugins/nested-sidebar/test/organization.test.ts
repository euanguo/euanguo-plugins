import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { readInboxModules } from "./_sources.ts";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk";
import {
  DEFAULT_ORGANIZATION_MODE,
  MACHINE_SECTION_ICON,
  ORGANIZATION_LABELS,
  ORGANIZATION_MODES,
  UNKNOWN_MACHINE_KEY,
  UNKNOWN_MACHINE_NAME,
  fallbackSectionIcon,
  hostNamesFrom,
  machineSections,
  organizationFor,
  validOrganizationMode,
} from "../lib/organization.ts";
import type { WorkspacePaths } from "../lib/workspace.ts";

const inbox = await readInboxModules();
const viewMenu = await readFile(
  new URL("../components/inbox/view-menu.tsx", import.meta.url),
  "utf8",
);

function project(id: string): PluginSidebarProject {
  return {
    id,
    name: id,
    isPersonal: false,
    href: `/projects/${id}`,
    settingsHref: `/projects/${id}/settings`,
  };
}

function pathsFor(
  entries: readonly [projectId: string, hostId: string | null][],
): WorkspacePaths {
  return {
    environments: {},
    projects: Object.fromEntries(
      entries.map(([projectId, hostId]) => [
        projectId,
        { projectId, sourcePath: `/src/${projectId}`, sourceHostId: hostId },
      ]),
    ),
  };
}

describe("machineSections", () => {
  it("files each project under the machine its checkout lives on", () => {
    const sections = machineSections({
      projects: [project("a"), project("b"), project("c")],
      paths: pathsFor([
        ["a", "host_1"],
        ["b", "host_2"],
        ["c", "host_1"],
      ]),
      hostNames: new Map([
        ["host_1", "studio"],
        ["host_2", "laptop"],
      ]),
    });
    assert.deepEqual(sections.assignment, {
      a: "host_1",
      b: "host_2",
      c: "host_1",
    });
    assert.deepEqual(
      sections.sections.map((section) => section.name),
      ["laptop", "studio"],
    );
  });

  /**
   * A host no thread names falls back to its id. Opaque, but true — better than
   * a section called "Machine 1" that points at nothing in particular.
   */
  it("falls back to the host id when nothing names the machine", () => {
    const sections = machineSections({
      projects: [project("a")],
      paths: pathsFor([["a", "host_9"]]),
      hostNames: new Map(),
    });
    assert.equal(sections.sections[0]?.name, "host_9");
  });

  /**
   * A project whose machine bb does not know lands in a named bucket of its own
   * rather than being dropped, and that bucket is last: it is where the tree
   * puts what it could not place.
   */
  it("puts an unknown machine in its own bucket, last", () => {
    const sections = machineSections({
      projects: [project("a"), project("b")],
      paths: pathsFor([
        ["a", null],
        ["b", "host_1"],
      ]),
      hostNames: new Map([["host_1", "aaa-first-alphabetically"]]),
    });
    assert.equal(sections.assignment.a, UNKNOWN_MACHINE_KEY);
    assert.equal(sections.sections[0]?.id, "host_1");
    assert.equal(sections.sections.at(-1)?.id, UNKNOWN_MACHINE_KEY);
    assert.equal(sections.sections.at(-1)?.name, UNKNOWN_MACHINE_NAME);
  });

  it("gives every machine section the same icon", () => {
    const sections = machineSections({
      projects: [project("a")],
      paths: pathsFor([["a", "host_1"]]),
      hostNames: new Map(),
    });
    assert.equal(sections.sections[0]?.icon, MACHINE_SECTION_ICON);
  });

  it("names one section per machine, not one per project", () => {
    const sections = machineSections({
      projects: [project("a"), project("b")],
      paths: pathsFor([
        ["a", "host_1"],
        ["b", "host_1"],
      ]),
      hostNames: new Map([["host_1", "studio"]]),
    });
    assert.equal(sections.sections.length, 1);
  });

  it("has nothing to say about no projects", () => {
    const sections = machineSections({
      projects: [],
      paths: pathsFor([]),
      hostNames: new Map(),
    });
    assert.deepEqual(sections, { assignment: {}, sections: [] });
  });
});

describe("hostNamesFrom", () => {
  it("takes the first name a machine is called", () => {
    const names = hostNamesFrom([
      { host: { id: "host_1", name: "studio" } },
      { host: { id: "host_1", name: "renamed" } },
    ]);
    assert.equal(names.get("host_1"), "studio");
  });

  it("skips a thread with no host, and one with no name", () => {
    const names = hostNamesFrom([
      { host: null },
      { host: { id: "host_2", name: "" } },
    ]);
    assert.equal(names.size, 0);
  });
});

describe("organizationFor", () => {
  const groupAssignment = { a: "g1" };
  const groupSections = [{ id: "g1", name: "Work", icon: "LayerIcon" as const }];
  const machine = machineSections({
    projects: [project("a")],
    paths: pathsFor([["a", "host_1"]]),
    hostNames: new Map([["host_1", "studio"]]),
  });

  it("answers with the machine sections in machine mode", () => {
    assert.deepEqual(
      organizationFor({
        mode: "machine",
        groupAssignment,
        groupSections,
        machine,
      }),
      machine,
    );
  });

  it("hands the user's own groups back untouched in project mode", () => {
    assert.deepEqual(
      organizationFor({
        mode: "project",
        groupAssignment,
        groupSections,
        machine,
      }),
      { assignment: groupAssignment, sections: groupSections },
    );
  });

  it("gives each mode the icon its unnamed bucket carries", () => {
    assert.equal(fallbackSectionIcon("machine"), MACHINE_SECTION_ICON);
    assert.notEqual(fallbackSectionIcon("project"), MACHINE_SECTION_ICON);
  });
});

describe("the organization mode itself", () => {
  it("defaults to the groups the user made", () => {
    assert.equal(DEFAULT_ORGANIZATION_MODE, "project");
  });

  it("has a label for every mode", () => {
    for (const mode of ORGANIZATION_MODES) {
      assert.equal(typeof ORGANIZATION_LABELS[mode], "string");
    }
  });

  it("rejects a mode this build does not know", () => {
    assert.equal(validOrganizationMode("machine"), true);
    assert.equal(validOrganizationMode("by-vibes"), false);
    assert.equal(validOrganizationMode(null), false);
    assert.equal(validOrganizationMode(3), false);
  });
});

/**
 * The wiring. The mode is the one view choice that changes what the tree *is*
 * rather than how it is read, so it has to reach the tree builder, the scope
 * strip, and the menu — and the strip has to follow it, or the control would
 * point at sections the tree is not drawing.
 */
describe("organization wiring", () => {
  it("leads the view menu, because it is the coarsest decision there", () => {
    const organize = viewMenu.indexOf('label="Organize"');
    const filter = viewMenu.indexOf('label="Filter"');
    assert.ok(organize >= 0 && filter > organize);
    assert.match(viewMenu, /ORGANIZATION_MODES\.map/);
    assert.match(viewMenu, /validOrganizationMode\(next\)/);
  });

  it("feeds the tree builder the organization's sections, not the groups'", () => {
    assert.match(inbox, /assignment: organization\.assignment/);
    assert.match(inbox, /groupOrder: organization\.sections/);
    assert.match(inbox, /ungroupedIcon: fallbackSectionIcon\(viewPreferences\.organizationMode\)/);
    assert.doesNotMatch(inbox, /assignment: groupsApi\.assignment/);
  });

  it("makes the scope strip follow the organization", () => {
    assert.match(inbox, /\.\.\.organization\.sections\.map\(\(section\) => \{/);
    // The scope filter and the tab counts read the same assignment, or a tab
    // would count rows its own filter then hides.
    assert.match(
      inbox,
      /projectInScope\(\s*scope,\s*organization\.assignment,\s*organizationIds,/,
    );
    assert.equal(
      (inbox.match(/projectInScope\(\s*scope,\s*organization\.assignment,\s*organizationIds,/g) ?? []).length,
      2,
    );
  });

  /**
   * A stored scope resolves against the organization's ids, which is what makes
   * a mode change safe: a group id is not a machine id, so a scope left on a
   * group degrades to All the moment the tree stops drawing groups.
   */
  it("resolves the stored scope against the organization", () => {
    assert.match(inbox, /resolveGroupScope\(viewState\.scope, organizationIds\)/);
    assert.doesNotMatch(
      inbox,
      /resolveGroupScope\(\s*viewState\.scope,\s*new Set\(groupsApi\.groups/,
    );
  });

  // Ungrouped is a group-mode destination. A project whose machine bb does not
  // know lands in a named section instead, which says why it is there.
  it("keeps the Ungrouped tab to the group mode", () => {
    assert.match(inbox, /viewPreferences\.organizationMode === "project" &&/);
  });

  it("resets the mode, and the lens Reset view had been forgetting", () => {
    assert.match(inbox, /viewPreferences\.setOrganizationMode\(DEFAULT_ORGANIZATION_MODE\)/);
    assert.match(inbox, /viewPreferences\.setWorktreeSort\("manual"\)/);
  });
});
