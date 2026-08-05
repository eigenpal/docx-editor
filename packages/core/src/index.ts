/**
 * `@docx-editor.dev/core` — the engine.
 *
 * THIS ENTRY IS THE 80% PATH. Everything needed to stand up an editor over DOCX bytes,
 * measure it with real fonts, and drive it from chrome is here, so the common case is one
 * import. The subpaths (`./store`, `./layout`, `./output`, `./automation`, and the
 * `./contracts/*` declarations) stay available for the deeper work — walking the canonical
 * tree, running layout by hand, painting — and nothing here hides them.
 *
 * If you want the editor already wired to a UI, use `@docx-editor.dev/react`.
 */

// ─── Create an editor ────────────────────────────────────────────────────────
export {
  createDocxEditor,
  blankDocumentBytes,
  type DocxEditorInstance,
  type DocxEditorConfig,
} from './editor/index.ts';

// ─── The contract it implements ──────────────────────────────────────────────
export type {
  Editor,
  EditorHost,
  EditorConfig,
  EditorCommand,
  EditorQuery,
  EditorSnapshot,
  EditorScope,
  ViewScope,
  DocumentSource,
  DocumentHandle,
  DocumentChange,
  DocumentEditingMode,
  PageSetup,
} from './contracts/editor.ts';

// ─── Fonts: the reason pagination matches Word ───────────────────────────────
export {
  WORD_DEFAULT_FONT,
  loadFonts,
  createFontSource,
  composeFontConfiguration,
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
export type { EditorModule } from './contracts/modules.ts';

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
