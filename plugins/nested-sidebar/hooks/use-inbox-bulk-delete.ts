import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import type { nestRpcContract } from "@/server/contract";
import type { BulkDeletePreview } from "@/lib/bulk-delete";
import { errorMessage } from "@/lib/errors";
import type {
  ProjectThreadGroup,
} from "@/lib/inbox";
import {
  applyRootSelection,
  pruneSelectedRootIds,
  type RootSelectionIntent,
  type ThreadFilterPreset,
} from "@/lib/thread-management";

export interface BulkDeleteOutcome {
  readonly id: string;
  readonly message: string;
  readonly failed: boolean;
}

export interface InboxBulkDeleteApi {
  readonly bulkPreview: BulkDeletePreview | null;
  readonly bulkBusy: boolean;
  readonly bulkMessage: string | null;
  readonly bulkOutcomes: readonly BulkDeleteOutcome[];
  beginSelection(): void;
  cancelSelection(): void;
  clearSelection(): void;
  changeSelectedRoot(threadId: string, intent: RootSelectionIntent): void;
  selectAllVisible(): void;
  previewSelectedDeletion(): Promise<void>;
  confirmSelectedDeletion(): Promise<void>;
  closePreview(): void;
}

export function useInboxBulkDelete(input: {
  readonly activeThreadId: string | null;
  readonly inboxRef: RefObject<HTMLDivElement | null>;
  readonly selectableVisibleRootIds: readonly string[];
  readonly unfilteredProjectGroups: readonly ProjectThreadGroup[];
  readonly visibleRootOrderKey: string;
  readonly filterPreset: ThreadFilterPreset;
  readonly searchQuery: string;
  readonly selectionMode: boolean;
  readonly setSelectionMode: Dispatch<SetStateAction<boolean>>;
  readonly selectedRootIds: ReadonlySet<string>;
  readonly setSelectedRootIds: Dispatch<SetStateAction<Set<string>>>;
}): InboxBulkDeleteApi {
  const rpc = useRpc<typeof nestRpcContract>();
  const [bulkPreview, setBulkPreview] = useState<BulkDeletePreview | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkOutcomes, setBulkOutcomes] = useState<BulkDeleteOutcome[]>([]);
  const anchorRootId = useRef<string | null>(null);
  const {
    selectionMode,
    setSelectionMode,
    selectedRootIds,
    setSelectedRootIds,
  } = input;

  useEffect(() => {
    setSelectedRootIds((current) => {
      const next = pruneSelectedRootIds(
        current,
        input.unfilteredProjectGroups,
      );
      return setsEqual(current, next) ? current : next;
    });
  }, [input.unfilteredProjectGroups]);

  useEffect(() => {
    anchorRootId.current = null;
  }, [
    input.filterPreset,
    input.searchQuery,
    input.visibleRootOrderKey,
    selectionMode,
  ]);

  const clearMessages = () => {
    setBulkMessage(null);
    setBulkOutcomes([]);
  };

  const beginSelection = () => {
    anchorRootId.current = null;
    setSelectionMode(true);
    clearMessages();
  };

  const cancelSelection = () => {
    anchorRootId.current = null;
    setSelectedRootIds(new Set());
    setSelectionMode(false);
    setBulkPreview(null);
    clearMessages();
  };

  const clearSelection = () => {
    anchorRootId.current = null;
    setSelectedRootIds(new Set());
    clearMessages();
  };

  const changeSelectedRoot = (
    threadId: string,
    intent: RootSelectionIntent,
  ) => {
    clearMessages();
    const update = applyRootSelection({
      selectedRootIds,
      visibleEligibleRootIds: renderedSelectableRootIds(input.inboxRef.current),
      anchorRootId: anchorRootId.current,
      targetRootId: threadId,
      targetSelected: intent.selected,
      shiftKey: intent.shiftKey,
    });
    anchorRootId.current = update.anchorRootId;
    setSelectedRootIds(update.selectedRootIds);
  };

  const selectAllVisible = () => {
    anchorRootId.current = null;
    clearMessages();
    setSelectedRootIds((current) =>
      new Set([...current, ...input.selectableVisibleRootIds]),
    );
  };

  const previewSelectedDeletion = async () => {
    if (selectedRootIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    clearMessages();
    try {
      const preview = await rpc.call("previewBulkDelete", {
        threadIds: [...selectedRootIds],
        protectedThreadId: input.activeThreadId,
      });
      if (preview.token === null) {
        setBulkMessage(
          `${preview.skipped.length} selected ${preview.skipped.length === 1 ? "family is" : "families are"} protected. Nothing can be deleted.`,
        );
        setBulkOutcomes(
          preview.skipped.map((entry) => ({
            id: entry.id,
            message: entry.message,
            failed: false,
          })),
        );
      } else {
        setBulkPreview(preview);
      }
    } catch (error) {
      setBulkMessage(
        errorMessage(error, "Could not update the selected threads."),
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const confirmSelectedDeletion = async () => {
    const preview = bulkPreview;
    if (preview?.token == null || bulkBusy) return;
    setBulkBusy(true);
    try {
      const result = await rpc.call("confirmBulkDelete", {
        token: preview.token,
      });
      const remaining = new Set(selectedRootIds);
      for (const threadId of result.deleted) remaining.delete(threadId);
      setSelectedRootIds(remaining);
      anchorRootId.current = null;
      setBulkPreview(null);
      const skippedCount = preview.skipped.length + result.skipped.length;
      setBulkOutcomes([
        ...preview.skipped.map((entry) => ({
          id: entry.id,
          message: entry.message,
          failed: false,
        })),
        ...result.skipped.map((entry) => ({
          id: entry.id,
          message: entry.message,
          failed: false,
        })),
        ...result.failed.map((entry) => ({
          id: entry.id,
          message: entry.message,
          failed: true,
        })),
      ]);
      const summary = [
        result.deleted.length > 0
          ? `Deleted ${result.deleted.length}.`
          : "Deleted none.",
        skippedCount > 0 ? `${skippedCount} protected.` : "",
        result.failed.length > 0 ? `${result.failed.length} failed.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      setBulkMessage(summary);
      if (remaining.size === 0) setSelectionMode(false);
    } catch (error) {
      setBulkPreview(null);
      setBulkMessage(
        errorMessage(error, "Could not update the selected threads."),
      );
      setBulkOutcomes([]);
    } finally {
      setBulkBusy(false);
    }
  };

  return {
    bulkPreview,
    bulkBusy,
    bulkMessage,
    bulkOutcomes,
    beginSelection,
    cancelSelection,
    clearSelection,
    changeSelectedRoot,
    selectAllVisible,
    previewSelectedDeletion,
    confirmSelectedDeletion,
    closePreview: () => setBulkPreview(null),
  };
}

function renderedSelectableRootIds(root: HTMLDivElement | null): string[] {
  if (root === null) return [];
  return Array.from(
    root.querySelectorAll<HTMLInputElement>(
      "input[data-nest-select-root]:not(:disabled)",
    ),
  ).flatMap((input) => {
    const rootId = input.dataset.nestSelectRoot;
    return rootId && input.getClientRects().length > 0 ? [rootId] : [];
  });
}

function setsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) return false;
  return [...left].every((value) => right.has(value));
}
