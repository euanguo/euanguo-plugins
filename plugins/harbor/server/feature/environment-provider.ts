/**
 * Native BB Environment Provider (`harbor-multi-repo`) for spinning up
 * multi-repo Harbor feature folders directly from BB's New Thread composer.
 */
import type {
  BbPluginApi,
  PluginEnvironmentProviderDeclaration,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

import { featureNameIntent, type Feature } from "../../lib/domain/features.ts";
import type { FeatureStore } from "../../lib/stores/feature-store.ts";
import { FeatureError, type RepositoryResult } from "./types.ts";

export const HARBOR_ENVIRONMENT_PROVIDER_ID = "harbor-multi-repo";

export const harborEnvironmentInputsSchema = z
  .object({
    featureId: z.string().trim().min(1).optional(),
    featureName: z.string().trim().min(1).max(60).optional(),
    slug: z.string().trim().min(1).max(40).optional(),
    baseBranch: z.string().trim().min(1).max(200).nullable().optional(),
    repositories: z
      .array(
        z.object({
          projectId: z.string().trim().min(1),
          role: z.enum(["worktree", "ref"]).default("worktree"),
          branch: z.string().trim().min(1).max(200).nullable().optional(),
        }),
      )
      .max(20)
      .optional(),
  })
  .nullable()
  .optional();

type HarborProviderDecl = PluginEnvironmentProviderDeclaration<
  Record<string, never>,
  typeof harborEnvironmentInputsSchema
>;
type AvailabilityContext = Parameters<NonNullable<HarborProviderDecl["availability"]>>[0];
type ValidateContext = Parameters<NonNullable<HarborProviderDecl["validate"]>>[0];
type CreateContext = Parameters<HarborProviderDecl["create"]>[0];
type CreateResult = Awaited<ReturnType<HarborProviderDecl["create"]>>;
type RemoveContext = Parameters<HarborProviderDecl["remove"]>[0];
type RemoveResult = Awaited<ReturnType<HarborProviderDecl["remove"]>>;

export function createHarborEnvironmentProvider(input: {
  readonly store: FeatureStore;
  readonly createFeature: (args: {
    name: string;
    slug?: string | null;
    baseBranch?: string | null;
    repositories?: readonly {
      projectId: string;
      branch: string | null;
      role?: "worktree" | "ref";
    }[];
  }) => Promise<{ feature: Feature; repositories: readonly RepositoryResult[] }>;
  readonly addRepositories: (args: {
    featureId: string;
    baseBranch?: string | null;
    repositories: readonly {
      projectId: string;
      branch?: string | null;
      role?: "worktree" | "ref";
    }[];
  }) => Promise<readonly RepositoryResult[]>;
}) {
  const { store, createFeature, addRepositories } = input;

  return {
    id: HARBOR_ENVIRONMENT_PROVIDER_ID,
    displayName: "Multi-repo workspace",
    description:
      "Multi-repo Harbor feature folder with concurrent git worktrees and read-only reference repos.",
    icon: "Layers",
    inputs: harborEnvironmentInputsSchema,
    policy: {
      retireGraceMs: null,
      pathKeys: "per-thread" as const,
    },
    availability(context: AvailabilityContext) {
      if (context.host.status !== "connected") {
        return {
          status: "unavailable" as const,
          message: `Machine "${context.host.name}" is disconnected.`,
        };
      }
      return { status: "available" as const };
    },
    validate(context: ValidateContext) {
      const raw = context.inputs;
      if (raw?.featureId !== undefined) {
        const existing = store.find(raw.featureId);
        if (existing === undefined) {
          return {
            action: "refuse" as const,
            message: "Selected feature no longer exists.",
          };
        }
        if (existing.state === "archived") {
          return {
            action: "refuse" as const,
            message: "Archived features must be reopened first.",
          };
        }
        return { action: "accept" as const };
      }
      if (raw?.featureName !== undefined && featureNameIntent(raw.featureName) === null) {
        return {
          action: "refuse" as const,
          message: "Feature name must be 1 to 60 characters.",
        };
      }
      return { action: "accept" as const };
    },
    experimental_existingPath(
      inputs: z.infer<typeof harborEnvironmentInputsSchema>,
    ): string | null {
      const featureId = inputs?.featureId;
      if (featureId === undefined) return null;
      const existing = store.find(featureId);
      if (existing === undefined || existing.state === "archived") return null;
      return existing.rootPath;
    },
    async create(context: CreateContext): Promise<CreateResult> {
      try {
        const inputs = context.inputs ?? {};
        let feature: Feature | undefined;
        let results: readonly RepositoryResult[] = [];

        if (inputs.featureId !== undefined) {
          feature = store.find(inputs.featureId);
          if (feature === undefined || feature.rootPath === null) {
            return {
              status: "failed",
              message: "Selected feature has no directory on disk.",
            };
          }
          context.report.step(`Attaching to feature "${feature.name}"`);
          if (inputs.repositories && inputs.repositories.length > 0) {
            context.report.step(
              `Preparing ${inputs.repositories.length} repositories concurrently`,
            );
            results = await addRepositories({
              featureId: feature.id,
              baseBranch: inputs.baseBranch ?? null,
              repositories: inputs.repositories.map((repo) => ({
                projectId: repo.projectId,
                branch: repo.branch ?? null,
                role: repo.role ?? "worktree",
              })),
            });
          }
        } else {
          const fallbackName =
            inputs.featureName ??
            (context.thread.title?.trim() || `${context.project.name} workspace`);
          const name = featureNameIntent(fallbackName) ?? context.suggestedBranchName;
          const repos =
            inputs.repositories && inputs.repositories.length > 0
              ? inputs.repositories.map((repo) => ({
                  projectId: repo.projectId,
                  branch: repo.branch ?? null,
                  role: repo.role ?? ("worktree" as const),
                }))
              : context.project.kind === "standard"
                ? [
                    {
                      projectId: context.project.id,
                      branch: null,
                      role: "worktree" as const,
                    },
                  ]
                : [];
          context.report.step(`Creating multi-repo feature "${name}"`);
          const created = await createFeature({
            name,
            slug: inputs.slug ?? null,
            baseBranch: inputs.baseBranch ?? null,
            repositories: repos,
          });
          feature = created.feature;
          results = created.repositories;
        }

        if (feature.rootPath === null) {
          return {
            status: "failed",
            message: "Feature directory was not initialized.",
          };
        }

        for (const item of results) {
          context.report.log(
            `${item.repository || item.projectId}: ${item.outcome}${item.reason ? ` (${item.reason})` : ""}`,
          );
        }

        await context.experimental_claimPath(feature.rootPath);
        return {
          status: "created",
          path: feature.rootPath,
          ownsPath: false,
          resource: {
            featureId: feature.id,
            slug: feature.slug,
            rootPath: feature.rootPath,
          },
        };
      } catch (error) {
        return {
          status: "failed",
          message:
            error instanceof FeatureError || error instanceof Error
              ? error.message
              : String(error),
        };
      }
    },
    async remove(_context: RemoveContext): Promise<RemoveResult> {
      // Multi-repo feature folders are lifecycle-managed explicitly through
      // Harbor's Park/Finish/Delete flows, never silently wiped on thread retire.
      return { status: "removed" };
    },
  };
}

export function registerHarborEnvironmentProvider(input: {
  readonly bb: BbPluginApi;
  readonly store: FeatureStore;
  readonly createFeature: Parameters<
    typeof createHarborEnvironmentProvider
  >[0]["createFeature"];
  readonly addRepositories: Parameters<
    typeof createHarborEnvironmentProvider
  >[0]["addRepositories"];
}): void {
  const register = input.bb.experimental_environments?.register;
  if (typeof register !== "function") return;
  register(createHarborEnvironmentProvider(input));
}
