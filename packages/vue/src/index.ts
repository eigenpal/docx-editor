/**
 * @docx-editor.dev/vue
 *
 * Curated root entry for the documented Vue 3 editor API. Advanced surfaces
 * stay public through explicit subpaths:
 * - `@docx-editor.dev/vue/ui`
 * - `@docx-editor.dev/vue/dialogs`
 * - `@docx-editor.dev/vue/composables`
 * - `@docx-editor.dev/vue/plugin-api`
 *
 * Framework-agnostic document utilities live in `@docx-editor.dev/core`.
 * Agent/MCP surfaces live in `@docx-editor.dev/agents`.
 *
 * @packageDocumentation
 * @public
 */

export const VERSION = '0.0.2';

// Main editor contract
export { default as DocxEditor } from './components/DocxEditor';
export type { DocxEditorProps, EditorMode } from './components/DocxEditor/types';

// Document factory helpers — re-exported from `@docx-editor.dev/core` so
// the common "spawn a blank editor" affordance is available without forcing
// consumers to add `-core` to their dependency tree alongside `-vue`.
export {
  createEmptyDocument,
  createDocumentWithText,
  type CreateEmptyDocumentOptions,
} from '@docx-editor.dev/core';

// i18n contract — runtime only. Locale string types (LocaleStrings,
// Translations, PartialLocaleStrings, TranslationKey) live in
// `@docx-editor.dev/i18n`; import them from there.
export { useTranslation, provideLocale, i18nPlugin, defaultLocale } from './i18n';

// renderAsync
export { renderAsync } from './renderAsync';
export type { DocxEditorHandle, RenderAsyncOptions } from './renderAsync';

// Public ref shape (typecheck contract with EditorRefLike — Decision 10).
export type { DocxEditorRef } from './components/DocxEditor/types';
