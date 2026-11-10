/**
 * Project-level administration: renaming, removing, and starting a thread.
 *
 * `spawnThread` is the one handler here with a rewrite in it — see the comment
 * on the method for why the request is not forwarded verbatim.
 */
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { nestRpcContract } from "../contract.ts";

/** This module's slice of the contract, with every other method omitted. */
type Handlers<Method extends keyof typeof nestRpcContract> = Pick<
  PluginRpcHandlers<typeof nestRpcContract>,
  Method
>;
import { GROUP_CHANNEL } from "../../lib/realtime-channels.ts";
import type { createGroupStore } from "../../lib/group-store.ts";
import type { createOrderStore } from "../../lib/order-store.ts";
import type { SidebarIndex } from "../../lib/agent/index-cache.ts";
import { environmentFiledUnder } from "../../lib/workspace-ownership.ts";
import type { NestAgentActions } from "../../lib/agent/actions.ts";

export interface ProjectHandlerDeps {
  readonly bb: BbPluginApi;
  readonly groups: ReturnType<typeof createGroupStore>;
  readonly orders: ReturnType<typeof createOrderStore>;
  readonly nestActions: NestAgentActions;
  readonly refreshSidebarIndex: () => Promise<SidebarIndex | null>;
}

export function projectHandlers(
  deps: ProjectHandlerDeps,
): Handlers<"renameProject" | "renameEnvironment" | "removeProject" | "spawnThread" | "listProviders"> {
  const { bb, groups, orders, nestActions, refreshSidebarIndex } = deps;

  return {
    async renameProject({ projectId, name }) {
      const project = await bb.sdk.projects.update({ projectId, name });
      return { name: project.name };
    },

    async renameEnvironment({ environmentId, name }) {
      return { name: await nestActions.setWorkspaceAlias(environmentId, name) };
    },

    async removeProject({ projectId, expectedName }) {
      // Re-read before deleting: the dialog confirmed against a name, and a
      // project renamed in the meantime is not the one the user agreed to.
      const project = await bb.sdk.projects.get({ projectId });
      if (project.name !== expectedName) return { ok: false };
      await bb.sdk.projects.delete({ projectId });
      // A deleted project must not leave a member row pointing at nothing.
      groups.assign(projectId, null);
      orders.removeProject(projectId);
      bb.realtime.publish(GROUP_CHANNEL, {});
      return { ok: true };
    },

    async spawnThread({ request }) {
      const projectId = request.projectId;
      if (typeof projectId !== "string" || projectId.trim().length === 0) {
        throw new Error("A project is required to create a thread.");
      }
      const environment = request.environment;
      let environment2 = environment as SpawnRequest["environment"];
      if (isReuseEnvironment(environment)) {
        const index = await refreshSidebarIndex();
        const ownership = index?.repoFacts.workspaceOwnership ?? {};
        const row = ownership[environment.environmentId];
        const ownerProjectId = row?.ownerProjectId ?? null;
        if (ownerProjectId !== null && ownerProjectId !== projectId) {
          throw new Error(
            `This workspace belongs to ${ownerProjectId}, not ${projectId}. ` +
              "Choose the owning project or another workspace.",
          );
        }
        // The host checks the *record's* project, not the directory's: a reuse
        // of an environment filed under another project is
        // `409 Environment belongs to a different project`. Two records can
        // point at one directory — a personal workspace opened before the
        // project existed is the common one — so when the seeded id is such a
        // record, launch from the record of the same directory that bb files
        // under this project. The tree prefers that record too (see
        // `chooseCanonicalEnvironment`); this covers a stale client.
        const claimedProjectId = row?.claimedProjectId ?? null;
        if (claimedProjectId !== null && claimedProjectId !== projectId) {
          const replacement = environmentFiledUnder(
            ownership,
            row?.workspaceKey ?? null,
            projectId,
          );
          if (replacement === null) {
            throw new Error(
              `bb files this workspace under another project (${claimedProjectId}), ` +
                "so a thread cannot be created here as " +
                `${projectId}. Remove the duplicate workspace, or start from ` +
                "the project's own checkout.",
            );
          }
          environment2 = { ...environment, environmentId: replacement };
        }
      }
      // SAFETY: `request` is the composer's own new-thread request, forwarded
      // verbatim. The contract declares it as an open record on purpose — the
      // composer owns that shape and this plugin does not restate it — so the
      // two types cannot be compared structurally. The host validates every
      // field it reads (`threads.spawn` drops a `providerId`/`model` it does
      // not accept), and the one field this handler needs, `projectId`, is
      // checked immediately above.
      //
      // Two deliberate rewrites, both about the project's remembered execution
      // defaults. A user picks a model here and expects the next `+` to start
      // from it; without these it silently does not.
      //
      // 1. `origin: "app"`. The server writes `project_execution_defaults`
      //    only when the create's origin is `app`
      //    (`shouldRememberProjectExecutionDefaults`), so a `plugin` spawn
      //    never records anything. Measured: a thread created through this
      //    dialog left the project's defaults at `null`, and the next `+` came
      //    back to the product default. The cost is `originPluginId`, which
      //    nothing in this plugin reads.
      // 2. Every execution field the user touched is marked `explicit`. The
      //    composer reports per-field provenance, and the server drops a value
      //    whose field is absent from it (`resolveRequestedCreateExecutionValue`)
      //    — which is what made a changed reasoning level arrive as `medium`
      //    instead of the chosen `High`. The dialog's own wrapper only marks
      //    `providerId`, so the rest is filled in here.
      const request2 = request as unknown as Parameters<
        typeof bb.sdk.threads.spawn
      >[0];
      const spawned = await bb.sdk.threads.spawn({
        ...request2,
        ...(environment2 === environment ? {} : { environment: environment2 }),
        origin: "app",
        executionInputSources: {
          providerId: "explicit",
          model: "explicit",
          reasoningLevel: "explicit",
          permissionMode: "explicit",
          ...(request2.serviceTier === undefined
            ? {}
            : { serviceTier: "explicit" as const }),
        },
      });
      return { threadId: spawned.id ?? null };
    },

    // A custom ACP provider already carries its own brand mark, so the sidebar
    // reads it from the host rather than hard-coding a second glyph per agent.
    async listProviders() {
      const providers = await bb.sdk.providers.list();
      return {
        providers: providers.map(({ id, displayName, logoUrl }) => ({
          id,
          displayName,
          logoUrl,
        })),
      };
    },
  };
}

type ReuseEnvironment = { readonly type: "reuse"; readonly environmentId: string };

/** bb's own create-thread request, as the SDK declares it. */
type SpawnRequest = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];

/** The composer's "reuse an existing environment" shape, narrowed. */
function isReuseEnvironment(value: unknown): value is ReuseEnvironment {
  if (typeof value !== "object" || value === null) return false;
  return (
    (value as { type?: unknown }).type === "reuse" &&
    typeof (value as { environmentId?: unknown }).environmentId === "string"
  );
}
