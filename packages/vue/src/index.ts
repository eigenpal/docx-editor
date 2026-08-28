/**
 * @docx-editor.dev/vue
 * @packageDocumentation
 * @public
 */

export { VERSION } from './version';

export type { MaybeRefOrGetter } from './maybe-ref-or-getter';
export type { DocxEditorChildren } from './docx-editor-children';

export { DocxEditor, type DocxEditorNamespace } from './components/DocxEditor';
export type { DocxEditorProps, DocxEditorRef, EditorMode } from './types';

export {
  DocxEditorRoot,
  type DocxEditorRootProps,
  type DocxEditorRootListeners,
  type ProvideDocxEditorResult,
  provideDocxEditor,
} from './editor/DocxEditorRoot';
export { DocxEditorViewport, type DocxEditorViewportProps } from './editor/DocxEditorViewport';
export { DocxEditorContent, type DocxEditorContentProps } from './editor/DocxEditorContent';
export { DocxEditorEquation } from './editor/DocxEditorEquation';

export { useDocxEditor, ReviewRailContext, type ReviewRailRegistry } from './editor/context';
export {
  REVIEW_MARKERS_GUTTER,
  REVIEW_PANE_GUTTER,
  reviewGutter,
  useReviewGutter,
  type ReviewGutter,
  type ReviewGutterInput,
} from './editor/review-gutter';
export { useEditorState, editorStateActiveSubscriptionCount } from './editor/useEditorState';
export { notificationYieldsToTask } from './editor/deferred-notifier';
export { useReviewAuthors } from './editor/useReviewAuthors';
export {
  DocxEditorAuthorStyle,
  DocxEditorColorByChangeType,
  type DocxEditorAuthorStyleProps,
} from './editor/DocxEditorAuthorStyle';
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
  useParagraphFormat,
  type ParagraphFlagState,
  type ParagraphFormatRead,
  type ParagraphFormatUpdate,
  type ParagraphTabStop,
  type UseParagraphFormatReturn,
} from './editor/useParagraphFormat';
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

export { useTableBorderTargetLabel } from './editor/toolbar/useTableBorderTargetLabel';
export {
  DocxEditorToolbar,
  useFontFamily,
  useParagraphStyle,
  type DocxEditorToolbarNamespace,
  type DocxEditorToolbarProps,
  type ToolbarActionProps,
  type ToolbarAlignmentComponent,
  type FontFamilyItemProps,
  type FontFamilyNamespace,
  type FontFamilyPartProps,
  type FontFamilyProps,
  type ParagraphStyleItemProps,
  type ParagraphStyleNamespace,
  type ParagraphStylePartProps,
  type ParagraphStyleProps,
  type ToolbarButtonProps,
  type ToolbarPartComponent,
  type ToolbarPartProps,
  type ToolbarSeparatorProps,
  type ToolbarSlotPartComponent,
  type ToolbarSlotPartProps,
  type TableBorderColorNamespace,
  type TableBorderStyleNamespace,
  type TableBorderTargetNamespace,
  type TableBorderWidthNamespace,
  type TableCellFillNamespace,
  type TableChromeItemProps,
  type TableChromePartComponent,
  type TableChromePartProps,
  type UseFontFamilyResult,
  type UseParagraphStyleResult,
  type ParagraphStyleOption,
} from './editor/toolbar';
export { Slot, type SlotProps } from './editor/toolbar/Slot';
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
  DocxEditorContextMenu,
  ContextMenuCopy,
  ContextMenuCopyFormatting,
  ContextMenuCut,
  ContextMenuCellVerticalAlignment,
  ContextMenuDelete,
  ContextMenuItem,
  ContextMenuPaste,
  ContextMenuPasteFormatting,
  ContextMenuPasteWithoutFormatting,
  ContextMenuSelectAll,
  ContextMenuDeleteTable,
  ContextMenuDeleteTableColumn,
  ContextMenuDeleteTableRow,
  ContextMenuInsertColumnLeft,
  ContextMenuInsertColumnRight,
  ContextMenuInsertRowAbove,
  ContextMenuInsertRowBelow,
  ContextMenuRefreshToc,
  ContextMenuRefreshTocPageNumbers,
  type ContextMenuAnchor,
  type ContextMenuCommandProps,
  type ContextMenuContextValue,
  type ContextMenuItemProps,
  type ContextMenuTableRowProps,
  type DocxEditorContextMenuNamespace,
  type DocxEditorContextMenuProps,
} from './editor/contextmenu';

export {
  DocxEditorMenu,
  type DocxEditorMenuNamespace,
  type DocxEditorMenuProps,
  type MenuActionProps,
  type MenuGroupProps,
  type MenuId,
  type MenuItemProps,
  type MenuPartComponent,
  type MenuProps,
  type MenuReportIssueProps,
  type MenuRowProps,
  type MenuSeparatorProps,
  type MenuSubmenuProps,
  type MenuTableGridProps,
} from './editor/menu';

export {
  DocxEditorNavigation,
  NavigationClose,
  NavigationFind,
  NavigationHeader,
  NavigationHeadings,
  NavigationTab,
  NavigationTabs,
  NavigationTitle,
  NavigationToggle,
  type DocxEditorNavigationNamespace,
  type DocxEditorNavigationProps,
  type NavigationPartProps,
  type NavigationTabProps,
} from './editor/navigation';

export {
  DocxEditorHeaderFooterChrome,
  type DocxEditorHeaderFooterChromeProps,
} from './editor/DocxEditorHeaderFooter';
export { DocxEditorNotesChrome, type DocxEditorNotesChromeProps } from './editor/DocxEditorNotes';

export {
  DocxEditorHyperLink,
  type DocxEditorHyperLinkNamespace,
  type HyperLinkActionProps,
  type HyperLinkPartProps,
  type HyperLinkProps,
} from './editor/DocxEditorHyperLink';

export {
  DocxEditorContentControl,
  type DocxEditorContentControlNamespace,
  type ContentControlActionProps,
  type ContentControlPartProps,
  type ContentControlProps,
} from './editor/DocxEditorContentControl';

export {
  DocxEditorLoading,
  DocxEditorLoadingSpinner,
  type DocxEditorLoadingComponent,
  type DocxEditorLoadingProps,
  type DocxEditorLoadingSpinnerProps,
} from './editor/DocxEditorLoading';

export {
  DocxEditorHorizontalRuler,
  DocxEditorVerticalRuler,
  type DocxEditorRulerProps,
} from './editor/DocxEditorRulers';

export {
  DocxEditorFontNotice,
  type DocxEditorFontNoticeProps,
} from './editor/DocxEditorFontNotice';

export {
  DocxEditorDocumentOutline,
  type DocxEditorDocumentOutlineProps,
} from './editor/DocxEditorOutline';

export {
  DocxEditorPageNumber,
  type DocxEditorPageNumberProps,
  PageNumberTranslationContext,
} from './editor/DocxEditorPageNumber';

export {
  DocxEditorImagePropertiesDialog,
  ImageInsertProvider,
  ImageInsertTrigger,
  ImageWrap,
  ImageAltText,
  ImagePropertiesTrigger,
  ToolbarImageProperties,
  normalizeImageBytes,
  type DocxEditorImagePropertiesDialogProps,
  type ImagePropertiesTriggerProps,
  type NormalizedImagePayload,
} from './editor/images';

export { useScopedChromeAnchor, type ScopedChromeAnchor } from './editor/useScopedChromeAnchor';

export { HorizontalRuler, type HorizontalRulerProps } from './components/ui/HorizontalRuler';
export { VerticalRuler, RULER_WIDTH, type VerticalRulerProps } from './components/ui/VerticalRuler';

export {
  DocxEditorPageSetupDialog,
  type DocxEditorPageSetupDialogProps,
} from './editor/DocxEditorPageSetup';

export {
  DocxEditorParagraphDialog,
  type DocxEditorParagraphDialogProps,
} from './editor/DocxEditorParagraphDialog';

export {
  PaginatedDocxEditor,
  type PaginatedDocxEditorHandle,
  type PaginatedDocxEditorExpose,
  type PaginatedDocxEditorProps,
} from './components/PaginatedDocxEditor';
export {
  PaginatedDocxEditorShell,
  type PaginatedDocxEditorShellProps,
} from './components/PaginatedDocxEditorShell';
export { PageIndicator, type PageIndicatorProps } from './components/DocxEditor/PageIndicator';
export {
  DocumentOutline,
  OUTLINE_BUTTON_LEFT_OFFSET,
  OUTLINE_BUTTON_RESERVED_SPACE,
  OUTLINE_LEFT_OFFSET,
  OUTLINE_RESERVED_SPACE,
} from './components/DocumentOutline';

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
  type ChromeMenu,
  type ChromeMenuEntry,
  type ChromeMenuId,
  type ChromeMenuItemEntry,
  type ChromeMenuSeparatorEntry,
  type ChromeMenuSubmenuEntry,
  type ChromeSlotId,
  type ToolbarCommandState,
} from '@docx-editor.dev/core/editor';

export { EditorFontError } from './types';
export type {
  EditorFontErrorCode,
  FontConfiguration,
  FontFaceRequest,
  FontSource,
  FontSourceSubstitution,
} from './types';
export {
  MAX_RESOLVER_FAMILIES,
  WORD_DEFAULT_FONT,
  composeFontConfiguration,
  composeFontOrigins,
  createFontSource,
  defineFontResolver,
  isFontResolver,
  loadFonts,
  type FontConfigurationBase,
  type FontConfigurationFragment,
  type FontLoadFailure,
  type FontLoadFailureReason,
  type FontOrigin,
  type FontResolutionRequest,
  type FontResolver,
  type FontUrlSource,
  type LoadFontsRequest,
  type LoadFontsResult,
} from '@docx-editor.dev/core/editor';

export {
  generateRulerTicks,
  rulerPageBox,
  PX_PER_INCH,
  PX_PER_CM,
  type RulerTick,
  type RulerUnit,
} from './rulerTicks';

export { Toolbar, ToolbarButton, ToolbarGroup, type ToolbarProps } from './components/Toolbar';
export { DocxEditorShell } from './components/DocxEditor/DocxEditorShell';
export { TitleBar, MenuBar, DocumentName, Logo, TitleBarRight } from './components/TitleBar';

export type {
  Editor,
  EditorCommand,
  EditorQuery,
  EditorSnapshot,
  EditorScope,
  PageSetup,
} from '@docx-editor.dev/core/contracts/editor';
export type {
  ReviewAuthorInfo,
  RevisionAuthorAssignments,
  RevisionAuthorStyle,
  RevisionStyles,
} from '@docx-editor.dev/core/editor';
export type { DocxDocument } from '@docx-editor.dev/core/contracts/types';
