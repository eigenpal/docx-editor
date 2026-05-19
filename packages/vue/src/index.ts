// @eigenpal/docx-editor-vue
// Vue.js wrapper for the DOCX editor — community contributed
//
// This package provides Vue 3 components wrapping @eigenpal/docx-editor-core.
// Contributions welcome! See the repository README for guidelines.

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
export type {
  DocxEditorHandle,
  VueRenderAsyncOptions,
  VueRenderAsyncOptions as RenderAsyncOptions,
} from './renderAsync';

// Public ref shape (typecheck contract with EditorRefLike — Decision 10).
export type { DocxEditorRef } from './components/DocxEditor/types';
