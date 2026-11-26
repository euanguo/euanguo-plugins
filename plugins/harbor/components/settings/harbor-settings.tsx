import {
  experimental_useSidebarThreads as useSidebarThreads,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentFeaturesPanel } from "@/components/settings/agent-features-panel";
import { RepoFactsPanel } from "@/components/settings/repo-facts-panel";
import {
  type SettingsSectionTab,
  type SettingsTabId,
  SettingsTabs,
} from "@/components/settings/settings-tabs";
import { SidebarLayoutPanel } from "@/components/settings/sidebar-layout-panel";
import { Button } from "@bb-ui/button";
import { Icon } from "@bb-ui/icon";
import { useAppearance } from "@/hooks/use-appearance";
import { useCoalescedRealtime } from "@/hooks/use-coalesced-realtime";
import { useFeatures } from "@/hooks/use-features";
import { useProjectColors } from "@/hooks/use-project-colors";
import { useRepoFacts } from "@/hooks/use-repo-facts";
import { useWorkspacePaths } from "@/hooks/use-workspace-paths";
import {
  AGENT_ACCESS_CHANNEL,
  type AgentAccessTier,
  DEFAULT_AGENT_ACCESS_TIER,
} from "@/lib/domain/agent-access";
import { APPEARANCE_DEFAULTS } from "@/lib/domain/appearance";
import { errorMessage } from "@/lib/domain/rpc-error";
import type { harborRpcContract } from "@/server/contract";

export function HarborSettingsSection() {
  const rpc = useRpc<typeof harborRpcContract>();
  const [activeTab, setActiveTab] = useState<SettingsTabId>("sidebar");
  const { values, preferences, ready, error, clearError, set } =
    useAppearance();
  const { projects } = useSidebarThreads();
  const projectColors = useProjectColors();
  const facts = useRepoFacts();
  const paths = useWorkspacePaths();
  const {
    features,
    members,
    ready: featuresReady,
  } = useFeatures();

  const [agentTier, setAgentTier] = useState<AgentAccessTier>(
    DEFAULT_AGENT_ACCESS_TIER,
  );
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentNonce, setAgentNonce] = useState(0);
  const agentSeqRef = useRef(0);

  const refreshAgentAccess = useCallback(
    () => setAgentNonce((value) => value + 1),
    [],
  );
  useCoalescedRealtime(AGENT_ACCESS_CHANNEL, refreshAgentAccess);

  useEffect(() => {
    let cancelled = false;
    rpc
      .call("getAgentAccess", {})
      .then((result) => {
        if (cancelled) return;
        setAgentTier(result.tier);
        setAgentError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setAgentError(
          errorMessage(caught, "Could not load Agent access setting."),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [agentNonce, rpc]);

  const handleChangeAgentTier = useCallback(
    (nextTier: AgentAccessTier) => {
      const seq = ++agentSeqRef.current;
      setAgentBusy(true);
      setAgentError(null);
      setAgentTier(nextTier);
      rpc
        .call("setAgentAccess", { tier: nextTier })
        .then((result) => {
          if (seq === agentSeqRef.current) {
            setAgentTier(result.tier);
          }
        })
        .catch((caught: unknown) => {
          setAgentError(
            errorMessage(caught, "Could not update Agent access setting."),
          );
          refreshAgentAccess();
        })
        .finally(() => {
          if (seq === agentSeqRef.current) {
            setAgentBusy(false);
          }
        });
    },
    [refreshAgentAccess, rpc],
  );

  const diagnosticsCount = useMemo(() => {
    const conflictCount = Object.values(facts.workspaceOwnership).filter(
      (entry) => entry.conflict,
    ).length;
    const unseenCount = facts.repos.reduce(
      (sum, repo) => sum + repo.unseenWorktrees.length,
      0,
    );
    const danglingCount = Object.values(paths.environments).filter(
      (env) => env.dangling === true,
    ).length;
    return (
      facts.diagnostics.length +
      facts.unavailableHostIds.length +
      conflictCount +
      unseenCount +
      danglingCount
    );
  }, [facts, paths.environments]);

  const sections: readonly SettingsSectionTab[] = [
    {
      id: "sidebar",
      label: "Sidebar & Layout",
      content: (
        <SidebarLayoutPanel
          values={values}
          preferences={preferences}
          setAppearance={(patch) => {
            void set(patch);
          }}
          projects={projects}
          overrides={projectColors.overrides}
          isLoadingColors={projectColors.isLoading}
          setProjectColor={projectColors.setProjectColor}
          resetProjectColor={projectColors.resetProjectColor}
          onResetAllAppearance={async () => {
            const updated = await set({ ...APPEARANCE_DEFAULTS });
            if (updated === null) {
              throw new Error("Could not save reset appearance settings");
            }
          }}
        />
      ),
    },
    {
      id: "agent-features",
      label: "Agent & Features",
      content: (
        <AgentFeaturesPanel
          agentTier={agentTier}
          agentBusy={agentBusy}
          agentError={agentError}
          onChangeAgentTier={handleChangeAgentTier}
          preferences={preferences}
          setAppearance={(patch) => {
            void set(patch);
          }}
          features={features}
          members={members}
          featuresReady={featuresReady}
        />
      ),
    },
    {
      id: "diagnostics",
      label: "Diagnostics",
      badgeCount: diagnosticsCount,
      content: (
        <RepoFactsPanel
          facts={facts}
          paths={paths}
          projects={projects}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {error !== null ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <span>{error}</span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Dismiss appearance error"
            onClick={clearError}
            className="size-6 shrink-0 text-destructive hover:text-destructive"
          >
            <Icon name="X" className="size-3.5" aria-hidden />
          </Button>
        </div>
      ) : null}

      {!ready ? (
        <div className="text-xs text-muted-foreground">
          Loading Harbor appearance preferences...
        </div>
      ) : null}

      <SettingsTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        sections={sections}
      />
    </div>
  );
}
