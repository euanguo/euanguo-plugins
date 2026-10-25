/**
 * The realtime channels this plugin publishes on, in a module both sides can
 * import.
 *
 * They used to be declared in `server.ts`, and the frontend hooks imported them
 * from there. A value import of anything in `server.ts` makes the frontend
 * bundle include that module's whole graph — the RPC contract, the SQLite
 * stores, and zod, which on its own was most of the bundle. A constant the two
 * sides share belongs in a module with no dependencies, not on the entry point
 * that has all of them.
 */
export const LIFECYCLE_CHANNEL = "lifecycle";
export const PROJECT_COLOR_CHANNEL = "project-colors";
export const PROJECT_ICON_CHANNEL = "project-icons";
export const GROUP_CHANNEL = "groups";
export const ORDER_CHANNEL = "manual-order";
export const VIEW_PREFERENCE_CHANNEL = "view-preferences";
