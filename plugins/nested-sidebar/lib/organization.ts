/**
 * How the tree's first level is derived.
 *
 * Nest's first level has always been the user's groups. bb's own sidebar offers
 * three — by project, by machine, and custom — and this adds the machine axis.
 *
 * It does so without a second tree builder. The first level is really "a bucket
 * keyed by an id with a name and an icon", so a machine section is the same level
 * fed a different assignment: `buildTree` buckets projects by
 * `assignment[projectId]`, and nothing below it changes.
 *
 * **What "the project's machine" means, and why.** A project's checkout lives on
 * one host, and that is the machine the project is *from* — it is the answer a
 * user means by "where does this project live". Worktrees of that project on
 * another machine stay under it, because they are its worktrees: splitting a
 * project across machines would draw one project twice, which is the thing the
 * project level exists to prevent.
 *
 * A project whose source host bb does not know lands in its own section rather
 * than being dropped, and that section is last, because a guess is worse than a
 * bucket that says it is one.
 */

import type { PluginSidebarProject } from "@get-bb/plugin-sdk";
import { DEFAULT_GROUP_ICON, type GroupIconName } from "./group-icons.ts";
import type { WorkspacePaths } from "./workspace.ts";

export const ORGANIZATION_MODES = ["project", "machine"] as const;
export type OrganizationMode = (typeof ORGANIZATION_MODES)[number];

export const ORGANIZATION_LABELS: Readonly<Record<OrganizationMode, string>> = {
  project: "By project",
  machine: "By machine",
};

/**
 * `project` — the group-first tree this sidebar has always drawn.
 *
 * Named for the axis rather than for the mode: the other modes are lenses over
 * the same rows, and this one changes what the top of the tree *is*.
 */
export const DEFAULT_ORGANIZATION_MODE: OrganizationMode = "project";

export function validOrganizationMode(
  value: unknown,
): value is OrganizationMode {
  return (
    typeof value === "string" &&
    (ORGANIZATION_MODES as readonly string[]).includes(value)
  );
}

/** The section a project with no known machine lands in. */
export const UNKNOWN_MACHINE_KEY = "__unknown-machine__";

/** What a machine section is called when nothing names it. */
export const UNKNOWN_MACHINE_NAME = "Unknown machine";

/** The icon every machine section carries. */
export const MACHINE_SECTION_ICON: GroupIconName = "ComputerIcon";

export interface OrganizationSection {
  readonly id: string;
  readonly name: string;
  readonly icon: GroupIconName;
}

export interface OrganizationSections {
  /** projectId -> section id. */
  readonly assignment: Readonly<Record<string, string>>;
  /** Drawn in this order. */
  readonly sections: readonly OrganizationSection[];
}

/**
 * Projects filed by the machine their checkout lives on.
 *
 * `hostNames` comes from the threads this client is holding: `PluginSidebarThread`
 * carries `host: { id, name }`, so any thread running on a machine names it. A
 * host no thread names falls back to its id, which is opaque but true — better
 * than a section called "Machine 1" that points at nothing in particular.
 */
export function machineSections(input: {
  projects: readonly PluginSidebarProject[];
  paths: WorkspacePaths;
  hostNames: ReadonlyMap<string, string>;
}): OrganizationSections {
  const { projects, paths, hostNames } = input;
  const assigned = new Map<string, string>();
  const byId = new Map<string, OrganizationSection>();
  for (const project of projects) {
    const hostId = paths.projects[project.id]?.sourceHostId ?? null;
    const id = hostId ?? UNKNOWN_MACHINE_KEY;
    assigned.set(project.id, id);
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      name:
        hostId === null
          ? UNKNOWN_MACHINE_NAME
          : (hostNames.get(hostId) ?? hostId),
      icon: MACHINE_SECTION_ICON,
    });
  }
  // By name, then by id, so two machines that happen to share a name still hold
  // a stable order. The unknown bucket is last for the same reason it exists:
  // it is where the tree puts what it could not place.
  const sections = [...byId.values()].sort((left, right) => {
    if (left.id === UNKNOWN_MACHINE_KEY) return 1;
    if (right.id === UNKNOWN_MACHINE_KEY) return -1;
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
  return { assignment: Object.fromEntries(assigned), sections };
}

/**
 * Every host id the held threads name, mapped to what they call it.
 *
 * The first name wins: two threads on one machine agree about it, and a machine
 * bb has renamed would otherwise flip the section's title depending on which
 * thread happened to be first in the array.
 */
export function hostNamesFrom(
  threads: readonly { readonly host: { readonly id: string; readonly name: string } | null }[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const thread of threads) {
    if (thread.host === null) continue;
    if (names.has(thread.host.id)) continue;
    if (thread.host.name.length === 0) continue;
    names.set(thread.host.id, thread.host.name);
  }
  return names;
}

/**
 * The section a project is filed under, for the mode in force.
 *
 * The group mode's assignment is the user's own, already validated against the
 * groups that exist; this only has to answer for the machine mode, and it returns
 * the group one untouched so the caller has a single expression rather than two
 * branches.
 */
export function organizationFor(input: {
  mode: OrganizationMode;
  groupAssignment: Readonly<Record<string, string>>;
  groupSections: readonly OrganizationSection[];
  machine: OrganizationSections;
}): OrganizationSections {
  if (input.mode === "machine") return input.machine;
  return {
    assignment: input.groupAssignment,
    sections: input.groupSections,
  };
}

/** The icon a project with no section lands under, for the mode in force. */
export function fallbackSectionIcon(mode: OrganizationMode): GroupIconName {
  return mode === "machine" ? MACHINE_SECTION_ICON : DEFAULT_GROUP_ICON;
}