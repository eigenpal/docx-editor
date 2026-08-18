/**
 * @docx-editor.dev/vue
 * @packageDocumentation
 * @public
 */

export const VERSION = '0.0.2';

export { DocxEditor } from './components/DocxEditor';

export {
  DocxEditorRoot,
  type DocxEditorRootProps,
  provideDocxEditor,
} from './editor/DocxEditorRoot';
export { DocxEditorViewport, type DocxEditorViewportProps } from './editor/DocxEditorViewport';
export { DocxEditorContent, type DocxEditorContentProps } from './editor/DocxEditorContent';

export { useDocxEditor, ReviewRailContext, type ReviewRailRegistry } from './editor/context';
export { useEditorState, editorStateActiveSubscriptionCount } from './editor/useEditorState';
export { useScopeClassName } from './editor/scope-context';
export { LOADING_SNAPSHOT } from '@docx-editor.dev/core/editor';

export { useEditorCommand, type EditorCommandState } from './editor/useEditorCommand';
export {
  useEditorValueCommand,
  type EditorValueCommandState,
  type ImageWrapTarget,
} from './editor/useEditorValueCommand';
export { useEditorEvent } from './editor/useEditorEvent';
export { useEditorCaret, type EditorCaret } from './editor/useEditorCaret';
export { useEditorSnapshot } from './useEditorSnapshot';

export { useZoom, type UseZoomResult } from './editor/useZoom';
export { usePageSetup, type PageSetupUpdate, type UsePageSetupReturn } from './editor/usePageSetup';
export {
  useParagraphIndent,
  type IndentUpdate,
  type UseParagraphIndentReturn,
} from './editor/useParagraphIndent';
export { useFonts, type FontsInput } from './editor/useFonts';
export {
  useDocxSource,
  type DocxFontsInput,
  type DocxFontsSource,
  type DocxSource,
  type UseDocxSourceOptions,
  type UseDocxSourceResult,
} from './editor/useDocxSource';

export { useHeaderFooterState, type HeaderFooterState } from './editor/useHeaderFooterState';
export {
  useNotePropertiesState,
  useNoteScopeState,
  type NotePropertiesState,
} from './editor/useNoteScopeState';

export {
  useHyperlinkPopup,
  useHyperlinkPopupInstance,
  isFieldLink,
  type HyperlinkPopupAnchor,
  type HyperlinkPopupMode,
  type HyperlinkPopupState,
  type UseHyperlinkPopupResult,
} from './editor/useHyperlinkPopup';

export {
  useContentControl,
  useContentControlInstance,
  CONTENT_CONTROL_SLOTS,
  type ContentControlInspectorState,
  type ContentControlLock,
  type ContentControlSlotId,
  type UseContentControlResult,
} from './editor/useContentControl';

export {
  NAVIGATION_PANE_GAP,
  NAVIGATION_PANE_INSET,
  NAVIGATION_PANE_WIDTH,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MATCH_LIMIT,
  navigationPaneReservation,
  navigationShift,
  useDocumentOutline,
  useDocumentSearch,
  useNavigationPane,
  useNavigationShift,
  type NavigationShiftInput,
  type NavigationTabValue,
  type OutlineHeading,
  type OutlineHeadingItem,
  type UseDocumentOutlineResult,
  type UseDocumentSearchResult,
  type UseNavigationPaneOptions,
  type UseNavigationPaneResult,
} from './editor/navigation';

export { useFontFamily, type UseFontFamilyResult } from './editor/toolbar/useFontFamily';
export {
  useParagraphStyle,
  type ParagraphStyleOption,
  type UseParagraphStyleResult,
} from './editor/toolbar/useParagraphStyle';
export { useTableBorderTargetLabel } from './editor/toolbar/useTableBorderTargetLabel';
export {
  ToolbarContext,
  useToolbarContext,
  useToolbarLabel,
  useToolbarLabelFor,
  type ToolbarContextValue,
  type ToolbarTranslate,
} from './editor/toolbar/toolbar-context';

export {
  useContextMenuTarget,
  type ContextMenuAnchor,
  type ContextMenuContextValue,
} from './editor/contextmenu/contextmenu-context';

export {
  LocaleProvider,
  useTranslation,
  type LocaleProviderProps,
  type TranslationKey,
} from './i18n';
export { useChromeTranslate, type ChromeTranslate } from './i18n';

export {
  CHROME_GROUPS,
  CHROME_MENUS,
  chromeMenuSlots,
  commandForSlot,
  runToolbarCommand,
  toolbarCommandState,
  type ChromeSlotId,
  type ToolbarCommandState,
} from '@docx-editor.dev/core/editor';

export type {
  Editor,
  EditorCommand,
  EditorQuery,
  EditorSnapshot,
  EditorScope,
  PageSetup,
} from '@docx-editor.dev/core/contracts/editor';
export type { DocxDocument } from '@docx-editor.dev/core/contracts/types';
