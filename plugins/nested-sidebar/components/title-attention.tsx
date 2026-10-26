import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  useBbContext,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { useAppearance } from "@/hooks/use-appearance";
import { Icon } from "@/components/ui/icon";
import { familyStatusColor } from "@/components/inbox/family-status";
import { useThreadShelves } from "@/hooks/use-lifecycle";
import { useThreadView } from "@/hooks/use-thread-view";
import { useProjectColors } from "@/hooks/use-project-colors";
import { useRepoFacts } from "@/hooks/use-repo-facts";
import {
  useTitleBarBand,
  type TitleBarBand,
} from "@/hooks/use-title-bar-band";
import { threadDisplayTitle } from "@/lib/inbox";
import {
  titleAttentionEntries,
  titleAttentionWindow,
} from "@/lib/title-attention";
import {
  nestPreferenceStyle,
  resolveNestPreferences,
} from "@/lib/preferences";
import "./title-attention.css";

/**
 * Threads that are doing something or need the user, in bb's empty title bar.
 *
 * This is not a second favourites list. The sidebar's own state model decides
 * membership and urgency; the title bar only keeps the live answer one click
 * away while the sidebar is scrolled, filtered or on another group.
 */
export function TitleAttention() {
  const band = useTitleBarBand();
  if (band === null) return null;
  return <TitleAttentionChips band={band} />;
}

function TitleAttentionChips({ band }: { band: TitleBarBand }) {
  const { view } = useThreadView();
  const shelves = useThreadShelves();
  const { threadId: activeThreadId } = useBbContext();
  const actions = useThreadActions();
  const { overrides: projectColors } = useProjectColors();
  const repoFacts = useRepoFacts();
  const { preferences } = useAppearance();
  const [nowMinute, setNowMinute] = useState(() =>
    Math.floor(Date.now() / 60_000),
  );
  useEffect(() => {
    const timer = setInterval(
      () => setNowMinute(Math.floor(Date.now() / 60_000)),
      60_000,
    );
    return () => clearInterval(timer);
  }, []);

  const entries = useMemo(
    () =>
      titleAttentionEntries({
        threads: view.threads,
        projects: view.projects,
        projectColors,
        workspaceOwnership:
          preferences.workspaceOwnership === "filesystem"
            ? repoFacts.workspaceOwnership
            : undefined,
        now: nowMinute * 60_000,
        isActive: (thread) => shelves.shelfFor(thread) === "active",
      }),
    [
      nowMinute,
      projectColors,
      preferences.workspaceOwnership,
      repoFacts.workspaceOwnership,
      shelves.shelfFor,
      view.projects,
      view.threads,
    ],
  );

  if (!shelves.shelvesReady || entries.length === 0) return null;
  const { visible, hidden } = titleAttentionWindow(entries, band.width);

  return (
    <div
      data-nest-title-attention=""
      className="nest-title-attention-layer"
      style={
        {
          ...nestPreferenceStyle(preferences),
          top: band.top,
          left: band.left,
          width: band.width,
          height: band.height,
        } as CSSProperties
      }
    >
      {visible.map((entry) => {
        const thread = entry.family.root;
        const leadThread =
          entry.leadThreadId === thread.id
            ? thread
            : (entry.family.children.find(
                (child) => child.id === entry.leadThreadId,
              ) ?? thread);
        const title = threadDisplayTitle(leadThread);
        const context =
          leadThread.id === thread.id
            ? title
            : `${threadDisplayTitle(thread)} → ${title}`;
        const active =
          entry.family.children.some((child) => child.id === activeThreadId) ||
          thread.id === activeThreadId;
        const statusHelp = `${entry.status.label}: ${entry.status.description}`;
        return (
          <span
            key={thread.id}
            className="nest-title-attention"
            data-active={active ? "true" : undefined}
            data-nest-title-attention-status={entry.status.kind}
          >
            <button
              type="button"
              className="nest-title-attention-link"
              aria-current={active ? "page" : undefined}
              aria-label={`${context}. ${entry.projectName}. ${statusHelp}`}
              title={`${context} · ${entry.projectName} · ${statusHelp}`}
              onClick={() => actions.open(entry.leadThreadId)}
            >
              <span
                aria-hidden
                className="nest-title-attention-project"
                style={{ background: entry.color }}
              />
              <span
                aria-hidden
                className="nest-title-attention-icon"
                style={{ color: familyStatusColor(entry.status) }}
                data-spin={
                  entry.status.animated && entry.status.icon === "Loading"
                    ? "true"
                    : undefined
                }
                data-pulse={
                  entry.status.animated && entry.status.icon !== "Loading"
                    ? "true"
                    : undefined
                }
              >
                <Icon
                  name={entry.status.icon}
                  className="nest-title-attention-glyph"
                />
              </span>
              <span className="nest-title-attention-title">{title}</span>
            </button>
          </span>
        );
      })}
      {hidden.length === 0 ? null : (
        <span
          className="nest-title-attention-more"
          data-nest-title-attention-more={hidden.length}
          title={[
            ...hidden.slice(0, 8).map((entry) => {
              const lead =
                entry.family.children.find(
                  (child) => child.id === entry.leadThreadId,
                ) ?? entry.family.root;
              return `${threadDisplayTitle(lead)} (${entry.status.label})`;
            }),
            ...(hidden.length > 8 ? [`+${hidden.length - 8} more`] : []),
          ].join(" · ")}
        >
          +{hidden.length}
        </span>
      )}
    </div>
  );
}
