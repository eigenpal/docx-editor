// @eigenpal/docx-editor-vue
// Vue.js wrapper for the DOCX editor — community contributed
//
// This package provides Vue 3 components wrapping @eigenpal/docx-editor-core.
// Contributions welcome! See the repository README for guidelines.

export const VERSION = '0.0.2';

// Main editor contract
export { default as DocxEditor } from './components/DocxEditorVue.vue';
export type { EditorMode } from './editor-mode';
export type { DocxEditorProps } from './docx-editor-props';

// i18n
export { useTranslation, provideLocale, i18nPlugin, defaultLocale } from './i18n';
export type { LocaleStrings, PartialLocaleStrings, TranslationKey, Translations } from './i18n';

// renderAsync
export { renderAsync } from './renderAsync';
export type {
  DocxEditorHandle,
  VueRenderAsyncOptions,
  VueRenderAsyncOptions as RenderAsyncOptions,
} from './renderAsync';

// Public ref shape (typecheck contract with EditorRefLike — Decision 10).
export type { DocxEditorRef } from './editor-ref';
