import * as react_jsx_runtime from 'react/jsx-runtime';
import React__default, { CSSProperties, ReactNode } from 'react';
import {
  aq as ParagraphAlignment,
  ao as ColorValue,
  Y as Style,
  a3 as Theme,
  W as SelectionContext,
  f as AIAction,
  i as AgentResponse,
  ar as StyleType,
  V as SectionProperties,
  as as TabStop,
  D as Document,
} from './agentApi-BVHzyk2l.js';
import { T as TableAction, P as ParsedClipboardContent } from './clipboard-B7N7Kx2X.js';
export {
  c as PrintButton,
  d as PrintButtonProps,
  e as PrintOptions,
  f as PrintStyles,
  g as TableContext,
  h as TableSelection,
  i as TableToolbar,
  j as TableToolbarProps,
  k as addColumn,
  l as addRow,
  q as createTableContext,
  r as deleteColumn,
  s as deleteRow,
  t as formatPrintPageRange,
  u as getCellAt,
  v as getColumnCount,
  w as getDefaultPrintOptions,
  A as isPrintSupported,
  D as mergeCells,
  E as openPrintWindow,
  H as parsePageRange,
  L as splitCell,
  M as triggerPrint,
} from './clipboard-B7N7Kx2X.js';

/**
 * List type
 */
type ListType = 'bullet' | 'numbered' | 'none';
/**
 * List state for the current selection
 */
interface ListState {
  /** Type of list (bullet, numbered, or none) */
  type: ListType;
  /** Current list level (0-8) */
  level: number;
  /** Whether the selection is in a list */
  isInList: boolean;
  /** Numbering ID if in a list */
  numId?: number;
}
/**
 * Props for the ListButtons component
 */
interface ListButtonsProps {
  /** Current list state of the selection */
  listState?: ListState;
  /** Callback when bullet list is toggled */
  onBulletList?: () => void;
  /** Callback when numbered list is toggled */
  onNumberedList?: () => void;
  /** Callback to increase list indent */
  onIndent?: () => void;
  /** Callback to decrease list indent */
  onOutdent?: () => void;
  /** Whether the buttons are disabled */
  disabled?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Show indent/outdent buttons */
  showIndentButtons?: boolean;
  /** Compact mode (smaller buttons) */
  compact?: boolean;
  /** Whether the current paragraph has left indentation (for enabling outdent) */
  hasIndent?: boolean;
}
/**
 * List buttons component for bullet/numbered list controls
 */
declare function ListButtons({
  listState,
  onBulletList,
  onNumberedList,
  onIndent,
  onOutdent,
  disabled,
  className,
  style,
  showIndentButtons,
  compact,
  hasIndent,
}: ListButtonsProps): react_jsx_runtime.JSX.Element;
/**
 * Create a default list state (not in a list)
 */
declare function createDefaultListState(): ListState;

/**
 * Current formatting state of the selection
 */
interface SelectionFormatting {
  /** Whether selected text is bold */
  bold?: boolean;
  /** Whether selected text is italic */
  italic?: boolean;
  /** Whether selected text is underlined */
  underline?: boolean;
  /** Whether selected text has strikethrough */
  strike?: boolean;
  /** Whether selected text is superscript */
  superscript?: boolean;
  /** Whether selected text is subscript */
  subscript?: boolean;
  /** Font family of selected text */
  fontFamily?: string;
  /** Font size of selected text (in half-points) */
  fontSize?: number;
  /** Text color */
  color?: string;
  /** Highlight color */
  highlight?: string;
  /** Paragraph alignment */
  alignment?: ParagraphAlignment;
  /** List state of the current paragraph */
  listState?: ListState;
  /** Line spacing in twips (OOXML value, 240 = single spacing) */
  lineSpacing?: number;
  /** Paragraph style ID */
  styleId?: string;
  /** Paragraph left indentation in twips */
  indentLeft?: number;
  /** Whether the paragraph is RTL (bidi) */
  bidi?: boolean;
}
/**
 * Formatting action types
 */
type FormattingAction =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'superscript'
  | 'subscript'
  | 'clearFormatting'
  | 'bulletList'
  | 'numberedList'
  | 'indent'
  | 'outdent'
  | 'insertLink'
  | 'setRtl'
  | 'setLtr'
  | {
      type: 'fontFamily';
      value: string;
    }
  | {
      type: 'fontSize';
      value: number;
    }
  | {
      type: 'textColor';
      value: ColorValue | string;
    }
  | {
      type: 'highlightColor';
      value: string;
    }
  | {
      type: 'alignment';
      value: ParagraphAlignment;
    }
  | {
      type: 'lineSpacing';
      value: number;
    }
  | {
      type: 'applyStyle';
      value: string;
    };
/**
 * Props for the Toolbar component
 */
interface ToolbarProps {
  /** Current formatting of the selection */
  currentFormatting?: SelectionFormatting;
  /** Callback when a formatting action is triggered */
  onFormat?: (action: FormattingAction) => void;
  /** Callback for undo action */
  onUndo?: () => void;
  /** Callback for redo action */
  onRedo?: () => void;
  /** Whether undo is available */
  canUndo?: boolean;
  /** Whether redo is available */
  canRedo?: boolean;
  /** Whether the toolbar is disabled */
  disabled?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Whether to enable keyboard shortcuts (default: true) */
  enableShortcuts?: boolean;
  /** Ref to the editor container for keyboard events */
  editorRef?: React__default.RefObject<HTMLElement>;
  /** Custom toolbar items to render */
  children?: ReactNode;
  /** Whether to show font family picker (default: true) */
  showFontPicker?: boolean;
  /** Whether to show font size picker (default: true) */
  showFontSizePicker?: boolean;
  /** Whether to show text color picker (default: true) */
  showTextColorPicker?: boolean;
  /** Whether to show highlight color picker (default: true) */
  showHighlightColorPicker?: boolean;
  /** Whether to show alignment buttons (default: true) */
  showAlignmentButtons?: boolean;
  /** Whether to show list buttons (default: true) */
  showListButtons?: boolean;
  /** Whether to show line spacing picker (default: true) */
  showLineSpacingPicker?: boolean;
  /** Whether to show style picker (default: true) */
  showStylePicker?: boolean;
  /** Document styles for the style picker */
  documentStyles?: Style[];
  /** Theme for the style picker */
  theme?: Theme | null;
  /** Callback for print action */
  onPrint?: () => void;
  /** Whether to show print button (default: true) */
  showPrintButton?: boolean;
  /** Whether to show zoom control (default: true) */
  showZoomControl?: boolean;
  /** Current zoom level (1.0 = 100%) */
  zoom?: number;
  /** Callback when zoom changes */
  onZoomChange?: (zoom: number) => void;
  /** Callback to refocus the editor after toolbar interactions */
  onRefocusEditor?: () => void;
  /** Callback when a table should be inserted */
  onInsertTable?: (rows: number, columns: number) => void;
  /** Whether to show table insert button (default: true) */
  showTableInsert?: boolean;
  /** Callback when user wants to insert an image */
  onInsertImage?: () => void;
  /** Callback when user wants to insert a page break */
  onInsertPageBreak?: () => void;
  /** Callback when user wants to insert a table of contents */
  onInsertTOC?: () => void;
  /** Callback when user wants to insert a shape */
  onInsertShape?: (data: {
    shapeType: string;
    width: number;
    height: number;
    fillColor?: string;
    fillType?: string;
    outlineWidth?: number;
    outlineColor?: string;
  }) => void;
  /** Image context when an image is selected */
  imageContext?: {
    wrapType: string;
    displayMode: string;
    cssFloat: string | null;
  } | null;
  /** Callback when image wrap type changes */
  onImageWrapType?: (wrapType: string) => void;
  /** Callback for image transform (rotate/flip) */
  onImageTransform?: (action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV') => void;
  /** Callback to open image properties dialog (alt text + border) */
  onOpenImageProperties?: () => void;
  /** Callback to open page setup dialog */
  onPageSetup?: () => void;
  /** Table context when cursor is in a table */
  tableContext?: {
    isInTable: boolean;
    rowCount?: number;
    columnCount?: number;
    canSplitCell?: boolean;
    hasMultiCellSelection?: boolean;
    cellBorderColor?: ColorValue;
    cellBackgroundColor?: string;
  } | null;
  /** Callback when a table action is triggered */
  onTableAction?: (action: TableAction) => void;
}
/**
 * Props for individual toolbar buttons
 */
interface ToolbarButtonProps {
  /** Whether the button is in active/pressed state */
  active?: boolean;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Button title/tooltip */
  title?: string;
  /** Click handler */
  onClick?: () => void;
  /** Button content */
  children: ReactNode;
  /** Additional CSS class name */
  className?: string;
  /** ARIA label for accessibility */
  ariaLabel?: string;
}
/**
 * Props for toolbar button groups
 */
interface ToolbarGroupProps$1 {
  /** Group label for accessibility */
  label?: string;
  /** Group content */
  children: ReactNode;
  /** Additional CSS class name */
  className?: string;
}
/**
 * Individual toolbar button with shadcn styling
 */
declare function ToolbarButton({
  active,
  disabled,
  title,
  onClick,
  children,
  className,
  ariaLabel,
}: ToolbarButtonProps): react_jsx_runtime.JSX.Element;
/**
 * Toolbar button group with modern styling
 */
declare function ToolbarGroup$1({
  label,
  children,
  className,
}: ToolbarGroupProps$1): react_jsx_runtime.JSX.Element;
/**
 * Toolbar separator
 */
declare function ToolbarSeparator(): react_jsx_runtime.JSX.Element;
/**
 * Classic single-row formatting toolbar: menus + formatting icons.
 * Uses FormattingBar internally with inline mode so everything stays in one flex row.
 */
declare function Toolbar({
  children,
  className,
  style,
  disabled,
  onFormat,
  onPrint,
  showPrintButton,
  onPageSetup,
  onInsertImage,
  onInsertTable,
  showTableInsert,
  onInsertPageBreak,
  onInsertTOC,
  onRefocusEditor,
  ...restProps
}: ToolbarProps): react_jsx_runtime.JSX.Element;

/**
 * Context Menu Component
 *
 * Right-click context menu for AI actions on selected text.
 * Shows AI options like rewrite, expand, summarize, translate, etc.
 */

/**
 * Context menu props
 */
interface ContextMenuProps {
  /** Whether the menu is visible */
  isOpen: boolean;
  /** Menu position */
  position: {
    x: number;
    y: number;
  };
  /** Selected text */
  selectedText: string;
  /** Selection context for AI operations */
  selectionContext?: SelectionContext;
  /** Callback when an action is selected */
  onAction: (action: AIAction, customPrompt?: string) => void;
  /** Callback when menu is closed */
  onClose: () => void;
  /** Available actions (defaults to DEFAULT_AI_ACTIONS) */
  actions?: AIAction[];
  /** Whether to show custom prompt option */
  showCustomPrompt?: boolean;
  /** Additional className */
  className?: string;
}
declare const ContextMenu: React__default.FC<ContextMenuProps>;
/**
 * Hook to manage context menu state
 */
declare function useContextMenu(): {
  isOpen: boolean;
  position: {
    x: number;
    y: number;
  };
  selectedText: string;
  selectionContext: SelectionContext | undefined;
  openMenu: (
    e: React__default.MouseEvent | MouseEvent,
    text: string,
    context?: SelectionContext
  ) => void;
  closeMenu: () => void;
};
/**
 * Get action shortcuts
 */
declare function getActionShortcut(action: AIAction): string | undefined;
/**
 * Check if action is available for selection
 */
declare function isActionAvailable(
  _action: AIAction,
  selectedText: string,
  _selectionContext?: SelectionContext
): boolean;
/**
 * Get default actions for selection
 */
declare function getDefaultActions(): AIAction[];
/**
 * Get all available actions
 */
declare function getAllActions(): AIAction[];

/**
 * Response Preview Component
 *
 * Shows AI response preview with diff view before applying changes.
 * Allows user to accept, reject, or edit the response.
 */

/**
 * Response preview props
 */
interface ResponsePreviewProps {
  /** Original selected text */
  originalText: string;
  /** AI response (or null if loading/error) */
  response: AgentResponse | null;
  /** Action that was performed */
  action: AIAction;
  /** Whether the response is loading */
  isLoading: boolean;
  /** Error message if request failed */
  error?: string;
  /** Callback when user accepts the change */
  onAccept: (newText: string) => void;
  /** Callback when user rejects the change */
  onReject: () => void;
  /** Callback when user wants to retry */
  onRetry?: () => void;
  /** Allow editing before accepting */
  allowEdit?: boolean;
  /** Show diff view */
  showDiff?: boolean;
  /** Additional className */
  className?: string;
  /** Position for the preview */
  position?: {
    x: number;
    y: number;
  };
}
declare const ResponsePreview: React__default.FC<ResponsePreviewProps>;
/**
 * State for response preview
 */
interface ResponsePreviewState {
  isVisible: boolean;
  originalText: string;
  response: AgentResponse | null;
  action: AIAction;
  isLoading: boolean;
  error?: string;
  position?: {
    x: number;
    y: number;
  };
}
/**
 * Hook to manage response preview state
 */
declare function useResponsePreview(): {
  state: ResponsePreviewState;
  showPreview: (
    originalText: string,
    action: AIAction,
    position?: {
      x: number;
      y: number;
    }
  ) => void;
  setResponse: (response: AgentResponse) => void;
  setError: (error: string) => void;
  hidePreview: () => void;
};
/**
 * Create a mock response for testing
 */
declare function createMockResponse(newText: string, warnings?: string[]): AgentResponse;
/**
 * Create an error response
 */
declare function createErrorResponse(error: string): AgentResponse;

/**
 * Text Context Menu Component
 *
 * Right-click context menu for text editing operations.
 * Shows Cut, Copy, Paste, and other text editing options.
 */

/**
 * Context menu action types
 */
type TextContextAction =
  | 'cut'
  | 'copy'
  | 'paste'
  | 'pasteAsPlainText'
  | 'selectAll'
  | 'delete'
  | 'separator'
  | 'addRowAbove'
  | 'addRowBelow'
  | 'deleteRow'
  | 'addColumnLeft'
  | 'addColumnRight'
  | 'deleteColumn'
  | 'addComment';
/**
 * Menu item configuration
 */
interface TextContextMenuItem {
  /** Action type */
  action: TextContextAction;
  /** Display label */
  label: string;
  /** Keyboard shortcut hint */
  shortcut?: string;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Whether to show divider after this item */
  dividerAfter?: boolean;
}
/**
 * Context menu props
 */
interface TextContextMenuProps {
  /** Whether the menu is visible */
  isOpen: boolean;
  /** Menu position */
  position: {
    x: number;
    y: number;
  };
  /** Whether there's a selection (enables copy/cut) */
  hasSelection: boolean;
  /** Whether the editor is editable (enables paste/cut/delete) */
  isEditable: boolean;
  /** Whether clipboard has content (enables paste) */
  hasClipboardContent?: boolean;
  /** Callback when an action is selected */
  onAction: (action: TextContextAction) => void;
  /** Callback when menu is closed */
  onClose: () => void;
  /** Custom menu items (overrides default) */
  items?: TextContextMenuItem[];
  /** Additional className */
  className?: string;
}
/**
 * Hook options for text context menu
 */
interface UseTextContextMenuOptions {
  /** Whether the context menu is enabled */
  enabled?: boolean;
  /** Whether the editor is editable */
  isEditable?: boolean;
  /** Container element ref */
  containerRef?: React__default.RefObject<HTMLElement>;
  /** Callback when an action is triggered */
  onAction?: (action: TextContextAction) => void;
}
/**
 * Hook return value
 */
interface UseTextContextMenuReturn {
  /** Whether the menu is open */
  isOpen: boolean;
  /** Menu position */
  position: {
    x: number;
    y: number;
  };
  /** Whether there's a text selection */
  hasSelection: boolean;
  /** Open the context menu */
  openMenu: (event: React__default.MouseEvent | MouseEvent) => void;
  /** Close the context menu */
  closeMenu: () => void;
  /** Handle action selection */
  handleAction: (action: TextContextAction) => void;
  /** Context menu event handler for onContextMenu prop */
  onContextMenu: (event: React__default.MouseEvent) => void;
}
declare const TextContextMenu: React__default.FC<TextContextMenuProps>;
/**
 * Hook to manage text context menu state
 */
declare function useTextContextMenu(options?: UseTextContextMenuOptions): UseTextContextMenuReturn;
/**
 * Get action label
 */
declare function getTextActionLabel(action: TextContextAction): string;
/**
 * Get action shortcut
 */
declare function getTextActionShortcut(action: TextContextAction): string;
/**
 * Get default menu items
 */
declare function getDefaultTextContextMenuItems(): TextContextMenuItem[];
/**
 * Check if action is available
 */
declare function isTextActionAvailable(
  action: TextContextAction,
  hasSelection: boolean,
  isEditable: boolean
): boolean;

/**
 * Zoom Control Component (Radix UI)
 *
 * A dropdown for controlling document zoom level using Radix Select.
 */
interface ZoomLevel {
  value: number;
  label: string;
}
interface ZoomControlProps {
  value?: number;
  onChange?: (zoom: number) => void;
  levels?: ZoomLevel[];
  disabled?: boolean;
  className?: string;
  minZoom?: number;
  maxZoom?: number;
  showButtons?: boolean;
  persistZoom?: boolean;
  storageKey?: string;
  compact?: boolean;
}
declare function ZoomControl({
  value,
  onChange,
  levels,
  disabled,
  className,
  compact,
}: ZoomControlProps): react_jsx_runtime.JSX.Element;

/**
 * Font Picker Component (Radix UI)
 *
 * A dropdown selector for choosing font families using Radix Select.
 */
interface FontOption {
  name: string;
  fontFamily: string;
  category?: 'sans-serif' | 'serif' | 'monospace' | 'other';
}
interface FontPickerProps {
  value?: string;
  onChange?: (fontFamily: string) => void;
  fonts?: FontOption[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  width?: number | string;
  showPreview?: boolean;
}
declare function FontPicker({
  value,
  onChange,
  fonts,
  disabled,
  className,
  placeholder,
  width,
  showPreview,
}: FontPickerProps): react_jsx_runtime.JSX.Element;

/**
 * Font Size Picker Component (Google Docs Style)
 *
 * A font size control with minus/plus buttons and editable input.
 * Features:
 * - Minus button to decrease font size
 * - Plus button to increase font size
 * - Editable input for custom sizes
 * - Click input to show dropdown with preset sizes
 */
interface FontSizePickerProps {
  value?: number;
  onChange?: (size: number) => void;
  sizes?: number[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  width?: number | string;
  minSize?: number;
  maxSize?: number;
}
declare function FontSizePicker({
  value,
  onChange,
  sizes,
  disabled,
  className,
  placeholder,
  minSize,
  maxSize,
}: FontSizePickerProps): react_jsx_runtime.JSX.Element;

/**
 * Line Spacing Picker Component (Radix UI)
 *
 * A dropdown selector for choosing line spacing values using Radix Select.
 * Styled like Google Docs with options: Single, 1.15, 1.5, Double
 */
interface LineSpacingOption {
  label: string;
  value: number;
  twipsValue: number;
}
interface LineSpacingPickerProps {
  value?: number;
  onChange?: (twipsValue: number) => void;
  options?: LineSpacingOption[];
  disabled?: boolean;
  className?: string;
  width?: number | string;
}
declare function LineSpacingPicker({
  value,
  onChange,
  options,
  disabled,
  className,
}: LineSpacingPickerProps): react_jsx_runtime.JSX.Element;

/**
 * Color option for the color grid
 */
interface ColorOption {
  /** Display name for the color */
  name: string;
  /** Hex value (without #) */
  hex: string;
  /** Is this a theme color? */
  isTheme?: boolean;
  /** Theme color slot if applicable */
  themeSlot?: string;
}
/**
 * Props for the ColorPicker component
 */
interface ColorPickerProps {
  /** Current color value */
  value?: string;
  /** Callback when color is selected */
  onChange?: (color: string) => void;
  /** Type of color picker */
  type?: 'text' | 'highlight';
  /** Theme for resolving theme colors */
  theme?: Theme | null;
  /** Custom colors to display */
  colors?: ColorOption[];
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Placeholder/tooltip text */
  title?: string;
  /** Custom button content */
  children?: ReactNode;
  /** Width of the dropdown */
  dropdownWidth?: number;
  /** Show "No Color" option */
  showNoColor?: boolean;
  /** Show "More Colors" option for custom input */
  showMoreColors?: boolean;
}
/**
 * Color picker component with dropdown grid
 */
declare function ColorPicker({
  value,
  onChange,
  type,
  theme: _theme,
  colors,
  disabled,
  className,
  style,
  title,
  children,
  dropdownWidth,
  showNoColor,
  showMoreColors,
}: ColorPickerProps): react_jsx_runtime.JSX.Element;

type AdvancedColorPickerMode = 'text' | 'highlight' | 'border';
interface AdvancedColorPickerProps {
  mode: AdvancedColorPickerMode;
  value?: ColorValue | string;
  onChange?: (color: ColorValue | string) => void;
  theme?: Theme | null;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** Override the default icon for the mode */
  icon?: string;
  /** Override the auto/no-color button label */
  autoLabel?: string;
}
declare function AdvancedColorPicker({
  mode,
  value,
  onChange,
  theme,
  disabled,
  className,
  style,
  title,
  icon: iconOverride,
  autoLabel,
}: AdvancedColorPickerProps): react_jsx_runtime.JSX.Element;

interface StyleOption {
  styleId: string;
  name: string;
  type: StyleType;
  isDefault?: boolean;
  qFormat?: boolean;
  priority?: number;
  /** Font size in half-points for visual preview */
  fontSize?: number;
  /** Bold styling */
  bold?: boolean;
  /** Italic styling */
  italic?: boolean;
  /** Text color (RGB hex) */
  color?: string;
}
interface StylePickerProps {
  value?: string;
  onChange?: (styleId: string) => void;
  styles?: Style[];
  theme?: Theme | null;
  disabled?: boolean;
  className?: string;
  width?: number | string;
}
declare function StylePicker({
  value,
  onChange,
  styles,
  disabled,
  className,
  width,
}: StylePickerProps): react_jsx_runtime.JSX.Element;

/**
 * Props for the AlignmentButtons component
 */
interface AlignmentButtonsProps {
  /** Current alignment value */
  value?: ParagraphAlignment;
  /** Callback when alignment is changed */
  onChange?: (alignment: ParagraphAlignment) => void;
  /** Whether the buttons are disabled */
  disabled?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Show labels next to icons */
  showLabels?: boolean;
  /** Compact mode (smaller buttons) */
  compact?: boolean;
}
/**
 * Alignment dropdown component — single button with popover panel
 */
declare function AlignmentButtons({
  value,
  onChange,
  disabled,
}: AlignmentButtonsProps): react_jsx_runtime.JSX.Element;

/**
 * HorizontalRuler Component — Google Docs style
 *
 * 3 handles only:
 * - Left side: first-line indent (▼ down at top) + left indent (▲ up at bottom)
 * - Right side: right indent (▼ down at top)
 *
 * Margins shown as gray zones on the ruler edges.
 * Drag the boundary between gray/white to adjust page margins.
 * Drag tooltip shows value during any drag.
 */

interface HorizontalRulerProps {
  sectionProps?: SectionProperties | null;
  zoom?: number;
  editable?: boolean;
  onLeftMarginChange?: (marginTwips: number) => void;
  onRightMarginChange?: (marginTwips: number) => void;
  onFirstLineIndentChange?: (indentTwips: number) => void;
  showFirstLineIndent?: boolean;
  firstLineIndent?: number;
  hangingIndent?: boolean;
  indentLeft?: number;
  indentRight?: number;
  onIndentLeftChange?: (indentTwips: number) => void;
  onIndentRightChange?: (indentTwips: number) => void;
  unit?: 'inch' | 'cm';
  className?: string;
  style?: CSSProperties;
  tabStops?: TabStop[] | null;
  onTabStopRemove?: (positionTwips: number) => void;
}
declare function HorizontalRuler({
  sectionProps,
  zoom,
  editable,
  onLeftMarginChange,
  onRightMarginChange,
  onFirstLineIndentChange,
  showFirstLineIndent,
  firstLineIndent,
  hangingIndent,
  indentLeft,
  indentRight,
  onIndentLeftChange,
  onIndentRightChange,
  unit,
  className,
  style,
  tabStops,
  onTabStopRemove,
}: HorizontalRulerProps): React__default.ReactElement;
declare function positionToMargin(
  positionPx: number,
  side: 'left' | 'right',
  pageWidthPx: number,
  zoom: number
): number;
declare function getRulerDimensions(
  sectionProps?: SectionProperties | null,
  zoom?: number
): {
  width: number;
  leftMargin: number;
  rightMargin: number;
  contentWidth: number;
};
declare function getMarginInUnits(marginTwips: number, unit: 'inch' | 'cm'): string;
declare function parseMarginFromUnits(value: string, unit: 'inch' | 'cm'): number | null;

interface TableBorderPickerProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
}
declare function TableBorderPicker({
  onAction,
  disabled,
}: TableBorderPickerProps): react_jsx_runtime.JSX.Element;

interface TableBorderColorPickerProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
  theme?: Theme | null;
  /** Current border color (RGB hex without #) */
  value?: string;
}
declare function TableBorderColorPicker({
  onAction,
  disabled,
  theme,
  value,
}: TableBorderColorPickerProps): react_jsx_runtime.JSX.Element;

interface TableBorderWidthPickerProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
}
declare function TableBorderWidthPicker({
  onAction,
  disabled,
}: TableBorderWidthPickerProps): react_jsx_runtime.JSX.Element;

interface TableCellFillPickerProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
  theme?: Theme | null;
  /** Current fill color (RGB hex without #) */
  value?: string;
}
declare function TableCellFillPicker({
  onAction,
  disabled,
  theme,
  value,
}: TableCellFillPickerProps): react_jsx_runtime.JSX.Element;

interface TableMergeButtonProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
  canMerge?: boolean;
  canSplit?: boolean;
}
declare function TableMergeButton({
  onAction,
  disabled,
  canMerge,
  canSplit,
}: TableMergeButtonProps): react_jsx_runtime.JSX.Element;

interface TableInsertButtonsProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
}
declare function TableInsertButtons({
  onAction,
  disabled,
}: TableInsertButtonsProps): react_jsx_runtime.JSX.Element;

interface TableMoreDropdownProps {
  onAction: (action: TableAction) => void;
  disabled?: boolean;
  tableContext?: {
    isInTable: boolean;
    rowCount?: number;
    columnCount?: number;
    canSplitCell?: boolean;
    hasMultiCellSelection?: boolean;
    table?: {
      attrs?: {
        justification?: string;
      };
    };
  } | null;
}
declare function TableMoreDropdown({
  onAction,
  disabled,
  tableContext,
}: TableMoreDropdownProps): react_jsx_runtime.JSX.Element;

/**
 * Unsaved Changes Indicator Component
 *
 * Visual indicator that shows when document has unsaved changes.
 * Features:
 * - Configurable appearance (dot, badge, text)
 * - Pulse animation option for visibility
 * - Hook for tracking changes
 * - Browser beforeunload warning
 */

/**
 * Indicator variant type
 */
type IndicatorVariant = 'dot' | 'badge' | 'text' | 'icon';
/**
 * Indicator position type
 */
type IndicatorPosition = 'inline' | 'absolute-top-right' | 'absolute-top-left';
/**
 * Unsaved indicator props
 */
interface UnsavedIndicatorProps {
  /** Whether there are unsaved changes */
  hasUnsavedChanges: boolean;
  /** Variant of the indicator */
  variant?: IndicatorVariant;
  /** Position of the indicator */
  position?: IndicatorPosition;
  /** Whether to show pulse animation */
  showPulse?: boolean;
  /** Custom label for text variant */
  label?: string;
  /** Custom saved label for text variant */
  savedLabel?: string;
  /** Whether to show indicator when saved (always show) */
  showWhenSaved?: boolean;
  /** Custom color for unsaved state */
  unsavedColor?: string;
  /** Custom color for saved state */
  savedColor?: string;
  /** Size in pixels (for dot/icon) */
  size?: number;
  /** Additional className */
  className?: string;
  /** Additional inline styles */
  style?: React__default.CSSProperties;
  /** Click handler */
  onClick?: () => void;
  /** Title/tooltip text */
  title?: string;
}
/**
 * Hook options for tracking unsaved changes
 */
interface UseUnsavedChangesOptions {
  /** The document to track */
  document?: Document | null;
  /** Whether to warn before leaving page */
  warnBeforeLeave?: boolean;
  /** Custom warning message */
  warningMessage?: string;
  /** Whether tracking is enabled */
  enabled?: boolean;
  /** Callback when changes status changes */
  onChangeStatusChange?: (hasChanges: boolean) => void;
}
/**
 * Hook return value
 */
interface UseUnsavedChangesReturn {
  /** Whether there are unsaved changes */
  hasUnsavedChanges: boolean;
  /** Mark the document as saved (resets change tracking) */
  markAsSaved: () => void;
  /** Mark the document as changed */
  markAsChanged: () => void;
  /** Reset tracking (resets baseline) */
  resetTracking: (newDocument?: Document | null) => void;
  /** The last saved document snapshot */
  lastSavedDocument: Document | null;
  /** Number of changes since last save */
  changeCount: number;
}
declare const UnsavedIndicator: React__default.FC<UnsavedIndicatorProps>;
/**
 * Hook to track unsaved changes in a document
 */
declare function useUnsavedChanges(options?: UseUnsavedChangesOptions): UseUnsavedChangesReturn;
/**
 * Get indicator variant label
 */
declare function getVariantLabel(variant: IndicatorVariant): string;
/**
 * Get all indicator variants
 */
declare function getAllVariants(): IndicatorVariant[];
/**
 * Get all indicator positions
 */
declare function getAllPositions(): IndicatorPosition[];
/**
 * Create a document change tracker
 * Simple utility for external change tracking
 */
declare function createChangeTracker(): {
  markChanged: () => void;
  markSaved: () => void;
  getState: () => {
    changeCount: number;
    lastSaveTime: Date | null;
    hasUnsavedChanges: boolean;
  };
  reset: () => void;
};

/**
 * Loading Indicator Component
 *
 * Displays loading states for operations with configurable appearance.
 * Features:
 * - Multiple spinner styles (spinner, dots, bar, pulse)
 * - Overlay mode for blocking UI during operations
 * - Inline mode for subtle loading indication
 * - Progress bar variant
 * - Hook for managing loading states
 */

/**
 * Loading indicator variant
 */
type LoadingVariant = 'spinner' | 'dots' | 'bar' | 'pulse' | 'progress';
/**
 * Loading indicator size
 */
type LoadingSize = 'small' | 'medium' | 'large';
/**
 * Loading indicator props
 */
interface LoadingIndicatorProps {
  /** Whether loading is active */
  isLoading: boolean;
  /** Variant of the loading indicator */
  variant?: LoadingVariant;
  /** Size of the indicator */
  size?: LoadingSize;
  /** Loading message to display */
  message?: string;
  /** Whether to show as full-screen overlay */
  overlay?: boolean;
  /** Overlay background opacity (0-1) */
  overlayOpacity?: number;
  /** Progress percentage (0-100) for progress variant */
  progress?: number;
  /** Show progress percentage text */
  showProgressText?: boolean;
  /** Custom color */
  color?: string;
  /** Additional className */
  className?: string;
  /** Additional inline styles */
  style?: React__default.CSSProperties;
}
/**
 * Options for useLoading hook
 */
interface UseLoadingOptions {
  /** Initial loading state */
  initialLoading?: boolean;
  /** Minimum loading duration in ms (prevents flash) */
  minDuration?: number;
  /** Callback when loading starts */
  onStart?: () => void;
  /** Callback when loading ends */
  onEnd?: () => void;
}
/**
 * Return value of useLoading hook
 */
interface UseLoadingReturn {
  /** Current loading state */
  isLoading: boolean;
  /** Current message */
  message: string | null;
  /** Current progress (0-100) */
  progress: number;
  /** Start loading with optional message */
  startLoading: (message?: string) => void;
  /** Stop loading */
  stopLoading: () => void;
  /** Update progress (0-100) */
  setProgress: (progress: number) => void;
  /** Update message */
  setMessage: (message: string | null) => void;
  /** Wrap an async operation with loading state */
  withLoading: <T>(operation: () => Promise<T>, message?: string) => Promise<T>;
}
/**
 * Loading operation state
 */
interface LoadingOperation {
  id: string;
  message?: string;
  progress?: number;
  startTime: number;
}
declare const LoadingIndicator: React__default.FC<LoadingIndicatorProps>;
/**
 * Hook to manage loading states
 */
declare function useLoading(options?: UseLoadingOptions): UseLoadingReturn;
/**
 * Hook to manage multiple concurrent loading operations
 */
declare function useLoadingOperations(): {
  operations: LoadingOperation[];
  isAnyLoading: boolean;
  startOperation: (id: string, message?: string) => void;
  updateOperation: (id: string, updates: Partial<LoadingOperation>) => void;
  endOperation: (id: string) => void;
  getOperation: (id: string) => LoadingOperation | undefined;
};
/**
 * Get loading variant label
 */
declare function getLoadingVariantLabel(variant: LoadingVariant): string;
/**
 * Get all loading variants
 */
declare function getAllLoadingVariants(): LoadingVariant[];
/**
 * Get all loading sizes
 */
declare function getAllLoadingSizes(): LoadingSize[];
/**
 * Create a delay promise for testing loading states
 */
declare function delay(ms: number): Promise<void>;

/**
 * Responsive Toolbar Component
 *
 * A responsive toolbar wrapper that collapses items into an overflow menu
 * when the screen is narrow.
 *
 * Features:
 * - Automatically measures available space
 * - Moves items to overflow menu when they don't fit
 * - Priority-based item ordering
 * - Configurable breakpoints
 * - ResizeObserver for dynamic resizing
 */

/**
 * Priority level for toolbar items
 * Lower numbers = higher priority (shown first, hidden last)
 */
type ToolbarItemPriority = 1 | 2 | 3 | 4 | 5;
/**
 * Toolbar item configuration
 */
interface ToolbarItem {
  /** Unique identifier */
  id: string;
  /** The content to render */
  content: ReactNode;
  /** Priority level (1 = highest, 5 = lowest) */
  priority?: ToolbarItemPriority;
  /** Minimum width in pixels (for measuring) */
  minWidth?: number;
  /** Whether this item should never be hidden */
  alwaysVisible?: boolean;
  /** Whether to show separator after this item */
  separatorAfter?: boolean;
  /** Group name for keeping items together */
  group?: string;
}
/**
 * Props for ResponsiveToolbar component
 */
interface ResponsiveToolbarProps {
  /** Toolbar items */
  items: ToolbarItem[];
  /** Additional items for overflow menu only */
  overflowItems?: ToolbarItem[];
  /** Whether to show overflow button even when all items fit */
  alwaysShowOverflow?: boolean;
  /** Custom overflow button renderer */
  renderOverflowButton?: (itemCount: number, isOpen: boolean, onClick: () => void) => ReactNode;
  /** Custom overflow menu renderer */
  renderOverflowMenu?: (items: ToolbarItem[], onClose: () => void) => ReactNode;
  /** Gap between items in pixels */
  itemGap?: number;
  /** Padding for the toolbar */
  padding?: number | string;
  /** Minimum width for overflow button */
  overflowButtonWidth?: number;
  /** Additional className */
  className?: string;
  /** Additional styles */
  style?: CSSProperties;
  /** Height of the toolbar */
  height?: number | string;
  /** Background color */
  backgroundColor?: string;
  /** Border styles */
  borderBottom?: string;
}
/**
 * Options for useResponsiveToolbar hook
 */
interface UseResponsiveToolbarOptions {
  /** Container ref */
  containerRef: React__default.RefObject<HTMLElement | null>;
  /** Total items */
  items: ToolbarItem[];
  /** Gap between items */
  itemGap?: number;
  /** Width reserved for overflow button */
  overflowButtonWidth?: number;
}
/**
 * Return value of useResponsiveToolbar hook
 */
interface UseResponsiveToolbarReturn {
  /** Items that fit in visible area */
  visibleItems: ToolbarItem[];
  /** Items in overflow menu */
  overflowItems: ToolbarItem[];
  /** Whether overflow menu is needed */
  hasOverflow: boolean;
  /** Force a recalculation */
  recalculate: () => void;
}
/**
 * Hook to calculate which items fit in the toolbar
 */
declare function useResponsiveToolbar(
  options: UseResponsiveToolbarOptions
): UseResponsiveToolbarReturn;
declare const ResponsiveToolbar: React__default.FC<ResponsiveToolbarProps>;
interface ToolbarGroupProps {
  /** Group items */
  children: ReactNode;
  /** Gap between items */
  gap?: number;
  /** Whether to show separator after group */
  separatorAfter?: boolean;
  /** Additional className */
  className?: string;
  /** Additional styles */
  style?: CSSProperties;
}
declare const ToolbarGroup: React__default.FC<ToolbarGroupProps>;
/**
 * Create a toolbar item
 */
declare function createToolbarItem(
  id: string,
  content: ReactNode,
  options?: Partial<Omit<ToolbarItem, 'id' | 'content'>>
): ToolbarItem;
/**
 * Create toolbar items from an array of configs
 */
declare function createToolbarItems(
  configs: Array<{
    id: string;
    content: ReactNode;
    priority?: ToolbarItemPriority;
    minWidth?: number;
    alwaysVisible?: boolean;
    separatorAfter?: boolean;
    group?: string;
  }>
): ToolbarItem[];
/**
 * Get recommended priority for common toolbar items
 */
declare function getRecommendedPriority(itemType: string): ToolbarItemPriority;

/**
 * Find & Replace Utility Functions
 *
 * Pure utility functions for text search, pattern matching, and document search.
 * Extracted from FindReplaceDialog.tsx.
 */
/**
 * A single match result in the document
 */
interface FindMatch {
  /** Index of the paragraph containing the match */
  paragraphIndex: number;
  /** Index of the run/content within the paragraph */
  contentIndex: number;
  /** Character offset within the content */
  startOffset: number;
  /** Character offset for end of match */
  endOffset: number;
  /** The matched text */
  text: string;
}
/**
 * Find options for controlling search behavior
 */
interface FindOptions {
  /** Whether to match case */
  matchCase: boolean;
  /** Whether to match whole words only */
  matchWholeWord: boolean;
  /** Whether to use regular expressions (future) */
  useRegex?: boolean;
}
/**
 * Find result with all matches
 */
interface FindResult {
  /** All matches found */
  matches: FindMatch[];
  /** Total match count */
  totalCount: number;
  /** Current match index (0-based) */
  currentIndex: number;
}
/**
 * Highlight options for document rendering
 */
interface HighlightOptions {
  /** Background color for current match */
  currentMatchColor: string;
  /** Background color for other matches */
  otherMatchColor: string;
}
/**
 * Create default find options
 */
declare function createDefaultFindOptions(): FindOptions;
/**
 * Escape string for use in regex pattern
 */
declare function escapeRegexString(str: string): string;
/**
 * Create a regex pattern from search text and options
 */
declare function createSearchPattern(searchText: string, options: FindOptions): RegExp | null;
/**
 * Find all matches of search text in content
 */
declare function findAllMatches(
  content: string,
  searchText: string,
  options: FindOptions
): Array<{
  start: number;
  end: number;
}>;
/**
 * Replace text in content
 */
declare function replaceAllInContent(
  content: string,
  searchText: string,
  replaceText: string,
  options: FindOptions
): string;
/**
 * Replace first match in content
 */
declare function replaceFirstInContent(
  content: string,
  searchText: string,
  replaceText: string,
  options: FindOptions,
  startIndex?: number
): {
  content: string;
  replaced: boolean;
  matchStart: number;
  matchEnd: number;
};
/**
 * Get match count for status display
 */
declare function getMatchCountText(result: FindResult | null): string;
/**
 * Check if search text is empty or whitespace-only
 */
declare function isEmptySearch(searchText: string): boolean;
/**
 * Get default highlight options
 */
declare function getDefaultHighlightOptions(): HighlightOptions;
/**
 * Find all matches in a document
 */
declare function findInDocument(
  document: any,
  searchText: string,
  options: FindOptions
): FindMatch[];
/**
 * Find matches in a single paragraph
 */
declare function findInParagraph(
  paragraph: any,
  searchText: string,
  options: FindOptions,
  paragraphIndex: number
): FindMatch[];
/**
 * Scroll to a match in the document
 */
declare function scrollToMatch(containerElement: HTMLElement | null, match: FindMatch): void;

/**
 * useFindReplace Hook
 *
 * React hook for managing find/replace dialog state.
 * Extracted from FindReplaceDialog.tsx.
 */

/**
 * Options for the useFindReplace hook
 */
interface FindReplaceOptions {
  /** Whether to show replace functionality initially */
  initialReplaceMode?: boolean;
  /** Callback when matches change */
  onMatchesChange?: (matches: FindMatch[]) => void;
  /** Callback when current match changes */
  onCurrentMatchChange?: (match: FindMatch | null, index: number) => void;
}
/**
 * State for the find/replace hook
 */
interface FindReplaceState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Current search text */
  searchText: string;
  /** Current replace text */
  replaceText: string;
  /** Find options */
  options: FindOptions;
  /** All matches found */
  matches: FindMatch[];
  /** Current match index */
  currentIndex: number;
  /** Whether in replace mode */
  replaceMode: boolean;
}
/**
 * Return type for the useFindReplace hook
 */
interface UseFindReplaceReturn {
  /** Current state */
  state: FindReplaceState;
  /** Open the find dialog */
  openFind: (selectedText?: string) => void;
  /** Open the replace dialog */
  openReplace: (selectedText?: string) => void;
  /** Close the dialog */
  close: () => void;
  /** Toggle dialog visibility */
  toggle: () => void;
  /** Update search text */
  setSearchText: (text: string) => void;
  /** Update replace text */
  setReplaceText: (text: string) => void;
  /** Update find options */
  setOptions: (options: Partial<FindOptions>) => void;
  /** Set search results */
  setMatches: (matches: FindMatch[], currentIndex?: number) => void;
  /** Go to next match */
  goToNextMatch: () => number;
  /** Go to previous match */
  goToPreviousMatch: () => number;
  /** Go to a specific match by index */
  goToMatch: (index: number) => void;
  /** Get current match */
  getCurrentMatch: () => FindMatch | null;
  /** Check if has matches */
  hasMatches: () => boolean;
}
/**
 * Hook for managing find/replace dialog state
 */
declare function useFindReplace(hookOptions?: FindReplaceOptions): UseFindReplaceReturn;

/**
 * Find and Replace Dialog Component
 *
 * Modal dialog for searching and replacing text in the document.
 * Supports find, find next/previous, replace, and replace all operations.
 *
 * Logic and utilities are in separate files:
 * - findReplaceUtils.ts — Pure search/replace functions and types
 * - useFindReplace.ts   — React hook for dialog state management
 */

/**
 * Props for the FindReplaceDialog component
 */
interface FindReplaceDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when searching for text */
  onFind: (searchText: string, options: FindOptions) => FindResult | null;
  /** Callback when navigating to next match */
  onFindNext: () => FindMatch | null;
  /** Callback when navigating to previous match */
  onFindPrevious: () => FindMatch | null;
  /** Callback when replacing current match */
  onReplace: (replaceText: string) => boolean;
  /** Callback when replacing all matches */
  onReplaceAll: (searchText: string, replaceText: string, options: FindOptions) => number;
  /** Callback to highlight matches in document */
  onHighlightMatches?: (matches: FindMatch[]) => void;
  /** Callback to clear highlights */
  onClearHighlights?: () => void;
  /** Initial search text (e.g., from selected text) */
  initialSearchText?: string;
  /** Whether to start in replace mode */
  replaceMode?: boolean;
  /** Current match result (from external state) */
  currentResult?: FindResult | null;
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
}
/**
 * FindReplaceDialog component - Modal for finding and replacing text
 */
declare function FindReplaceDialog({
  isOpen,
  onClose,
  onFind,
  onFindNext,
  onFindPrevious,
  onReplace,
  onReplaceAll,
  onHighlightMatches,
  onClearHighlights,
  initialSearchText,
  replaceMode,
  currentResult,
  className,
  style,
}: FindReplaceDialogProps): React__default.ReactElement | null;

/**
 * Hyperlink Dialog Component
 *
 * Modal dialog for inserting and editing hyperlinks in the document.
 * Supports both external URLs and internal bookmark links.
 *
 * Features:
 * - Input for URL (http, https, mailto, tel, etc.)
 * - Input for display text
 * - Edit existing hyperlinks
 * - Remove hyperlink option
 * - Internal bookmark selection
 * - Validation and error handling
 */

/**
 * Hyperlink data structure for dialog
 */
interface HyperlinkData {
  /** URL for external link */
  url?: string;
  /** Display text for the link */
  displayText?: string;
  /** Internal bookmark name */
  bookmark?: string;
  /** Tooltip text */
  tooltip?: string;
}
/**
 * Bookmark option for internal link selection
 */
interface BookmarkOption {
  /** Bookmark name/ID */
  name: string;
  /** Optional display label */
  label?: string;
}
/**
 * Props for the HyperlinkDialog component
 */
interface HyperlinkDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when hyperlink is inserted/updated */
  onSubmit: (data: HyperlinkData) => void;
  /** Callback when hyperlink is removed */
  onRemove?: () => void;
  /** Initial data for editing existing hyperlink */
  initialData?: HyperlinkData;
  /** Currently selected text (used as default display text) */
  selectedText?: string;
  /** Whether we're editing an existing hyperlink */
  isEditing?: boolean;
  /** Available bookmarks for internal links */
  bookmarks?: BookmarkOption[];
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
}
/**
 * HyperlinkDialog component - Modal for inserting/editing hyperlinks
 */
declare function HyperlinkDialog({
  isOpen,
  onClose,
  onSubmit,
  onRemove,
  initialData,
  selectedText,
  isEditing,
  bookmarks,
  className,
  style,
}: HyperlinkDialogProps): React__default.ReactElement | null;
/**
 * Hook state for the Hyperlink dialog
 */
interface UseHyperlinkDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Initial data for the dialog (for editing) */
  initialData?: HyperlinkData;
  /** Currently selected text */
  selectedText?: string;
  /** Whether we're editing an existing hyperlink */
  isEditing: boolean;
}
/**
 * Hook return type for the Hyperlink dialog
 */
interface UseHyperlinkDialogReturn {
  /** Current state */
  state: UseHyperlinkDialogState;
  /** Open dialog for inserting new hyperlink */
  openInsert: (selectedText?: string) => void;
  /** Open dialog for editing existing hyperlink */
  openEdit: (data: HyperlinkData) => void;
  /** Close the dialog */
  close: () => void;
  /** Toggle dialog open/closed */
  toggle: () => void;
}
/**
 * Hook for managing Hyperlink dialog state
 */
declare function useHyperlinkDialog(): UseHyperlinkDialogReturn;

/**
 * Insert Table Dialog Component
 *
 * Modal dialog for inserting a new table into the document.
 * Provides a visual grid selector for choosing rows and columns.
 *
 * Features:
 * - Visual grid selector (hover to select dimensions)
 * - Manual row/column input
 * - Preview of table dimensions
 * - Quick insert with default sizes
 */

/**
 * Table configuration for insertion
 */
interface TableConfig {
  /** Number of rows */
  rows: number;
  /** Number of columns */
  columns: number;
}
/**
 * Props for InsertTableDialog
 */
interface InsertTableDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when table is inserted */
  onInsert: (config: TableConfig) => void;
  /** Maximum rows in grid selector (default: 8) */
  maxGridRows?: number;
  /** Maximum columns in grid selector (default: 10) */
  maxGridColumns?: number;
  /** Maximum allowed rows (default: 100) */
  maxRows?: number;
  /** Maximum allowed columns (default: 20) */
  maxColumns?: number;
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
}
/**
 * InsertTableDialog - Modal for inserting tables with visual grid selector
 */
declare function InsertTableDialog({
  isOpen,
  onClose,
  onInsert,
  maxGridRows,
  maxGridColumns,
  maxRows,
  maxColumns,
  className,
  style,
}: InsertTableDialogProps): React__default.ReactElement | null;
/**
 * Hook for managing Insert Table dialog state
 */
declare function useInsertTableDialog(): {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};
/**
 * Create a default TableConfig
 */
declare function createDefaultTableConfig(rows?: number, columns?: number): TableConfig;
/**
 * Validate TableConfig
 */
declare function isValidTableConfig(
  config: TableConfig,
  maxRows?: number,
  maxColumns?: number
): boolean;
/**
 * Clamp TableConfig to valid range
 */
declare function clampTableConfig(
  config: TableConfig,
  maxRows?: number,
  maxColumns?: number
): TableConfig;
/**
 * Format table dimensions for display
 */
declare function formatTableDimensions(config: TableConfig): string;
/**
 * Get common table presets
 */
declare function getTablePresets(): {
  label: string;
  config: TableConfig;
}[];

/**
 * Insert Image Dialog Component
 *
 * Modal dialog for inserting images into the document.
 * Supports file upload with preview and basic sizing options.
 *
 * Features:
 * - File input for image selection
 * - Drag and drop support
 * - Image preview
 * - Width/height controls with aspect ratio lock
 * - Alt text input
 */

/**
 * Image data for insertion
 */
interface ImageData {
  /** Base64 data URL or external URL */
  src: string;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Alt text for accessibility */
  alt?: string;
  /** Original file name */
  fileName?: string;
  /** MIME type */
  mimeType?: string;
}
/**
 * Props for InsertImageDialog
 */
interface InsertImageDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when image is inserted */
  onInsert: (data: ImageData) => void;
  /** Maximum width in pixels (default: 800) */
  maxWidth?: number;
  /** Maximum height in pixels (default: 600) */
  maxHeight?: number;
  /** Accepted file types (default: image/*) */
  accept?: string;
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
}
/**
 * InsertImageDialog - Modal for inserting images with preview and sizing
 */
declare function InsertImageDialog({
  isOpen,
  onClose,
  onInsert,
  maxWidth,
  maxHeight,
  accept,
  className,
  style,
}: InsertImageDialogProps): React__default.ReactElement | null;
/**
 * Hook for managing Insert Image dialog state
 */
declare function useInsertImageDialog(): {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};
/**
 * Check if a file is a valid image
 */
declare function isValidImageFile(file: File): boolean;
/**
 * Get supported image extensions
 */
declare function getSupportedImageExtensions(): string[];
/**
 * Get accept string for file input
 */
declare function getImageAcceptString(): string;
/**
 * Calculate scaled dimensions to fit within bounds
 */
declare function calculateFitDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number
): {
  width: number;
  height: number;
};
/**
 * Convert data URL to Blob
 */
declare function dataUrlToBlob(dataUrl: string): Blob;
/**
 * Get image dimensions from a data URL
 */
declare function getImageDimensions(src: string): Promise<{
  width: number;
  height: number;
}>;
/**
 * Format file size for display
 */
declare function formatFileSize(bytes: number): string;

/**
 * Insert Symbol Dialog Component
 *
 * Modal dialog for inserting special characters and symbols into the document.
 * Provides categorized symbol picker with search functionality.
 *
 * Features:
 * - Categorized symbol groups
 * - Recent symbols
 * - Search functionality
 * - Unicode character display
 */

/**
 * Symbol category
 */
interface SymbolCategory {
  /** Category name */
  name: string;
  /** Display label */
  label: string;
  /** Symbols in this category */
  symbols: string[];
}
/**
 * Props for InsertSymbolDialog
 */
interface InsertSymbolDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when symbol is inserted */
  onInsert: (symbol: string) => void;
  /** Recently used symbols */
  recentSymbols?: string[];
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
}
/**
 * Default symbol categories
 */
declare const SYMBOL_CATEGORIES: SymbolCategory[];
/**
 * InsertSymbolDialog - Modal for inserting special characters
 */
declare function InsertSymbolDialog({
  isOpen,
  onClose,
  onInsert,
  recentSymbols,
  className,
  style,
}: InsertSymbolDialogProps): React__default.ReactElement | null;
/**
 * Hook for managing Insert Symbol dialog state with recent symbols
 */
declare function useInsertSymbolDialog(maxRecent?: number): {
  isOpen: boolean;
  recentSymbols: string[];
  open: () => void;
  close: () => void;
  toggle: () => void;
  addRecent: (symbol: string) => void;
};
/**
 * Get all symbol categories
 */
declare function getSymbolCategories(): SymbolCategory[];
/**
 * Get symbols by category name
 */
declare function getSymbolsByCategory(categoryName: string): string[];
/**
 * Get symbol Unicode info
 */
declare function getSymbolInfo(symbol: string): {
  character: string;
  codePoint: string;
  decimal: number;
  hex: string;
};
/**
 * Search symbols by query
 */
declare function searchSymbols(query: string): string[];
/**
 * Get symbol from Unicode code point string
 */
declare function symbolFromCodePoint(codePointStr: string): string | null;

/**
 * Paste Special Dialog Component
 *
 * Provides paste options for pasting content with or without formatting.
 * Features:
 * - Paste with formatting (default)
 * - Paste as plain text (unformatted)
 * - Keyboard shortcut: Ctrl+Shift+V opens dialog
 */

/**
 * Paste option type
 */
type PasteOption = 'formatted' | 'plainText';
/**
 * Paste special dialog props
 */
interface PasteSpecialDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Callback when paste is confirmed */
  onPaste: (content: ParsedClipboardContent, asPlainText: boolean) => void;
  /** Optional custom position */
  position?: {
    x: number;
    y: number;
  };
  /** Additional className */
  className?: string;
}
/**
 * Paste option item
 */
interface PasteOptionItem {
  id: PasteOption;
  label: string;
  description: string;
  shortcut: string;
}
/**
 * Hook return value for paste special
 */
interface UsePasteSpecialReturn {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Open the paste special dialog */
  openDialog: () => void;
  /** Close the dialog */
  closeDialog: () => void;
  /** Handle keyboard shortcut (Ctrl+Shift+V) */
  handleKeyDown: (event: KeyboardEvent) => boolean;
  /** Paste as plain text directly */
  pasteAsPlainText: () => Promise<void>;
}
/**
 * Options for usePasteSpecial hook
 */
interface UsePasteSpecialOptions {
  /** Callback when paste is confirmed */
  onPaste?: (content: ParsedClipboardContent, asPlainText: boolean) => void;
  /** Whether paste operations are enabled */
  enabled?: boolean;
}
declare const PasteSpecialDialog: React__default.FC<PasteSpecialDialogProps>;
/**
 * Hook to manage paste special dialog
 */
declare function usePasteSpecial(options?: UsePasteSpecialOptions): UsePasteSpecialReturn;
/**
 * Get paste option by id
 */
declare function getPasteOption(id: PasteOption): PasteOptionItem | undefined;
/**
 * Get all paste options
 */
declare function getAllPasteOptions(): PasteOptionItem[];
/**
 * Get default paste option
 */
declare function getDefaultPasteOption(): PasteOption;
/**
 * Check if paste special shortcut
 */
declare function isPasteSpecialShortcut(event: KeyboardEvent): boolean;

/**
 * Keyboard Shortcuts Dialog Component
 *
 * Displays all available keyboard shortcuts organized by category.
 * Features:
 * - Categorized shortcut list
 * - Search/filter functionality
 * - Platform-aware modifier keys (Ctrl/Cmd)
 * - Keyboard shortcut to open (Ctrl+/)
 */

/**
 * Keyboard shortcut definition
 */
interface KeyboardShortcut {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description of what the shortcut does */
  description: string;
  /** Primary key combination (e.g., 'Ctrl+C') */
  keys: string;
  /** Alternative key combination */
  altKeys?: string;
  /** Category for grouping */
  category: ShortcutCategory;
  /** Whether this is a common/frequently used shortcut */
  common?: boolean;
}
/**
 * Shortcut category
 */
type ShortcutCategory =
  | 'editing'
  | 'formatting'
  | 'navigation'
  | 'clipboard'
  | 'selection'
  | 'view'
  | 'file'
  | 'other';
/**
 * Dialog props
 */
interface KeyboardShortcutsDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
  /** Custom shortcuts (merged with defaults) */
  customShortcuts?: KeyboardShortcut[];
  /** Whether to show search */
  showSearch?: boolean;
  /** Additional className */
  className?: string;
}
/**
 * Hook options
 */
interface UseKeyboardShortcutsDialogOptions {
  /** Whether the dialog can be opened with Ctrl+? or F1 */
  enabled?: boolean;
  /** Custom open shortcut (default: Ctrl+/) */
  openShortcut?: string;
}
/**
 * Hook return value
 */
interface UseKeyboardShortcutsDialogReturn {
  /** Whether dialog is open */
  isOpen: boolean;
  /** Open the dialog */
  open: () => void;
  /** Close the dialog */
  close: () => void;
  /** Toggle the dialog */
  toggle: () => void;
  /** Keyboard event handler */
  handleKeyDown: (event: KeyboardEvent) => void;
}
declare const KeyboardShortcutsDialog: React__default.FC<KeyboardShortcutsDialogProps>;
/**
 * Hook to manage keyboard shortcuts dialog
 */
declare function useKeyboardShortcutsDialog(
  options?: UseKeyboardShortcutsDialogOptions
): UseKeyboardShortcutsDialogReturn;
/**
 * Get all default shortcuts
 */
declare function getDefaultShortcuts(): KeyboardShortcut[];
/**
 * Get shortcuts by category
 */
declare function getShortcutsByCategory(category: ShortcutCategory): KeyboardShortcut[];
/**
 * Get common/frequently used shortcuts
 */
declare function getCommonShortcuts(): KeyboardShortcut[];
/**
 * Get category label
 */
declare function getCategoryLabel(category: ShortcutCategory): string;
/**
 * Get all categories
 */
declare function getAllCategories(): ShortcutCategory[];
/**
 * Format shortcut keys for display
 */
declare function formatShortcutKeys(keys: string): string;

export {
  AdvancedColorPicker,
  AlignmentButtons,
  type AlignmentButtonsProps,
  type ColorOption,
  ColorPicker,
  type ColorPickerProps,
  ContextMenu,
  type ContextMenuProps,
  type KeyboardShortcut as DialogKeyboardShortcut,
  type FindMatch,
  type FindOptions,
  FindReplaceDialog,
  type FindReplaceDialogProps,
  type FindReplaceOptions,
  type FindReplaceState,
  type FindResult,
  type FontOption,
  FontPicker,
  type FontPickerProps,
  FontSizePicker,
  type FontSizePickerProps,
  type HighlightOptions,
  HorizontalRuler,
  type HorizontalRulerProps,
  type HyperlinkData,
  HyperlinkDialog,
  type HyperlinkDialogProps,
  type ImageData,
  type IndicatorPosition,
  type IndicatorVariant,
  InsertImageDialog,
  type InsertImageDialogProps,
  InsertSymbolDialog,
  type InsertSymbolDialogProps,
  InsertTableDialog,
  type InsertTableDialogProps,
  KeyboardShortcutsDialog,
  type KeyboardShortcutsDialogProps,
  type LineSpacingOption,
  LineSpacingPicker,
  type LineSpacingPickerProps,
  ListButtons,
  type ListButtonsProps,
  type ListState,
  LoadingIndicator,
  type LoadingIndicatorProps,
  type LoadingOperation,
  type LoadingSize,
  type LoadingVariant,
  type PasteOption,
  PasteSpecialDialog,
  type PasteSpecialDialogProps,
  ResponsePreview,
  type ResponsePreviewProps,
  type ResponsePreviewState,
  ResponsiveToolbar,
  ToolbarGroup as ResponsiveToolbarGroup,
  type ToolbarGroupProps as ResponsiveToolbarGroupProps,
  type ResponsiveToolbarProps,
  SYMBOL_CATEGORIES,
  type ShortcutCategory,
  type StyleOption,
  StylePicker,
  type StylePickerProps,
  type SymbolCategory,
  TableAction,
  TableBorderColorPicker,
  type TableBorderColorPickerProps,
  TableBorderPicker,
  type TableBorderPickerProps,
  TableBorderWidthPicker,
  type TableBorderWidthPickerProps,
  TableCellFillPicker,
  type TableCellFillPickerProps,
  type TableConfig,
  TableInsertButtons,
  type TableInsertButtonsProps,
  TableMergeButton,
  type TableMergeButtonProps,
  TableMoreDropdown,
  type TableMoreDropdownProps,
  type TextContextAction,
  TextContextMenu,
  type TextContextMenuItem,
  type TextContextMenuProps,
  Toolbar,
  ToolbarButton,
  ToolbarGroup$1 as ToolbarGroup,
  type ToolbarItem,
  type ToolbarItemPriority,
  type ToolbarProps,
  ToolbarSeparator,
  UnsavedIndicator,
  type UnsavedIndicatorProps,
  type UseFindReplaceReturn,
  type UseKeyboardShortcutsDialogOptions,
  type UseKeyboardShortcutsDialogReturn,
  type UseLoadingOptions,
  type UseLoadingReturn,
  type UsePasteSpecialOptions,
  type UsePasteSpecialReturn,
  type UseResponsiveToolbarOptions,
  type UseResponsiveToolbarReturn,
  type UseTextContextMenuOptions,
  type UseTextContextMenuReturn,
  type UseUnsavedChangesOptions,
  type UseUnsavedChangesReturn,
  ZoomControl,
  type ZoomControlProps,
  calculateFitDimensions,
  clampTableConfig,
  createChangeTracker,
  createDefaultFindOptions,
  createDefaultListState,
  createDefaultTableConfig,
  createErrorResponse,
  createMockResponse,
  createSearchPattern,
  createToolbarItem,
  createToolbarItems,
  dataUrlToBlob,
  delay,
  escapeRegexString,
  findAllMatches,
  findInDocument,
  findInParagraph,
  formatFileSize,
  formatShortcutKeys,
  formatTableDimensions,
  getActionShortcut,
  getAllActions,
  getAllCategories,
  getAllPositions as getAllIndicatorPositions,
  getAllVariants as getAllIndicatorVariants,
  getAllLoadingSizes,
  getAllLoadingVariants,
  getAllPasteOptions,
  getCategoryLabel,
  getCommonShortcuts,
  getDefaultActions,
  getDefaultHighlightOptions,
  getDefaultPasteOption,
  getDefaultShortcuts,
  getDefaultTextContextMenuItems,
  getImageAcceptString,
  getImageDimensions,
  getLoadingVariantLabel,
  getMarginInUnits,
  getMatchCountText,
  getPasteOption,
  getRecommendedPriority,
  getRulerDimensions,
  getShortcutsByCategory,
  getSupportedImageExtensions,
  getSymbolCategories,
  getSymbolInfo as getSymbolUnicodeInfo,
  getSymbolsByCategory,
  getTablePresets,
  getTextActionLabel,
  getTextActionShortcut,
  getVariantLabel,
  isActionAvailable,
  isEmptySearch,
  isPasteSpecialShortcut,
  isTextActionAvailable,
  isValidImageFile,
  isValidTableConfig,
  parseMarginFromUnits,
  positionToMargin,
  replaceAllInContent,
  replaceFirstInContent,
  scrollToMatch,
  searchSymbols,
  symbolFromCodePoint,
  useContextMenu,
  useFindReplace,
  useHyperlinkDialog,
  useInsertImageDialog,
  useInsertSymbolDialog,
  useInsertTableDialog,
  useKeyboardShortcutsDialog,
  useLoading,
  useLoadingOperations,
  usePasteSpecial,
  useResponsePreview,
  useResponsiveToolbar,
  useTextContextMenu,
  useUnsavedChanges,
};
