/**
 * @eigenpal/docx-js-editor/ui
 *
 * UI entry point — Toolbar, pickers, dialogs, and UI components.
 *
 * @example
 * ```tsx
 * import { Toolbar, FontPicker, ColorPicker } from '@eigenpal/docx-js-editor/ui';
 * ```
 */

// ============================================================================
// TOOLBAR
// ============================================================================

export {
  Toolbar,
  type ToolbarProps,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from './components/Toolbar';

export { VariablePanel, type VariablePanelProps } from './components/VariablePanel';

export {
  ContextMenu,
  type ContextMenuProps,
  useContextMenu,
  getActionShortcut,
  isActionAvailable,
  getDefaultActions,
  getAllActions,
} from './components/ContextMenu';

export {
  ResponsePreview,
  type ResponsePreviewProps,
  useResponsePreview,
  type ResponsePreviewState,
  createMockResponse,
  createErrorResponse,
} from './components/ResponsePreview';

export {
  TextContextMenu,
  type TextContextMenuProps,
  type TextContextAction,
  type TextContextMenuItem,
  type UseTextContextMenuOptions,
  type UseTextContextMenuReturn,
  useTextContextMenu,
  getTextActionLabel,
  getTextActionShortcut,
  getDefaultTextContextMenuItems,
  isTextActionAvailable,
} from './components/TextContextMenu';

// ============================================================================
// UI CONTROLS
// ============================================================================

export { ZoomControl, type ZoomControlProps } from './components/ui/ZoomControl';
export {
  PageNumberIndicator,
  type PageNumberIndicatorProps,
  type PageIndicatorPosition,
  type PageIndicatorVariant,
  formatPageOrdinal,
  createPageFormat,
  getPageProgress,
  isFirstPage,
  isLastPage,
  calculateVisiblePage,
  calculateScrollToPage,
} from './components/ui/PageNumberIndicator';
export {
  PageNavigator,
  type PageNavigatorProps,
  type PageNavigatorPosition,
  type PageNavigatorVariant,
  parsePageInput,
  isValidPageNumber,
  clampPageNumber,
  getNavigationShortcuts,
  formatPageRange,
  calculateProgress,
} from './components/ui/PageNavigator';
export { FontPicker, type FontPickerProps, type FontOption } from './components/ui/FontPicker';
export { FontSizePicker, type FontSizePickerProps } from './components/ui/FontSizePicker';
export {
  LineSpacingPicker,
  type LineSpacingPickerProps,
  type LineSpacingOption,
} from './components/ui/LineSpacingPicker';
export { ColorPicker, type ColorPickerProps, type ColorOption } from './components/ui/ColorPicker';
export { StylePicker, type StylePickerProps, type StyleOption } from './components/ui/StylePicker';
export { AlignmentButtons, type AlignmentButtonsProps } from './components/ui/AlignmentButtons';
export {
  ListButtons,
  type ListButtonsProps,
  type ListState,
  createDefaultListState,
} from './components/ui/ListButtons';
export {
  TableToolbar,
  type TableToolbarProps,
  type TableContext,
  type TableSelection,
  type TableAction,
  createTableContext,
  addRow,
  deleteRow,
  addColumn,
  deleteColumn,
  mergeCells,
  splitCell,
  getColumnCount,
  getCellAt,
} from './components/ui/TableToolbar';
export {
  HorizontalRuler,
  type HorizontalRulerProps,
  getRulerDimensions,
  getMarginInUnits,
  parseMarginFromUnits,
  positionToMargin,
} from './components/ui/HorizontalRuler';
export {
  PrintButton,
  type PrintButtonProps,
  PrintStyles,
  type PrintOptions,
  triggerPrint,
  openPrintWindow,
  getDefaultPrintOptions,
  parsePageRange,
  formatPageRange as formatPrintPageRange,
  isPrintSupported,
} from './components/ui/PrintPreview';
export { TableBorderPicker, type TableBorderPickerProps } from './components/ui/TableBorderPicker';
export {
  TableBorderColorPicker,
  type TableBorderColorPickerProps,
} from './components/ui/TableBorderColorPicker';
export {
  TableBorderWidthPicker,
  type TableBorderWidthPickerProps,
} from './components/ui/TableBorderWidthPicker';
export {
  TableCellFillPicker,
  type TableCellFillPickerProps,
} from './components/ui/TableCellFillPicker';
export { TableMergeButton, type TableMergeButtonProps } from './components/ui/TableMergeButton';
export {
  TableInsertButtons,
  type TableInsertButtonsProps,
} from './components/ui/TableInsertButtons';
export { TableMoreDropdown, type TableMoreDropdownProps } from './components/ui/TableMoreDropdown';
export {
  CellBackgroundPicker,
  type CellBackgroundPickerProps,
  type CellColorOption,
  getDefaultCellColors,
  createCellColorOption,
  isDefaultCellColor,
  getCellColorName,
  createShadingFromColor,
  getColorFromShading,
  getContrastingTextColor,
  DEFAULT_CELL_COLORS,
} from './components/ui/CellBackgroundPicker';
export {
  UnsavedIndicator,
  type UnsavedIndicatorProps,
  type IndicatorVariant,
  type IndicatorPosition,
  type UseUnsavedChangesOptions,
  type UseUnsavedChangesReturn,
  useUnsavedChanges,
  getVariantLabel,
  getAllVariants as getAllIndicatorVariants,
  getAllPositions as getAllIndicatorPositions,
  createChangeTracker,
} from './components/ui/UnsavedIndicator';
export {
  LoadingIndicator,
  type LoadingIndicatorProps,
  type LoadingVariant,
  type LoadingSize,
  type UseLoadingOptions,
  type UseLoadingReturn,
  type LoadingOperation,
  useLoading,
  useLoadingOperations,
  getLoadingVariantLabel,
  getAllLoadingVariants,
  getAllLoadingSizes,
  delay,
} from './components/ui/LoadingIndicator';
export {
  ResponsiveToolbar,
  type ResponsiveToolbarProps,
  type ToolbarItem,
  type ToolbarItemPriority,
  type UseResponsiveToolbarOptions,
  type UseResponsiveToolbarReturn,
  ToolbarGroup as ResponsiveToolbarGroup,
  type ToolbarGroupProps as ResponsiveToolbarGroupProps,
  useResponsiveToolbar,
  createToolbarItem,
  createToolbarItems,
  getRecommendedPriority,
} from './components/ui/ResponsiveToolbar';

// ============================================================================
// DIALOGS
// ============================================================================

export {
  FindReplaceDialog,
  type FindReplaceDialogProps,
  type FindReplaceOptions,
  type FindOptions,
  type FindMatch,
  type FindResult,
  type FindReplaceState,
  type UseFindReplaceReturn,
  useFindReplace,
  findInDocument,
  findInParagraph,
  findAllMatches,
  scrollToMatch,
  createDefaultFindOptions,
  createSearchPattern,
  replaceAllInContent,
  replaceFirstInContent,
  getMatchCountText,
  isEmptySearch,
  escapeRegexString,
  getDefaultHighlightOptions,
  type HighlightOptions,
} from './components/dialogs/FindReplaceDialog';
export {
  HyperlinkDialog,
  type HyperlinkDialogProps,
  type HyperlinkData,
  useHyperlinkDialog,
} from './components/dialogs/HyperlinkDialog';
export {
  InsertTableDialog,
  type InsertTableDialogProps,
  type TableConfig,
  useInsertTableDialog,
  createDefaultTableConfig,
  isValidTableConfig,
  clampTableConfig,
  formatTableDimensions,
  getTablePresets,
} from './components/dialogs/InsertTableDialog';
export {
  InsertImageDialog,
  type InsertImageDialogProps,
  type ImageData,
  useInsertImageDialog,
  isValidImageFile,
  getSupportedImageExtensions,
  getImageAcceptString,
  calculateFitDimensions,
  dataUrlToBlob,
  getImageDimensions,
  formatFileSize,
} from './components/dialogs/InsertImageDialog';
export {
  InsertSymbolDialog,
  type InsertSymbolDialogProps,
  type SymbolCategory,
  useInsertSymbolDialog,
  getSymbolCategories,
  getSymbolsByCategory,
  getSymbolInfo as getSymbolUnicodeInfo,
  searchSymbols,
  symbolFromCodePoint,
  SYMBOL_CATEGORIES,
} from './components/dialogs/InsertSymbolDialog';
export {
  PasteSpecialDialog,
  type PasteSpecialDialogProps,
  type PasteOption,
  type UsePasteSpecialReturn,
  type UsePasteSpecialOptions,
  usePasteSpecial,
  getPasteOption,
  getAllPasteOptions,
  getDefaultPasteOption,
  isPasteSpecialShortcut,
} from './components/dialogs/PasteSpecialDialog';
export {
  KeyboardShortcutsDialog,
  type KeyboardShortcutsDialogProps,
  type KeyboardShortcut as DialogKeyboardShortcut,
  type ShortcutCategory,
  type UseKeyboardShortcutsDialogOptions,
  type UseKeyboardShortcutsDialogReturn,
  useKeyboardShortcutsDialog,
  getDefaultShortcuts,
  getShortcutsByCategory,
  getCommonShortcuts,
  getCategoryLabel,
  getAllCategories,
  formatShortcutKeys,
} from './components/dialogs/KeyboardShortcutsDialog';
