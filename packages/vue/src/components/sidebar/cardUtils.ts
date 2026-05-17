// Alias for cross-adapter parity — the React adapter has
// `components/sidebar/cardUtils.ts` and `sidebarUtils.ts` with the
// same exports; Vue lives at `sidebarUtils.ts`. This file mirrors the
// React filename for source-level parity inside the adapter. The public
// package surface intentionally exports sidebar helpers through
// `@eigenpal/docx-editor-vue/ui`, not deep component paths.
export * from './sidebarUtils';
