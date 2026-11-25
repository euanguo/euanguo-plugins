import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { worktreeDirectoryContract } from "../../host/contract.ts";
import type { FeatureMetaSummary } from "../../lib/domain/feature-meta.ts";
import type {
  Feature,
  FeatureAssignment,
  FeatureMember,
  FeatureRefLink,
} from "../../lib/domain/features.ts";
import { RpcError, type RpcErrorCode } from "../../lib/domain/rpc-error.ts";
import type { FeatureMetaStore } from "../../lib/stores/feature-meta-store.ts";
import type { FeatureRepository } from "../../lib/stores/feature-repository.ts";
import type { FeatureStore } from "../../lib/stores/feature-store.ts";
import type { HostCall } from "./containers.ts";

export const PROBE_TIMEOUT_MS = 30_000;
export const CREATE_TIMEOUT_MS = 180_000;
export const SCAN_TIMEOUT_MS = 30_000;

/** The single call shape the host entry exposes. */
export interface FeatureHost {
  call<Method extends keyof typeof worktreeDirectoryContract>(
    method: Method,
    input: unknown,
    options: { hostId: string; timeoutMs: number },
  ): Promise<unknown>;
}

export interface FeatureSnapshot {
  readonly features: readonly Feature[];
  readonly adoptions: FeatureAssignment;
  readonly members: readonly FeatureMember[];
  readonly refLinks: readonly FeatureRefLink[];
  /**
   * A feature container path -> the Features project at that path.
   *
   * Keyed by path, not by host: a feature created before the root moved still
   * lives under the old one, and its conversations must stay in the project
   * whose source is that folder.
   */
  readonly homeProjects: Readonly<Record<string, string>>;
  /**
   * Every bb project that is a feature container, old roots included.
   *
   * The project view hides all of them: their rows are feature folders, which
   * the feature view already draws by the feature's name.
   */
  readonly featureProjectIds: readonly string[];
  /**
   * Hosts whose repository scan failed during the last refresh.
   *
   * A failed scan leaves the previous member list in place, which is the right
   * answer for drawing a row and the wrong answer for deciding what to delete.
   * The destructive paths refuse while the feature's host is in this set.
   */
  readonly memberScanFailures: readonly string[];
  /**
   * What each feature has recorded besides its folder: counts only.
   *
   * The sidebar draws a line per feature, not the decision log, so the list read
   * carries just enough to say "2 decisions, 1 open question". The dialog asks
   * for the full records when it opens.
   */
  readonly meta: Readonly<Record<string, FeatureMetaSummary>>;
}

export interface RepositoryResult {
  readonly projectId: string;
  readonly repository: string;
  readonly outcome: "created" | "reused" | "blocked";
  readonly path: string | null;
  readonly branch: string | null;
  readonly role?: "worktree" | "ref";
  readonly setup: readonly string[];
  readonly reason: string | null;
}

export class FeatureError extends RpcError {
  constructor(message: string, code: RpcErrorCode = "invalid") {
    super(code, message);
  }
}

export interface FeatureServiceCore {
  readonly bb: BbPluginApi;
  readonly store: FeatureStore;
  readonly metaStore: FeatureMetaStore;
  readonly repository: FeatureRepository;
  readonly projectSource: (
    projectId: string,
  ) => Promise<{ path: string; hostId: string } | null>;
  readonly call: HostCall;
  readonly publish: () => void;
  readonly invalidate: (tags: readonly string[]) => void;
  readonly getCached: () => FeatureSnapshot;
  readonly setCached: (next: FeatureSnapshot) => void;
  readonly membersOf: (featureId: string) => readonly FeatureMember[];
  readonly requireFeature: (featureId: string) => Feature;
  readonly writeContext: (
    feature: Feature,
    members: readonly FeatureMember[],
  ) => Promise<boolean>;
  readonly homeOf: (hostId: string) => Promise<string>;
  readonly ensureDirectory: (path: string, hostId: string) => Promise<void>;
  readonly featuresFolderOf: (hostId: string) => Promise<string>;
  readonly homeProjectOf: (hostId: string, folder: string) => Promise<string | null>;
  readonly pickHost: (projectIds: readonly string[]) => Promise<string>;
}
