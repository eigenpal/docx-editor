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
// Lane: output. Responsibilities and dependency rules:
// docs/architecture/production-engine-packages.md.
//
// The semantic-layout painter for the paginated surface. Consumes semantic layout
// records only; never rederives geometry or interprets CSS.

export { paintSemanticLayout, type PaintOptions } from './semantic-paint.ts';
export {
  paintSelectionOverlay,
  type OverlayRect,
  type SelectionOverlayOptions,
} from './semantic-selection-overlay.ts';
