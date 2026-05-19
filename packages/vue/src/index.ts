/**
 * @eigenpal/docx-editor-vue
 *
 * Curated root entry for the documented Vue 3 editor API. Advanced surfaces
 * stay public through explicit subpaths:
 * - `@eigenpal/docx-editor-vue/ui`
 * - `@eigenpal/docx-editor-vue/dialogs`
 * - `@eigenpal/docx-editor-vue/composables`
 * - `@eigenpal/docx-editor-vue/plugin-api`
 *
 * Framework-agnostic document utilities live in `@eigenpal/docx-editor-core`.
 * Agent/MCP surfaces live in `@eigenpal/docx-editor-agents`.
 *
 * @packageDocumentation
 * @public
 */

export const VERSION = '0.0.2';

// Main editor contract
export { default as DocxEditor } from './components/DocxEditor.vue';
export type { DocxEditorProps, EditorMode } from './components/DocxEditor/types';

// i18n contract — runtime only. Locale string types (LocaleStrings,
// Translations, PartialLocaleStrings, TranslationKey) live in
// `@eigenpal/docx-editor-i18n`; import them from there.
export { useTranslation, provideLocale, i18nPlugin, defaultLocale } from './i18n';

// renderAsync
export { renderAsync } from './renderAsync';
export type { DocxEditorHandle, RenderAsyncOptions } from './renderAsync';

// Public ref shape (typecheck contract with EditorRefLike — Decision 10).
export type { DocxEditorRef } from './components/DocxEditor/types';
