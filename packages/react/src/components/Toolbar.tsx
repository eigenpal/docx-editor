/**
 * Formatting Toolbar Component
 *
 * A toolbar with formatting controls for the DOCX editor:
 * - Font family picker
 * - Bold (Ctrl+B), Italic (Ctrl+I), Underline (Ctrl+U), Strikethrough
 * - Superscript, Subscript buttons
 * - Shows active state for current selection formatting
 * - Applies formatting to selection
 */

import React, { Fragment, useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ColorValue, Style, Theme } from '@eigenpal/docx-core/types/document';
import type { FormattingAction, SelectionFormatting } from './toolbarTypes';
import { useToolbarItems } from './toolbarItems';
import { Button } from './ui/Button';
import { Tooltip } from './ui/Tooltip';
import type { TableAction } from './ui/TableToolbar';
import { cn } from '../lib/utils';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Props for the Toolbar component
 */
export interface ToolbarProps {
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
  editorRef?: React.RefObject<HTMLElement>;
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
  /** Callback for "Save as DOCX" in the File menu */
  onSaveAsDocx?: () => void;
  /** Callback for "Save as PDF" in the File menu */
  onSaveAsPdf?: () => void;
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
export interface ToolbarButtonProps {
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
export interface ToolbarGroupProps {
  /** Group label for accessibility */
  label?: string;
  /** Group content */
  children: ReactNode;
  /** Additional CSS class name */
  className?: string;
}

// ============================================================================
// STYLES
// ============================================================================

// Toolbar uses Tailwind classes now - see the component JSX for styling

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

/**
 * Individual toolbar button with shadcn styling
 */
export function ToolbarButton({
  active = false,
  disabled = false,
  title,
  onClick,
  children,
  className,
  ariaLabel,
}: ToolbarButtonProps) {
  // Generate testid from ariaLabel or title
  const testId =
    ariaLabel?.toLowerCase().replace(/\s+/g, '-') ||
    title
      ?.toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/\([^)]*\)/g, '')
      .trim();

  // Prevent mousedown from stealing focus from the editor selection
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(
        'text-slate-500 hover:text-slate-900 hover:bg-slate-100/80',
        active && 'bg-slate-900 text-white hover:bg-slate-800 hover:text-white',
        disabled && 'opacity-30 cursor-not-allowed',
        className
      )}
      onMouseDown={handleMouseDown}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={ariaLabel || title}
      data-testid={testId ? `toolbar-${testId}` : undefined}
    >
      {children}
    </Button>
  );

  if (title) {
    return <Tooltip content={title}>{button}</Tooltip>;
  }

  return button;
}

/**
 * Toolbar button group with modern styling
 */
export function ToolbarGroup({ label, children, className }: ToolbarGroupProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-px px-1.5 border-r border-slate-200/50 last:border-r-0 first:pl-0',
        className
      )}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}

/**
 * Toolbar separator
 */
export function ToolbarSeparator() {
  return <div className="w-px h-6 bg-slate-200 mx-1.5" role="separator" />;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Formatting toolbar with all controls
 */
export function Toolbar({
  currentFormatting = {},
  onFormat,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  disabled = false,
  className,
  style,
  enableShortcuts = true,
  editorRef,
  children,
  showFontPicker = true,
  showFontSizePicker = true,
  showTextColorPicker = true,
  showHighlightColorPicker = true,
  showAlignmentButtons = true,
  showListButtons = true,
  showLineSpacingPicker = true,
  showStylePicker = true,
  documentStyles,
  theme,
  onPrint,
  showPrintButton = true,
  showZoomControl = true,
  zoom,
  onZoomChange,
  onRefocusEditor,
  onInsertTable,
  showTableInsert = true,
  onInsertImage,
  onInsertPageBreak,
  onInsertTOC,
  imageContext,
  onImageWrapType,
  onImageTransform,
  onOpenImageProperties,
  onPageSetup,
  tableContext,
  onTableAction,
}: ToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);

  const { compact, actions } = useToolbarItems({
    currentFormatting,
    documentStyles,
    theme,
    disabled,
    canUndo,
    canRedo,
    onFormat,
    onUndo,
    onRedo,
    onPrint,
    onPageSetup,
    showPrintButton,
    showFontPicker,
    showFontSizePicker,
    showTextColorPicker,
    showHighlightColorPicker,
    showAlignmentButtons,
    showListButtons,
    showLineSpacingPicker,
    showStylePicker,
    showZoomControl,
    zoom,
    onZoomChange,
    onRefocusEditor,
    onInsertTable,
    showTableInsert,
    onInsertImage,
    onInsertPageBreak,
    onInsertTOC,
    imageContext,
    onImageWrapType,
    onImageTransform,
    onOpenImageProperties,
    tableContext,
    onTableAction,
  });

  const { format, align } = actions;

  /**
   * Keyboard shortcuts handler
   */
  useEffect(() => {
    if (!enableShortcuts) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only process if editor has focus or toolbar has focus
      const target = event.target as HTMLElement;
      const editorContainer = editorRef?.current;
      const toolbarContainer = toolbarRef.current;

      const isInEditor = editorContainer?.contains(target);
      const isInToolbar = toolbarContainer?.contains(target);

      if (!isInEditor && !isInToolbar) return;

      const isCtrl = event.ctrlKey || event.metaKey;

      if (isCtrl && !event.altKey) {
        switch (event.key.toLowerCase()) {
          case 'b':
            event.preventDefault();
            format('bold');
            break;
          case 'i':
            event.preventDefault();
            format('italic');
            break;
          case 'u':
            event.preventDefault();
            format('underline');
            break;
          case '=':
            // Ctrl+= for subscript (common shortcut)
            if (event.shiftKey) {
              event.preventDefault();
              format('superscript');
            } else {
              event.preventDefault();
              format('subscript');
            }
            break;
          // Alignment shortcuts
          case 'l':
            event.preventDefault();
            align('left');
            break;
          case 'e':
            event.preventDefault();
            align('center');
            break;
          case 'r':
            event.preventDefault();
            align('right');
            break;
          case 'j':
            event.preventDefault();
            align('both');
            break;
          case 'k':
            event.preventDefault();
            format('insertLink');
            break;
          // Undo/Redo handled by useHistory hook
        }
      }
    };

    // Add listener to document
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enableShortcuts, format, align, editorRef]);

  // Prevent toolbar clicks from stealing focus and refocus editor
  const handleToolbarMouseDown = (e: React.MouseEvent) => {
    // Allow clicks on input/select elements to work normally
    const target = e.target as HTMLElement;
    const isInteractive =
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'OPTION';

    if (!isInteractive) {
      // Prevent the mousedown from stealing focus
      e.preventDefault();
    }
  };

  // Refocus editor after toolbar click (called on mouseup)
  const handleToolbarMouseUp = (e: React.MouseEvent) => {
    // Don't refocus if user is interacting with a select/input
    const target = e.target as HTMLElement;
    const activeEl = document.activeElement as HTMLElement;
    const isSelectActive =
      target.tagName === 'SELECT' || target.tagName === 'OPTION' || activeEl?.tagName === 'SELECT';

    if (isSelectActive) {
      return; // Let the select keep focus
    }

    // Use requestAnimationFrame to ensure the click action completes first
    requestAnimationFrame(() => {
      onRefocusEditor?.();
    });
  };

  return (
    <div
      ref={toolbarRef}
      className={cn(
        'flex items-center px-1 py-1 bg-white border-b border-slate-100 min-h-[36px] overflow-x-auto',
        className
      )}
      style={style}
      role="toolbar"
      aria-label="Formatting toolbar"
      data-testid="toolbar"
      onMouseDown={handleToolbarMouseDown}
      onMouseUp={handleToolbarMouseUp}
    >
      {compact.map((entry) => {
        if (entry.kind === 'group') {
          return (
            <ToolbarGroup key={entry.id} label={entry.label}>
              {entry.items.map((item) =>
                item.kind === 'button' ? (
                  <ToolbarButton
                    key={item.id}
                    onClick={item.onClick}
                    active={item.isActive}
                    disabled={item.disabled}
                    title={item.title}
                    ariaLabel={item.ariaLabel}
                  >
                    {item.icon}
                  </ToolbarButton>
                ) : (
                  <Fragment key={item.id}>{item.node}</Fragment>
                )
              )}
            </ToolbarGroup>
          );
        }

        if (entry.kind === 'button') {
          return (
            <ToolbarButton
              key={entry.id}
              onClick={entry.onClick}
              active={entry.isActive}
              disabled={entry.disabled}
              title={entry.title}
              ariaLabel={entry.ariaLabel}
            >
              {entry.icon}
            </ToolbarButton>
          );
        }

        return <Fragment key={entry.id}>{entry.node}</Fragment>;
      })}

      {children}
    </div>
  );
}

export type { SelectionFormatting, FormattingAction } from './toolbarTypes';

// ============================================================================
// RE-EXPORTED UTILITIES (from toolbarUtils.ts)
// ============================================================================

export {
  getSelectionFormatting,
  applyFormattingAction,
  hasActiveFormatting,
  mapHexToHighlightName,
} from './toolbarUtils';

export default Toolbar;
