/**
 * @eigenpal/docx-editor-react
 *
 * Curated root entry for the documented React editor API. Advanced surfaces
 * stay public through explicit subpaths:
 * - `@eigenpal/docx-editor-react/ui`
 * - `@eigenpal/docx-editor-react/dialogs`
 * - `@eigenpal/docx-editor-react/hooks`
 * - `@eigenpal/docx-editor-react/plugin-api`
 *
 * Framework-agnostic document utilities live in `@eigenpal/docx-editor-core`.
 * Agent/MCP surfaces live in `@eigenpal/docx-editor-agents`.
 *
 * @packageDocumentation
 * @public
 */

export const VERSION = '0.0.2';

// Main editor contract
export {
  DocxEditor,
  type DocxEditorProps,
  type DocxEditorRef,
  type EditorMode,
} from './components/DocxEditor';
export { renderAsync, type RenderAsyncOptions, type DocxEditorHandle } from './renderAsync';

// Document factory helpers — re-exported from `@eigenpal/docx-editor-core` so
// the common "spawn a blank editor" affordance is available without forcing
// consumers to add `-core` to their dependency tree alongside `-react`.
export {
  createEmptyDocument,
  createDocumentWithText,
  type CreateEmptyDocumentOptions,
} from '@eigenpal/docx-editor-core';

// i18n contract — runtime only. Locale string types (LocaleStrings,
// Translations, PartialLocaleStrings, TranslationKey) live in
// `@eigenpal/docx-editor-i18n`; import them from there.
export { LocaleProvider, useTranslation, type LocaleProviderProps } from './i18n';
