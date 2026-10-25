import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  Archive02Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowTurnBackwardIcon,
  ArrowUp01Icon,
  Cancel01Icon,
  CancelCircleIcon,
  CheckListIcon,
  CheckmarkSquare02Icon,
  Clock01Icon,
  ComputerTerminal01Icon,
  Copy01Icon,
  Delete02Icon,
  Edit02Icon,
  FilterHorizontalIcon,
  Folder01Icon,
  FolderAddIcon,
  FolderGitIcon,
  FolderTreeIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  HelpCircleIcon,
  IdCardIcon,
  HourglassIcon,
  LayerIcon,
  Link01Icon,
  Loading03Icon,
  MoreHorizontalIcon,
  PinOffIcon,
  PinIcon,
  Settings01Icon,
  SlidersHorizontalIcon,
  Target02Icon,
  Tick02Icon,
  Unarchive03Icon,
  UserAdd01Icon,
  ViewIcon,
  WorkflowCircle03Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";

/**
 * The pin, solid — the other half of the pin control.
 *
 * Derived from `PinIcon`'s own artwork rather than drawn again, so pinned and
 * unpinned are one silhouette: a pin that changed shape when it was pinned
 * would read as two different controls.
 *
 * Hugeicons' free set ships the pin outlined only, so the solid is made here —
 * and made by rule rather than by index: every closed outline is filled, every
 * open one stays a stroke. Filling a path that is a line would draw nothing and
 * fail silently, and the two parts of this glyph differ in exactly that way.
 */
const PinFilledIcon: IconSvgElement = PinIcon.map(
  ([tag, attrs]): [string, { [key: string]: string | number }] =>
    typeof attrs.d === "string" && attrs.d.trimEnd().endsWith("Z")
      ? [tag, { ...attrs, fill: "currentColor" }]
      : [tag, { ...attrs }],
);

const ICON_MAP = {
  Add: Add01Icon,
  Archive: Archive02Icon,
  ArchiveRestore: Unarchive03Icon,
  ArrowRight: ArrowRight01Icon,
  ArrowTurnBackward: ArrowTurnBackwardIcon,
  Check: Tick02Icon,
  CheckSquare: CheckmarkSquare02Icon,
  ChevronDown: ArrowDown01Icon,
  ChevronLeft: ArrowLeft01Icon,
  ChevronRight: ArrowRight01Icon,
  ChevronUp: ArrowUp01Icon,
  CircleQuestion: HelpCircleIcon,
  CircleX: CancelCircleIcon,
  Clock: Clock01Icon,
  Copy: Copy01Icon,
  CopyLink: Link01Icon,
  Edit: Edit02Icon,
  Eye: ViewIcon,
  Filter: FilterHorizontalIcon,
  Folder: Folder01Icon,
  FolderAdd: FolderAddIcon,
  FolderGit: FolderGitIcon,
  FolderTree: FolderTreeIcon,
  GitBranch: GitBranchIcon,
  GitMerge: GitMergeIcon,
  GitPullRequest: GitPullRequestIcon,
  GitPullRequestClosed: GitPullRequestClosedIcon,
  GitPullRequestDraft: GitPullRequestDraftIcon,
  Hourglass: HourglassIcon,
  IdCard: IdCardIcon,
  ListTodo: CheckListIcon,
  Layer: LayerIcon,
  Loading: Loading03Icon,
  More: MoreHorizontalIcon,
  Settings: Settings01Icon,
  Sliders: SlidersHorizontalIcon,
  Pin: PinIcon,
  PinFilled: PinFilledIcon,
  PinOff: PinOffIcon,
  Trash: Delete02Icon,
  Target: Target02Icon,
  Terminal: ComputerTerminal01Icon,
  UserRoundPlus: UserAdd01Icon,
  Workflow: WorkflowCircle03Icon,
  X: Cancel01Icon,
} as const satisfies Record<string, IconSvgElement>;

export type IconName = keyof typeof ICON_MAP;

export function Icon({
  name,
  className,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
  style,
}: {
  name: IconName;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
  style?: CSSProperties;
}) {
  return (
    <HugeiconsIcon
      icon={ICON_MAP[name]}
      className={cn(className)}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      style={style}
      data-icon={name}
    />
  );
}
