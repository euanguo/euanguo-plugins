# Nest sidebar refactor plan

This plan covers the full refactor requested on September 20, 2026. The existing
uncommitted Compact row and 1px list spacing changes are part of the baseline and
remain in scope.

## Acceptance gates

| ID | Outcome | Evidence |
| --- | --- | --- |
| R1 | Default project badge colors are visibly calmer while the project ID to color mapping stays stable. | project-colors tests pass; every automatic color keeps at least 4.5:1 contrast with its selected foreground. |
| R2 | Settings are organized into clear appearance, thread list, project/workspace, and advanced sections. | settings contract tests pass and the settings source contains each section marker exactly once. |
| R3 | Fixed Compact rows are documented consistently and no live Row density setting or stale public documentation remains. | contract test passes; repository search finds no live rowDensity, Row density, or Comfortable references. |
| R4 | Layout options explain their dependencies and the settings summary reflects effective behavior. | preferences and settings contract tests pass. |
| R5 | README explains the product model, first-use path, configuration groups, fixed Compact layout, and current feature boundaries. | README content contract test passes. |
| R6 | Existing behavior remains intact. | full npm test, npm run typecheck, and npm run build pass. |

## Work breakdown

1. Add the refactor gate and plan files; establish the current test, type, and build baseline.
2. Replace the automatic project badge palette and strengthen its contrast tests.
3. Add settings group metadata in the server descriptor and reorganize the settings preview into matching sections.
4. Normalize labels and descriptions, especially the relationship between row layout and visible location details.
5. Rewrite the public README around the product model, first run, configuration, and boundaries.
6. Add or update source contracts for the new public structure, then run the full verification sequence.

## Non-goals

- Do not change project ID hashing or persisted project color overrides.
- Do not change thread ordering, lifecycle storage, RPC shapes, or navigation behavior.
- Do not add speculative project-level behavior rules in this pass.
