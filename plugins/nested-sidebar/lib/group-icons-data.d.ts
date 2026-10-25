/**
 * The shape of the generated artwork file, and the reason `tsc` stays fast.
 *
 * `group-icons-data.js` is 6 MB of JSON text in one string literal. TypeScript
 * would parse all of it if it had to infer a type from it; this declaration is
 * what it reads instead. `scripts/generate-group-icons.mjs` writes the `.js`.
 */
export const GROUP_ICON_ARTWORK_JSON: string;
