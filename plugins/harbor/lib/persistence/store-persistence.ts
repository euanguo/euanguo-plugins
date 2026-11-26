/**
 * Schema-backed persistence codecs for sidebar stores (`groups`, `order`,
 * `viewPreferences`, and `workspacePaths`).
 */
import type { ViewPreferencesSnapshot } from "../schemas/settings.ts";
import { viewPreferencesSchema } from "../schemas/settings.ts";
import {
  groupsSnapshotSchema,
  orderSnapshotSchema,
  type GroupsSnapshot,
  type OrderSnapshot,
} from "../schemas/sidebar.ts";
import {
  workspacePathsSnapshotSchema,
  type WorkspacePaths,
} from "../schemas/workspace.ts";
import { zodCodec, type StoreSnapshotCodec } from "./snapshot.ts";

export type { GroupsSnapshot, OrderSnapshot, ViewPreferencesSnapshot };

export const GROUPS_SNAPSHOT_CODEC: StoreSnapshotCodec<GroupsSnapshot> =
  zodCodec(groupsSnapshotSchema, {
    prepare: (value) => ({
      groups: value.groups.map(({ id, name, icon, position }) => ({
        id,
        name,
        icon,
        position,
      })),
      assignment: { ...value.assignment },
    }),
  });

export const ORDER_SNAPSHOT_CODEC: StoreSnapshotCodec<OrderSnapshot> = zodCodec(
  orderSnapshotSchema,
  {
    prepare: (value) => ({
      projects: value.projects,
      families: value.families,
      workspaces: value.workspaces,
    }),
  },
);

export const VIEW_PREFERENCES_SNAPSHOT_CODEC: StoreSnapshotCodec<ViewPreferencesSnapshot> =
  zodCodec(viewPreferencesSchema, {
    prepare: (value) => ({
      projectSort: value.projectSort,
      threadSort: value.threadSort,
      worktreeSort: value.worktreeSort,
      organizationMode: value.organizationMode,
      sidebarMode: value.sidebarMode,
      scopeStrip: value.scopeStrip,
    }),
  });

export const WORKSPACE_PATHS_SNAPSHOT_CODEC: StoreSnapshotCodec<WorkspacePaths> =
  zodCodec(workspacePathsSnapshotSchema, {
    prepare: (value) => ({
      environments: value.environments,
      projects: value.projects,
    }),
  });
