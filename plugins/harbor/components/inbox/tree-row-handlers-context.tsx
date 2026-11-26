import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import type {
  TreeActions,
  TreeLiveState,
} from "@/components/inbox/tree-row-types";

const TreeActionsContext = createContext<TreeActions | null>(null);
const TreeLiveStateContext = createContext<TreeLiveState | null>(null);

export function TreeActionsProvider({
  value,
  override,
  children,
}: {
  value: TreeActions;
  override?: Partial<TreeActions>;
  children: ReactNode;
}) {
  const providedValue = useMemo(
    () => (override ? { ...value, ...override } : value),
    [value, override],
  );

  return (
    <TreeActionsContext.Provider value={providedValue}>
      {children}
    </TreeActionsContext.Provider>
  );
}

export function TreeLiveStateProvider({
  value,
  children,
}: {
  value: TreeLiveState;
  children: ReactNode;
}) {
  return (
    <TreeLiveStateContext.Provider value={value}>
      {children}
    </TreeLiveStateContext.Provider>
  );
}

export function useTreeActions(): TreeActions {
  const actions = useContext(TreeActionsContext);
  if (actions === null) {
    throw new Error("useTreeActions requires TreeActionsProvider");
  }
  return actions;
}

export function useTreeLiveState(): TreeLiveState {
  const live = useContext(TreeLiveStateContext);
  if (live === null) {
    throw new Error("useTreeLiveState requires TreeLiveStateProvider");
  }
  return live;
}
