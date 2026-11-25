import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import {
  FEATURE_HUB_TAB_REF,
  resolveThreadFeature,
} from "../components/feature-hub/hub-tab-ref.ts";
import {
  buildFeatureView,
  formatWakeLabel,
  ownedFeatureIds,
  parkReasonLabel,
} from "../lib/domain/feature-view.ts";
import { familyStatusPresentation } from "../lib/domain/family-status.ts";
import type { Feature } from "../lib/domain/features.ts";
import { buildInboxView } from "../lib/domain/inbox-view.ts";
import type { WorkspacePaths } from "../lib/domain/workspace.ts";
import { idleSettleableTabIds, type WorkspaceTab } from "../lib/domain/workspace-tabs.ts";
import { testWorkspaceIndex } from "./_workspace-index.ts";

function sampleFeature(id: string, overrides: Partial<Feature> = {}): Feature {
  return {
    id,
    name: `Feature ${id}`,
    slug: id,
    state: "active",
    position: 0,
    rootPath: `/repos/harbor-features/${id}`,
    hostId: "host_1",
    ...overrides,
  };
}

describe("Harbor 2.0 UI Cockpit logic and integrations", () => {
  it("formats park reasons and wake countdown labels", () => {
    assert.equal(parkReasonLabel("waiting-qa"), "Waiting QA");
    assert.equal(parkReasonLabel("waiting-backend"), "Waiting Backend");
    assert.equal(parkReasonLabel("Blocked by Gateway v2"), "Blocked by Gateway v2");
    assert.equal(parkReasonLabel("   "), null);

    const now = 1_000_000;
    assert.equal(formatWakeLabel(now - 10, now), "Due now");
    assert.equal(formatWakeLabel(now + 20 * 60_000, now), "Wake in 20m");
    assert.equal(formatWakeLabel(now + 4 * 3_600_000, now), "Wake in 4h");
    assert.equal(formatWakeLabel(now + 3 * 24 * 3_600_000, now), "Wake in 3d");
    assert.equal(formatWakeLabel(null, now), null);
  });

  it("keeps parked feature worktrees owned and suppresses duplicate project rows", () => {
    const active = sampleFeature("active-one", { state: "active", position: 0 });
    const parked = sampleFeature("parked-one", {
      state: "parked",
      parkedAt: 5000,
      parkedReason: "waiting-qa",
      position: 1,
    });
    const archived = sampleFeature("done-one", { state: "archived", position: 2 });
    const owned = ownedFeatureIds([active, parked, archived]);
    assert.equal(owned.has("active-one"), true);
    assert.equal(owned.has("parked-one"), true);
    assert.equal(owned.has("done-one"), false);

    const paths: WorkspacePaths = {
      environments: {
        env_main: {
          id: "env_main",
          projectId: "prj_web",
          hostId: "host_1",
          path: "/repos/acme-web",
          isGitRepo: true,
          isWorktree: false,
          branchName: "main",
          name: null,
          providerId: null,
          workspaceDisplayKind: null,
        },
        env_parked: {
          id: "env_parked",
          projectId: "prj_web",
          hostId: "host_1",
          path: "/repos/harbor-features/parked-one/acme-web",
          isGitRepo: true,
          isWorktree: true,
          branchName: "feat/parked-one",
          name: null,
          providerId: null,
          workspaceDisplayKind: "unmanaged-worktree",
        },
      },
      projects: {
        prj_web: { projectId: "prj_web", sourcePath: "/repos/acme-web", sourceHostId: "host_1" },
      },
    };
    const features = [active, parked, archived];
    const index = testWorkspaceIndex({
      environments: paths.environments,
      projects: paths.projects,
      features,
    });
    const projects: PluginSidebarProject[] = [
      { id: "prj_web", name: "acme-web", isPersonal: false, href: "/p/web", settingsHref: "/p/web/s" },
    ];
    const featureView = buildFeatureView({
      families: [],
      features,
      members: [],
      workspaceIndex: index,
      showEmpty: true,
      searchQuery: "",
      projectNames: new Map([["prj_web", "acme-web"]]),
      scope: { kind: "all" },
      now: 10_000,
    });
    assert.deepEqual(
      featureView.features.map((node) => node.feature.id),
      ["active-one"],
    );
    assert.deepEqual(
      featureView.parked.map((item) => item.id),
      ["parked-one"],
    );
    assert.deepEqual(
      featureView.archived.map((item) => item.id),
      ["done-one"],
    );

    const inbox = buildInboxView({
      threads: [],
      projects,
      parkedThreadIds: new Set(),
      shelfFor: () => "active",
      wakeAtFor: () => null,
      now: 10_000,
      filterPreset: "all",
      searchQuery: "",
      selectedRootIds: new Set(),
      selectionMode: false,
      groupScope: { kind: "all" },
      organization: { assignment: {}, sections: [] },
      organizationIds: new Set(),
      groups: [],
      groupIcons: { all: "Layer", ungrouped: "Layer" },
      viewPreferences: {
        organizationMode: "project",
        projectSort: "manual",
        threadSort: "manual",
        worktreeSort: "manual",
      },
      projectOrder: {},
      familyOrder: {},
      workspaceOrder: {},
      paths,
      repoFacts: { repoKeyByProject: {} },
      workspaceOwnership: undefined,
      workspaceIndex: index,
      sidebarMode: "workspaces",
      mergeRepos: false,
      features,
      featureAdoptions: {},
    });
    assert.equal(inbox.parkedFeatures.length, 1);
    const webNode = inbox.treeNodes
      .flatMap((g) => g.projects)
      .find((p) => p.project.id === "prj_web");
    assert.deepEqual(
      webNode?.workspaces.map((w) => w.ref.path),
      ["/repos/acme-web"],
    );
  });

  it("validates Feature Hub deep-link targets and resolves thread owners by path or adoption", () => {
    const validate = FEATURE_HUB_TAB_REF.experimental_target.validate;
    assert.equal(validate({ section: "changes", directory: "acme-api" }), true);
    assert.equal(validate({ section: "invalid" }), false);
    assert.equal(validate(null), false);

    const active = sampleFeature("sync", { state: "active" });
    const parked = sampleFeature("qa-wait", { state: "parked" });
    const done = sampleFeature("old", { state: "archived" });

    assert.equal(
      resolveThreadFeature({
        environmentId: "e1",
        environmentPath: "/repos/harbor-features/sync/acme-web",
        features: [active, parked, done],
        adoptions: {},
      })?.id,
      "sync",
    );
    assert.equal(
      resolveThreadFeature({
        environmentId: "env_adopted",
        environmentPath: "/repos/other/acme-web",
        features: [active, parked, done],
        adoptions: { env_adopted: "qa-wait" },
      })?.id,
      "qa-wait",
    );
    assert.equal(
      resolveThreadFeature({
        environmentId: "e_done",
        environmentPath: "/repos/harbor-features/old",
        features: [active, parked, done],
        adoptions: {},
      }),
      null,
    );
  });

  it("identifies non-pinned, non-active idle and stale tabs for batch settle", () => {
    const mkTab = (
      id: string,
      kind: WorkspaceTab["status"]["kind"],
      isPinned = false,
    ): WorkspaceTab =>
      ({
        thread: {
          id,
          isPinned,
          displayTitle: id,
          projectId: "prj_1",
          providerId: "codex",
        } as PluginSidebarThread,
        status: familyStatusPresentation(kind),
        childCount: 0,
      }) as WorkspaceTab;

    const tabs: WorkspaceTab[] = [
      mkTab("t_pin", "inactive", true),
      mkTab("t_cur", "inactive", false),
      mkTab("t_work", "working", false),
      mkTab("t_idle", "inactive", false),
      mkTab("t_stale", "stale", false),
    ];
    assert.deepEqual(idleSettleableTabIds(tabs, "t_cur"), ["t_idle", "t_stale"]);
  });

  it("registers Feature Hub tab, ThreadContextCard slots, and experimental_Diff in app wiring", async () => {
    const [appSrc, changesSrc] = await Promise.all([
      readFile(new URL("../app.tsx", import.meta.url), "utf8"),
      readFile(new URL("../components/feature-hub/feature-hub-changes.tsx", import.meta.url), "utf8"),
    ]);
    assert.match(appSrc, /experimental_tab\(/u);
    assert.match(appSrc, /FEATURE_HUB_TAB_REF/u);
    assert.match(appSrc, /experimental_threadContextCardRow\(/u);
    assert.match(appSrc, /experimental_threadContextCardSection\(/u);
    assert.match(changesSrc, /experimental_Diff/u);
  });
});
