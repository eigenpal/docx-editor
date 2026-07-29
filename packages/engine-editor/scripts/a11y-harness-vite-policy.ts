// Vite dependency-prebundle policy for the a11y harness (task 5.3 / 4.7).

/** Mutable workspace @docx-editor.dev packages — always resolve as source, never prebundle. */
export const A11Y_HARNESS_WORKSPACE_PACKAGES = [
  '@docx-editor.dev/core-contract/contracts/editor',
  '@docx-editor.dev/core-contract/contracts/interaction',
  '@docx-editor.dev/core-contract/contracts/geometry',
  '@docx-editor.dev/core-contract/contracts/types',
  '@docx-editor.dev/core-contract/binding',
  '@docx-editor.dev/core-contract/store',
  '@docx-editor.dev/core-contract/layout',
  '@docx-editor.dev/core-contract/output',
] as const;

/** Stable third-party deps safe to prebundle for faster cold starts. */
export const A11Y_HARNESS_OPTIMIZED_THIRD_PARTY = [
  'prosemirror-model',
  'prosemirror-state',
  'prosemirror-view',
  'prosemirror-commands',
  'prosemirror-keymap',
  'fflate',
  'fast-xml-parser',
] as const;

/** Export that must resolve through live workspace source in the harness graph. */
export const A11Y_HARNESS_LAYOUT_EXPORT_PROBE = 'resolveDefaultWordBoundary' as const;
