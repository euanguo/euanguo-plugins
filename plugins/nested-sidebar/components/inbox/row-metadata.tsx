import { UrlLink } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { RowTooltip } from "@/components/ui/row-tooltip";
import { semanticStateToneClass } from "@/lib/domain/attention-state";
import { pullRequestPresentation } from "@/lib/domain/pull-request-presentation";
import type { WorkspacePullRequest } from "@/lib/domain/pull-request";

export function PullRequestMetadata({
  pullRequest,
  interactive = true,
}: {
  pullRequest: WorkspacePullRequest;
  interactive?: boolean;
}) {
  const presentation = pullRequestPresentation(pullRequest);
  const semanticColor = `var(--nest-pr-${presentation.colorRole}, currentColor)`;
  const label = `${presentation.label} pull request ${pullRequest.number}: ${pullRequest.title}`;
  const content = (
    <>
      <span className="shrink-0 font-mono text-muted-foreground/80">
        #{pullRequest.number}
      </span>
      <span
        data-nest-pr-state={presentation.colorRole}
        className={`inline-flex size-4 shrink-0 items-center justify-center rounded ${semanticStateToneClass(presentation.tone)}`}
        style={{
          color: semanticColor,
          backgroundColor: `color-mix(in srgb, ${semanticColor} 24%, transparent)`,
        }}
      >
        <Icon name={presentation.icon} className="size-3" aria-hidden />
      </span>
      <RowTooltip
        content={
          <>
            <span className="block font-semibold">
              {presentation.label} · #{pullRequest.number}
            </span>
            <span className="mt-0.5 block max-w-52 whitespace-normal break-words text-muted-foreground">
              {pullRequest.title}
            </span>
          </>
        }
        className="group-hover/pr:translate-y-0 group-hover/pr:opacity-100 group-focus-visible/pr:translate-y-0 group-focus-visible/pr:opacity-100"
      />
    </>
  );

  if (!interactive) {
    return (
      <span
        className="group/pr pointer-events-none relative flex h-4 min-w-0 items-center gap-1.5 text-2xs text-muted-foreground"
        title={`${presentation.label}: ${pullRequest.title}`}
      >
        <span className="sr-only">{label}</span>
        <span aria-hidden className="contents">
          {content}
        </span>
      </span>
    );
  }

  // Number first; the semantic PR icon deliberately owns the far-right edge.
  return (
    <UrlLink
      href={pullRequest.url}
      onClick={(event) => event.stopPropagation()}
      className="group/pr pointer-events-auto relative flex h-4 min-w-0 items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground"
      aria-label={label}
      title={`${presentation.label}: ${pullRequest.title}`}
    >
      {content}
    </UrlLink>
  );
}

export function WaitingForAgentsMetadata() {
  return (
    <span
      title="Agents working"
      className={`inline-flex size-4 shrink-0 items-center justify-center rounded ${semanticStateToneClass("primary")}`}
      style={{
        color:
          "var(--nest-status-working, var(--success-foreground, var(--primary)))",
      }}
    >
      <Icon
        name="Loading"
        className="size-3 animate-spin motion-reduce:animate-none"
        aria-hidden
      />
      <span className="sr-only">Agents working</span>
    </span>
  );
}

/**
 * In-turn subagents: activity on this thread rather than threads under it.
 *
 * bb's own documentation draws the line explicitly. A fork or a side chat is a
 * **child thread**; a subagent the agent spawns inside a turn is
 * `activity.backgroundAgents` on its parent. The two overlap — an agent that
 * forks a thread and then waits on it shows both — but they are not the same
 * thing, so they get separate badges instead of one merged number. A single
 * figure would tell the user a thread has four children when it has one child
 * and three helpers.
 *
 * The glyph is a stand-in: the icon set this sidebar vendors has no agent mark,
 * so the count and the label carry the meaning and the glyph only says "this is
 * a count of work", the way the child disclosure's chevron says "this opens".
 */
export function SubagentBadge({ count }: { count: number }) {
  const label = `${count} subagent${count === 1 ? "" : "s"} running`;
  return (
    <span
      title={label}
      aria-label={label}
      className="pointer-events-none flex h-4 shrink-0 items-center gap-0.5 rounded bg-muted px-1 text-2xs tabular-nums text-muted-foreground"
    >
      <Icon name="Workflow" className="size-3" aria-hidden />
      {count}
    </span>
  );
}
