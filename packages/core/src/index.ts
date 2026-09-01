/**
 * `@docx-editor.dev/core` — the engine: contracts, layout, store, and the editor facade.
 *
 * One preservation model and one pipeline: bytes are read into a canonical typed-and-generic
 * OOXML tree, mutated only through the store's ops, laid out DOM-free, and painted onto pages
 * that ARE the editable surface. Content the engine does not model is carried losslessly rather
 * than dropped, so an unfamiliar document never locks editing.
 *
 * @example Create an editor over DOCX bytes
 * ```ts
 * import { createDocxEditor } from '@docx-editor.dev/core';
 *
 * const editor = createDocxEditor({ document: bytes });
 * editor.attach(element);
 * ```
 *
 * THIS ENTRY IS THE 80% PATH. Everything needed to stand up an editor over DOCX bytes,
 * measure it with real fonts, and drive it from chrome is here, so the common case is one
 * import. The subpaths (`./store`, `./layout`, `./output`, `./automation`, and the
 * `./contracts/*` declarations) stay available for the deeper work — walking the canonical
 * tree, running layout by hand, painting — and nothing here hides them.
 * If you want the editor already wired to a UI, use `@docx-editor.dev/react`.
 *
 * @packageDocumentation
 * @public
 */

// ─── Create an editor ────────────────────────────────────────────────────────
export {
  createDocxEditor,
  blankDocumentBytes,
  type DocxEditorInstance,
  type DocxEditorConfig,
} from './editor/index.ts';

// What `DocxEditorConfig` accepts and `DocxEditorInstance` answers with, beyond the contract.
//
// Three names this entry point hands out are deliberately NOT re-exported, because each would
// drag a whole type graph onto the 80% path to make one escape hatch nameable:
//   - `PaginatedSurface` (`instance.surface`) reaches TreeDocOp, SemanticLayout and the session
//   - `ImageDecodePort` (`config.imageDecodePort`) reaches the image-resource limit vocabulary
//   - `OoxmlElement`/`OoxmlPart` reach the ~85-member canonical node union
// All are named at the subpath that owns them — `./editor` and `./store` — which is where a
// caller reaching for an internal already is. Using the members needs no import; only writing
// their types down does.
export type {
  ChromeMenu,
  ChromeMenuEntry,
  ChromeMenuId,
  ChromeMenuItemEntry,
  ChromeMenuSeparatorEntry,
  ChromeMenuSubmenuEntry,
  FontLoadFailureReason,
  FontResolutionRequest,
  FontMeasurementState,
  FontResolver,
  FontUrlSource,
  HyperlinkActivation,
  HyperlinkChromeHandlers,
  SurfaceHyperlink,
} from './editor/index.ts';

// ─── The contract it implements ──────────────────────────────────────────────
//
// The WHOLE contract, not a chosen subset. Hand-listing it is how the entry point ended up
// handing out `CanResult` from `can()`, `TextMatch` from `findText()` and `TableContext` from
// `query()` while exporting none of the three: every addition to the contract had to be
// remembered here a second time, and none of them were. `contracts/editor` is type-only and
// already re-exports `./types`, `./interaction` and `./editor-hf-notes`, so this is the
// contract's transitive closure in one line and it cannot drift again.
export type * from './contracts/editor.ts';

// ─── Fonts: the reason pagination matches Word ───────────────────────────────
export {
  WORD_DEFAULT_FONT,
  loadFonts,
  createFontSource,
  FONT_RESOLVER_BRAND,
  FONT_RESOLVER_MARK_KEY,
  composeFontConfiguration,
  composeFontOrigins,
  defineFontResolver,
  isFontResolver,
  type ComposeFontOriginsOptions,
  type FontOrigin,
  type FontOriginFailure,
  type FontResolverMark,
  type MarkedFontResolver,
  type FontConfigurationBase,
  type FontConfigurationFragment,
  type LoadFontsRequest,
  type LoadFontsResult,
  type FontLoadFailure,
} from './editor/index.ts';
export type { FontConfiguration, FontSource, FontFaceRequest } from './contracts/editor.ts';

// ─── Chrome registry: what a toolbar is built from ───────────────────────────
export {
  CHROME_GROUPS,
  CHROME_MENUS,
  chromeMenuSlots,
  commandForSlot,
  commandForSlotValue,
  toolbarCommandState,
  runToolbarCommand,
  type ChromeSlotId,
  type ToolbarCommandState,
} from './editor/index.ts';

// ─── Capability modules (what `@docx-editor.dev/pro` implements) ─────────────
export type {
  CollectReviewItems,
  EditorModule,
  ReviewModelInput,
  ReviewModuleContribution,
  RevisionDisplayMode,
} from './contracts/modules.ts';

// ─── The document model and the edit/query vocabulary ────────────────────────
export type * from './contracts/types';
export type {
  ApplyResult,
  ContentControlSummary,
  DocEdit,
  DocEdits,
  DocQueries,
  DocQuery,
  DocQueryResults,
  ParagraphSummary,
} from './contracts/document.ts';
