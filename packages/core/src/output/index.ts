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

export {
  DEFAULT_FIELD_SHADING,
  paintSemanticLayout,
  type FieldShadingMode,
  type PaintOptions,
} from './semantic-paint.ts';
// TYPES ONLY. The derivations behind them (`authorSlotsOf`, `revisionAuthorsOf`, the ramp
// constant) are engine internals reached through `getRevisionAuthors` on the editor; a
// `@public` symbol is a breaking change to withdraw, so they stay off the barrel and the
// two in-package callers import them by module path.
export type {
  RevisionAuthor,
  RevisionAuthorAssignments,
  RevisionAuthorStyle,
  RevisionStyles,
} from './revision-presentation.ts';
export {
  paintSelectionOverlay,
  type OverlayRect,
  type SelectionOverlayOptions,
} from './semantic-selection-overlay.ts';
