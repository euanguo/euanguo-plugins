import type { Feature, FeatureAssignment } from "../lib/features.ts";
import type { RepoIdentity } from "../lib/repo-identity.ts";
import type {
  WorkspaceEnvironmentDescriptor,
  WorkspaceProjectDescriptor,
} from "../lib/workspace.ts";
import type {
  UnseenOwnedWorkspace,
  WorkspaceOwnershipMap,
} from "../lib/workspace-ownership.ts";
import {
  buildWorkspaceIndex,
  type WorkspaceIndex,
} from "../lib/workspace-index.ts";

function recordOf<T>(
  value: Readonly<Record<string, T>> | ReadonlyMap<string, T> | undefined,
): Record<string, T> {
  if (value === undefined) return {};
  if (value instanceof Map) return Object.fromEntries(value) as Record<string, T>;
  return value as Record<string, T>;
}

/** The one index the view tests build, from whichever inputs they already hold. */
export function testWorkspaceIndex(input: {
  readonly environments?:
    | Readonly<Record<string, WorkspaceEnvironmentDescriptor>>
    | ReadonlyMap<string, WorkspaceEnvironmentDescriptor>;
  readonly projects?:
    | Readonly<Record<string, WorkspaceProjectDescriptor>>
    | ReadonlyMap<string, WorkspaceProjectDescriptor>;
  readonly ownership?: WorkspaceOwnershipMap;
  readonly repos?: readonly RepoIdentity[];
  readonly unseenWorkspaces?: Readonly<
    Record<string, readonly UnseenOwnedWorkspace[]>
  >;
  readonly features?: readonly Feature[];
  readonly adoptions?: FeatureAssignment;
} = {}): WorkspaceIndex {
  return buildWorkspaceIndex({
    environments: recordOf(input.environments),
    projects: recordOf(input.projects),
    ownership: input.ownership,
    repos: input.repos,
    unseenWorkspaces: input.unseenWorkspaces,
    features: input.features,
    adoptions: input.adoptions,
  });
}
