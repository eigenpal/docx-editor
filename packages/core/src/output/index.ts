/**
 * `@docx-editor.dev/core/output` — painting a layout into DOM.
 *
 * The painted pages ARE the editable surface, but the DOM is a picture: browser mutations are
 * prevented and re-expressed as tree ops, and selection maps only through `data-paragraph-id`
 * and `data-start`.
 *
 * @packageDocumentation
 * @public
 */
// @docx-editor.dev/engine-output
//
// Outputs: the semantic-layout painter for the paginated surface. Consumes semantic
// layout records only; never rederives geometry or interprets CSS.
//
// Production placement is fixed by document-engine task 1.4. Responsibilities and
// dependency rules: docs/architecture/production-engine-packages.md.

/** Stable package identity used by the import-graph / package-authority checks. */
export const ENGINE_OUTPUT_PACKAGE = '@docx-editor.dev/core/output' as const;

export { paintSemanticLayout, type PaintOptions } from './semantic-paint.ts';
export {
  paintSelectionOverlay,
  type OverlayRect,
  type SelectionOverlayOptions,
} from './semantic-selection-overlay.ts';
