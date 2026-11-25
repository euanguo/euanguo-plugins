/**
 * Stylesheets imported for their side effects.
 *
 * A component that ships its own artwork imports a plain CSS file; the plugin
 * build collects it into `dist/app.css` after the Tailwind output. TypeScript
 * has no idea what a `.css` import is, so the module shape is declared here
 * rather than guarding every import with a cast.
 */
declare module "*.css";
