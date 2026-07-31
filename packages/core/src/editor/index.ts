// @docx-editor.dev/engine-editor
//
// Browser editor composition root: the production tree-lane editor. Composes the typed
// OOXML tree session, engine-layout pagination, and the paginated surface into the
// PM-free Editor/EditorHost contract. Becomes @docx-editor.dev/core/editor at the section 7/14
// migration. Production placement: docs/architecture/production-engine-packages.md.
//
// ADR-S9: production modules MUST NOT import from packages/core/spike/**.

/** Stable package identity used by the import-graph / package-authority checks. */
export const ENGINE_EDITOR_PACKAGE = '@docx-editor.dev/core-contract/editor' as const;

export {
  createLayoutShaping,
  disposeLayoutShaping,
  toEditorFontError,
} from './font-configuration.ts';
export {
  generateRulerTicks,
  rulerPageBox,
  PX_PER_INCH,
  PX_PER_CM,
  type RulerTick,
  type RulerUnit,
} from './ruler-ticks.ts';
export {
  runSave,
  runToolbarCommand,
  toolbarCommand,
  toolbarCommandState,
  toolbarCommandStates,
  type ToolbarCommandId,
  type ToolbarCommandState,
} from './toolbar-commands.ts';

export {
  CHROME_GROUPS,
  CHROME_MENUS,
  CHROME_UNAVAILABLE_KEY,
  chromeControlCount,
  type ChromeControl,
  type ChromeControlState,
  type ChromeCommandId,
  type ChromeGroup,
} from './chrome-controls.ts';
export {
  mountPaginatedSurface,
  type OpenPaginatedResult,
  type PaginatedSurface,
  type PaginatedSurfaceOptions,
  type PaginatedSurfaceState,
  type SurfaceFormatting,
} from './paginated-surface.ts';
export { createDocxEditor, type DocxEditorInstance, type DocxEditorConfig } from './docx-editor.ts';
// The types an adapter needs to CALL the surface, re-exported from the composition root.
// Adapters may depend on this package and not on the layout lane, so a host reaching into
// `engine-layout` for a parameter type would be reaching past the boundary for a name.
export type {
  SectionProperties,
  NavigationCommand,
  SemanticPosition,
  SemanticSelection,
  TextMeasurer,
} from '@docx-editor.dev/core-contract/layout';
