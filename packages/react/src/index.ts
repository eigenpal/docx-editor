/**
 * @docx-editor.dev/react
 *
 * Curated root entry for the documented React editor API. Advanced surfaces
 * stay public through explicit subpaths:
 * - `@docx-editor.dev/react/ui`
 * - `@docx-editor.dev/react/dialogs`
 * - `@docx-editor.dev/react/hooks`
 * - `@docx-editor.dev/react/plugin-api`
 *
 * Framework-agnostic document utilities live in `@docx-editor.dev/core`.
 * Agent/MCP surfaces live in `@docx-editor.dev/agents`.
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

// Document factory helpers — re-exported from `@docx-editor.dev/core` so
// the common "spawn a blank editor" affordance is available without forcing
// consumers to add `-core` to their dependency tree alongside `-react`.
export {
  createEmptyDocument,
  createDocumentWithText,
  type CreateEmptyDocumentOptions,
} from '@docx-editor.dev/core';

// i18n contract — runtime only. Locale string types (LocaleStrings,
// Translations, PartialLocaleStrings, TranslationKey) live in
// `@docx-editor.dev/i18n`; import them from there.
export { LocaleProvider, useTranslation, type LocaleProviderProps } from './i18n';
