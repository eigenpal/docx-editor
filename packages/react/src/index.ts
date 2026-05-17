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

// i18n contract
export {
  LocaleProvider,
  useTranslation,
  type LocaleProviderProps,
  type LocaleStrings,
  type Translations,
  type PartialLocaleStrings,
  type TranslationKey,
} from './i18n';
