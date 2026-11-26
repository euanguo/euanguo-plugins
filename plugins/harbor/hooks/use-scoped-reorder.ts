import { useCallback } from "react";

export type ScopedMovePlan =
  | {
      readonly ok: true;
      readonly scopeId: string;
      readonly ids: readonly string[];
      readonly successMessage: string;
    }
  | {
      readonly ok: false;
      readonly message: string | null;
    };

/**
 * Shared drag-and-keyboard reorder runner for families, worktrees, and projects.
 */
export function useScopedReorder<TMove, TScopeArgs extends readonly unknown[]>({
  enabled,
  disabledReason,
  failureMessage,
  announce,
  persist,
  onSelfDrop,
  planDrag,
  planKeyboard,
}: {
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly failureMessage: string;
  readonly announce: (message: string) => void;
  readonly persist: (scopeId: string, ids: readonly string[]) => Promise<boolean>;
  readonly onSelfDrop?: (move: TMove) => boolean;
  readonly planDrag: (move: TMove) => ScopedMovePlan;
  readonly planKeyboard: (...args: TScopeArgs) => ScopedMovePlan;
}) {
  const commit = useCallback(
    (plan: ScopedMovePlan) => {
      if (!plan.ok) {
        if (plan.message !== null) announce(plan.message);
        return;
      }
      void persist(plan.scopeId, plan.ids)
        .then((ok) => announce(ok ? plan.successMessage : failureMessage))
        .catch(() => announce(failureMessage));
    },
    [announce, failureMessage, persist],
  );

  const reorderByDrag = useCallback(
    (move: TMove) => {
      if (onSelfDrop?.(move)) return;
      if (!enabled) {
        announce(disabledReason ?? "Reordering is unavailable.");
        return;
      }
      commit(planDrag(move));
    },
    [announce, commit, disabledReason, enabled, onSelfDrop, planDrag],
  );

  const reorderByKeyboard = useCallback(
    (...args: TScopeArgs) => {
      if (!enabled) {
        announce(disabledReason ?? "Reordering is unavailable.");
        return;
      }
      commit(planKeyboard(...args));
    },
    [announce, commit, disabledReason, enabled, planKeyboard],
  );

  return { reorderByDrag, reorderByKeyboard };
}
