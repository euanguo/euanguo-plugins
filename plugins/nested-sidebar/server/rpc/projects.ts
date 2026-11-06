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
      if (
        typeof environment === "object" &&
        environment !== null &&
        "type" in environment &&
        environment.type === "reuse" &&
        "environmentId" in environment &&
        typeof environment.environmentId === "string"
      ) {
        const index = await refreshSidebarIndex();
        const ownerProjectId =
          index?.repoFacts.workspaceOwnership[environment.environmentId]
            ?.ownerProjectId ?? null;
        if (ownerProjectId !== null && ownerProjectId !== projectId) {
          throw new Error(
            `This workspace belongs to ${ownerProjectId}, not ${projectId}. ` +
              "Choose the owning project or another workspace.",
          );
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
