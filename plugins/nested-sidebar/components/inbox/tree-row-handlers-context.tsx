import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import type { TreeRowHandlers } from "@/components/inbox/tree-row-types";

const TreeRowHandlersContext = createContext<TreeRowHandlers | null>(null);

export function TreeRowHandlersProvider({
  value,
  override,
  children,
}: {
  value: TreeRowHandlers;
  override?: Partial<TreeRowHandlers>;
  children: ReactNode;
}) {
  const providedValue = useMemo(
    () => (override ? { ...value, ...override } : value),
    [value, override],
  );

  return (
    <TreeRowHandlersContext.Provider value={providedValue}>
      {children}
    </TreeRowHandlersContext.Provider>
  );
}

export function useTreeRowHandlers(): TreeRowHandlers {
  const handlers = useContext(TreeRowHandlersContext);
  if (handlers === null) {
    throw new Error("useTreeRowHandlers requires TreeRowHandlersProvider");
  }
  return handlers;
}
