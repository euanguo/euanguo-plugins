/**
 * Coalesced per-feature writer for `AGENTS.md`, `CLAUDE.md`, `.harbor-feature.json`,
 * and `<slug>.code-workspace` so concurrent updates never drop the newest state
 * while duplicate writes stay deduplicated.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { renderFeatureSummary } from "../../lib/domain/feature-context.ts";
import {
  featureBranch,
  type Feature,
  type FeatureMember,
} from "../../lib/domain/features.ts";
import type { FeatureMetaStore } from "../../lib/stores/feature-meta-store.ts";
import type { HostCall } from "./containers.ts";
import { messageOf } from "./removal-ops.ts";
import { PROBE_TIMEOUT_MS } from "./types.ts";

export function createFeatureContextWriter(input: {
  readonly bb: BbPluginApi;
  readonly metaStore: FeatureMetaStore;
  readonly call: HostCall;
  readonly contextWritten: Set<string>;
}) {
  const { bb, metaStore, call, contextWritten } = input;
  const contextInFlight = new Map<
    string,
    { readonly key: string; readonly promise: Promise<boolean> }
  >();
  const contextPending = new Map<
    string,
    {
      key: string;
      feature: Feature;
      members: readonly FeatureMember[];
      promise: Promise<boolean>;
      resolve: (ok: boolean) => void;
    }
  >();

  const contextSignature = (
    feature: Feature,
    members: readonly FeatureMember[],
    summary: string,
  ): string =>
    JSON.stringify([
      feature.name,
      feature.slug,
      feature.rootPath,
      feature.hostId,
      summary,
      members.map((member) => [
        member.directory,
        member.repository,
        member.branch,
        member.path,
        member.role ?? "worktree",
      ]),
    ]);

  const performWriteContext = async (
    feature: Feature,
    members: readonly FeatureMember[],
    summary: string,
  ): Promise<boolean> => {
    if (feature.rootPath === null || feature.hostId === null) return false;
    const answer = await call<{ status: "ok" } | { status: "failed"; message: string }>(
      "writeFeatureContext",
      {
        featureDirectory: feature.rootPath,
        id: feature.id,
        name: feature.name,
        slug: feature.slug,
        suggestedBranch: featureBranch(feature.slug),
        summary,
        members: members.map((member) => ({
          directory: member.directory,
          repository: member.repository,
          branch: member.branch,
          path: member.path,
          ...(member.role === undefined ? {} : { role: member.role }),
        })),
      },
      feature.hostId,
      PROBE_TIMEOUT_MS,
    ).catch((error: unknown) => ({ status: "failed" as const, message: messageOf(error) }));
    if (answer.status === "failed") {
      bb.log.warn(`could not write the context files of ${feature.slug}: ${answer.message}`);
      return false;
    }
    contextWritten.add(feature.id);
    return true;
  };

  const writeContext = (
    feature: Feature,
    members: readonly FeatureMember[],
  ): Promise<boolean> => {
    const summary = renderFeatureSummary(metaStore.meta(feature.id));
    const key = contextSignature(feature, members, summary);
    const running = contextInFlight.get(feature.id);
    if (running !== undefined) {
      const existing = contextPending.get(feature.id);
      if (existing === undefined && running.key === key) {
        return running.promise;
      }
      if (existing !== undefined) {
        existing.key = key;
        existing.feature = feature;
        existing.members = members;
        return existing.promise;
      }
      let resolvePending!: (ok: boolean) => void;
      const promise = new Promise<boolean>((resolve) => {
        resolvePending = resolve;
      });
      contextPending.set(feature.id, {
        key,
        feature,
        members,
        promise,
        resolve: resolvePending,
      });
      return promise;
    }
    const active = performWriteContext(feature, members, summary).finally(() => {
      if (contextInFlight.get(feature.id)?.promise === active) {
        contextInFlight.delete(feature.id);
      }
      const next = contextPending.get(feature.id);
      if (next !== undefined) {
        contextPending.delete(feature.id);
        void writeContext(next.feature, next.members).then(next.resolve);
      }
    });
    contextInFlight.set(feature.id, { key, promise: active });
    return active;
  };

  return { writeContext };
}
