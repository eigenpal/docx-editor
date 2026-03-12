/**
 * FormattingBar Component
 *
 * Extracted icon-based formatting toolbar (everything except File/Format/Insert menus).
 * Can be used standalone with props or within EditorToolbar (reads from context).
 */

import React, { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { ColorValue, ParagraphAlignment } from '@eigenpal/docx-core/types/document';
import { resolveColor } from '@eigenpal/docx-core/utils/colorResolver';
import { FontPicker } from './ui/FontPicker';
import { FontSizePicker, halfPointsToPoints } from './ui/FontSizePicker';
import { AdvancedColorPicker } from './ui/AdvancedColorPicker';
import { AlignmentButtons } from './ui/AlignmentButtons';
import { ListButtons, createDefaultListState } from './ui/ListButtons';
import { LineSpacingPicker } from './ui/LineSpacingPicker';
import { StylePicker } from './ui/StylePicker';
import { MaterialSymbol } from './ui/MaterialSymbol';
import { ZoomControl } from './ui/ZoomControl';
import { TableBorderPicker } from './ui/TableBorderPicker';
import { TableBorderColorPicker } from './ui/TableBorderColorPicker';
import { TableBorderWidthPicker } from './ui/TableBorderWidthPicker';
import { TableCellFillPicker } from './ui/TableCellFillPicker';
import { TableMoreDropdown } from './ui/TableMoreDropdown';
import { ImageWrapDropdown } from './ui/ImageWrapDropdown';
import { ImageTransformDropdown } from './ui/ImageTransformDropdown';
import type { TableAction } from './ui/TableToolbar';
import { cn } from '../lib/utils';
import { ToolbarButton, ToolbarGroup } from './Toolbar';
import type { ToolbarProps, FormattingAction } from './Toolbar';
import { EditorToolbarContext } from './EditorToolbarContext';

const ICON_SIZE = 18;

export interface FormattingBarProps extends ToolbarProps {
  /** Custom toolbar items to render at the end */
  children?: ReactNode;
  /** When true, renders with display:contents so children flow in parent flex container */
  inline?: boolean;
}

/**
 * Resolves props: if explicit props are provided, use them; otherwise fall back to context.
 */
function useFormattingBarProps(props: FormattingBarProps): FormattingBarProps {
  const ctx = React.useContext(EditorToolbarContext);

  // If we have context, merge: explicit props override context
  if (ctx) {
    return { ...ctx, ...stripUndefined(props) };
  }
  return props;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Icon-based formatting toolbar — undo/redo, zoom, styles, fonts,
 * bold/italic/underline, colors, alignment, lists, table/image context, clear formatting.
 */
export function FormattingBar(explicitProps: FormattingBarProps) {
  const props = useFormattingBarProps(explicitProps);
  const {
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
    showZoomControl = true,
    zoom,
    onZoomChange,
    onRefocusEditor,
    imageContext,
    onImageWrapType,
    onImageTransform,
    onOpenImageProperties,
    tableContext,
    onTableAction,
    inline = false,
  } = props as FormattingBarProps;

  const barRef = useRef<HTMLDivElement>(null);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleFormat = useCallback(
    (action: FormattingAction) => {
      if (!disabled && onFormat) {
        onFormat(action);
      }
    },
    [disabled, onFormat]
  );

  const handleUndo = useCallback(() => {
    if (!disabled && canUndo && onUndo) {
      onUndo();
    }
  }, [disabled, canUndo, onUndo]);

  const handleRedo = useCallback(() => {
    if (!disabled && canRedo && onRedo) {
      onRedo();
    }
  }, [disabled, canRedo, onRedo]);

  const handleFontFamilyChange = useCallback(
    (fontFamily: string) => {
      if (!disabled && onFormat) {
        onFormat({ type: 'fontFamily', value: fontFamily });
        requestAnimationFrame(() => onRefocusEditor?.());
      }
    },
    [disabled, onFormat, onRefocusEditor]
  );

  const handleFontSizeChange = useCallback(
    (sizeInPoints: number) => {
      if (!disabled && onFormat) {
        onFormat({ type: 'fontSize', value: sizeInPoints });
        requestAnimationFrame(() => onRefocusEditor?.());
      }
    },
    [disabled, onFormat, onRefocusEditor]
  );

  const handleTextColorChange = useCallback(
    (color: ColorValue | string) => {
      if (!disabled && onFormat) {
        onFormat({ type: 'textColor', value: color });
        requestAnimationFrame(() => onRefocusEditor?.());
      }
    },
    [disabled, onFormat, onRefocusEditor]
  );

  const handleHighlightColorChange = useCallback(
    (color: ColorValue | string) => {
      if (!disabled && onFormat) {
        const highlightValue = typeof color === 'string' ? color : '';
        onFormat({ type: 'highlightColor', value: highlightValue });
        requestAnimationFrame(() => onRefocusEditor?.());
      }
    },
    [disabled, onFormat, onRefocusEditor]
  );

  const handleAlignmentChange = useCallback(
    (alignment: ParagraphAlignment) => {
      if (!disabled && onFormat) {
        onFormat({ type: 'alignment', value: alignment });
      }
    },
    [disabled, onFormat]
  );

  const handleBulletList = useCallback(() => {
    if (!disabled && onFormat) {
      onFormat('bulletList');
    }
  }, [disabled, onFormat]);

  const handleNumberedList = useCallback(() => {
    if (!disabled && onFormat) {
      onFormat('numberedList');
    }
  }, [disabled, onFormat]);

  const handleIndent = useCallback(() => {
    if (!disabled && onFormat) {
      onFormat('indent');
    }
  }, [disabled, onFormat]);

  const handleOutdent = useCallback(() => {
    if (!disabled && onFormat) {
      onFormat('outdent');
    }
  }, [disabled, onFormat]);

  const handleLineSpacingChange = useCallback(
    (twipsValue: number) => {
      if (!disabled && onFormat) {
        onFormat({ type: 'lineSpacing', value: twipsValue });
        requestAnimationFrame(() => onRefocusEditor?.());
      }
    },
    [disabled, onFormat, onRefocusEditor]
  );

  const handleStyleChange = useCallback(
    (styleId: string) => {
      if (!disabled && onFormat) {
        onFormat({ type: 'applyStyle', value: styleId });
        requestAnimationFrame(() => onRefocusEditor?.());
      }
    },
    [disabled, onFormat, onRefocusEditor]
  );

  const handleTableAction = useCallback(
    (action: TableAction) => {
      if (!disabled && onTableAction) {
        onTableAction(action);
        requestAnimationFrame(() => onRefocusEditor?.());
      }
    },
    [disabled, onTableAction, onRefocusEditor]
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────

  useEffect(() => {
    if (!enableShortcuts) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editorContainer = editorRef?.current;
      const barContainer = barRef.current;

      const isInEditor = editorContainer?.contains(target);
      const isInBar = barContainer?.contains(target);

      if (!isInEditor && !isInBar) return;

      const isCtrl = event.ctrlKey || event.metaKey;

      if (isCtrl && !event.altKey) {
        switch (event.key.toLowerCase()) {
          case 'b':
            event.preventDefault();
            handleFormat('bold');
            break;
          case 'i':
            event.preventDefault();
            handleFormat('italic');
            break;
          case 'u':
            event.preventDefault();
            handleFormat('underline');
            break;
          case '=':
            if (event.shiftKey) {
              event.preventDefault();
              handleFormat('superscript');
            } else {
              event.preventDefault();
              handleFormat('subscript');
            }
            break;
          case 'l':
            event.preventDefault();
            handleAlignmentChange('left');
            break;
          case 'e':
            event.preventDefault();
            handleAlignmentChange('center');
            break;
          case 'r':
            event.preventDefault();
            handleAlignmentChange('right');
            break;
          case 'j':
            event.preventDefault();
            handleAlignmentChange('both');
            break;
          case 'k':
            event.preventDefault();
            handleFormat('insertLink');
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enableShortcuts, handleFormat, handleAlignmentChange, editorRef]);

  // ── Focus management ──────────────────────────────────────────────────

  const handleBarMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isInteractive =
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'OPTION';

    if (!isInteractive) {
      e.preventDefault();
    }
  }, []);

  const handleBarMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const activeEl = document.activeElement as HTMLElement;
      const isSelectActive =
        target.tagName === 'SELECT' ||
        target.tagName === 'OPTION' ||
        activeEl?.tagName === 'SELECT';

      if (isSelectActive) return;

      requestAnimationFrame(() => {
        onRefocusEditor?.();
      });
    },
    [onRefocusEditor]
  );

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div
      ref={barRef}
      className={cn(
        !inline &&
          'flex items-center px-2 py-1 bg-[#f6f6f6] rounded-full min-h-[36px] overflow-x-auto mx-2 mb-1',
        className
      )}
      style={inline ? { display: 'contents', ...style } : style}
      role={inline ? undefined : 'toolbar'}
      aria-label={inline ? undefined : 'Formatting toolbar'}
      data-testid={inline ? undefined : 'formatting-bar'}
      onMouseDown={inline ? undefined : handleBarMouseDown}
      onMouseUp={inline ? undefined : handleBarMouseUp}
    >
      {/* Undo/Redo Group */}
      <ToolbarGroup label="History">
        <ToolbarButton
          onClick={handleUndo}
          disabled={disabled || !canUndo}
          title="Undo (Ctrl+Z)"
          ariaLabel="Undo"
        >
          <MaterialSymbol name="undo" size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          onClick={handleRedo}
          disabled={disabled || !canRedo}
          title="Redo (Ctrl+Y)"
          ariaLabel="Redo"
        >
          <MaterialSymbol name="redo" size={ICON_SIZE} />
        </ToolbarButton>
      </ToolbarGroup>

      {/* Zoom Control */}
      {showZoomControl && (
        <ToolbarGroup label="Zoom">
          <ZoomControl
            value={zoom}
            onChange={onZoomChange}
            minZoom={0.5}
            maxZoom={2}
            disabled={disabled}
            compact
            showButtons={false}
          />
        </ToolbarGroup>
      )}

      {/* Style Picker */}
      {showStylePicker && (
        <ToolbarGroup label="Styles">
          <StylePicker
            value={currentFormatting.styleId || 'Normal'}
            onChange={handleStyleChange}
            styles={documentStyles}
            theme={theme}
            disabled={disabled}
            width={120}
          />
        </ToolbarGroup>
      )}

      {/* Font Family and Size Pickers */}
      {(showFontPicker || showFontSizePicker) && (
        <ToolbarGroup label="Font">
          {showFontPicker && (
            <FontPicker
              value={currentFormatting.fontFamily || 'Arial'}
              onChange={handleFontFamilyChange}
              disabled={disabled}
              width={60}
              placeholder="Arial"
            />
          )}
          {showFontSizePicker && (
            <FontSizePicker
              value={
                currentFormatting.fontSize !== undefined
                  ? halfPointsToPoints(currentFormatting.fontSize)
                  : 11
              }
              onChange={handleFontSizeChange}
              disabled={disabled}
              width={42}
              placeholder="11"
            />
          )}
        </ToolbarGroup>
      )}

      {/* Text Formatting Group */}
      <ToolbarGroup label="Text formatting">
        <ToolbarButton
          onClick={() => handleFormat('bold')}
          active={currentFormatting.bold}
          disabled={disabled}
          title="Bold (Ctrl+B)"
          ariaLabel="Bold"
        >
          <MaterialSymbol name="format_bold" size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => handleFormat('italic')}
          active={currentFormatting.italic}
          disabled={disabled}
          title="Italic (Ctrl+I)"
          ariaLabel="Italic"
        >
          <MaterialSymbol name="format_italic" size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => handleFormat('underline')}
          active={currentFormatting.underline}
          disabled={disabled}
          title="Underline (Ctrl+U)"
          ariaLabel="Underline"
        >
          <MaterialSymbol name="format_underlined" size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => handleFormat('strikethrough')}
          active={currentFormatting.strike}
          disabled={disabled}
          title="Strikethrough"
          ariaLabel="Strikethrough"
        >
          <MaterialSymbol name="strikethrough_s" size={ICON_SIZE} />
        </ToolbarButton>
        {showTextColorPicker && (
          <AdvancedColorPicker
            mode="text"
            value={currentFormatting.color?.replace(/^#/, '')}
            onChange={handleTextColorChange}
            theme={theme}
            disabled={disabled}
            title="Font Color"
          />
        )}
        {showHighlightColorPicker && (
          <AdvancedColorPicker
            mode="highlight"
            value={currentFormatting.highlight}
            onChange={handleHighlightColorChange}
            theme={theme}
            disabled={disabled}
            title="Text Highlight Color"
          />
        )}
        <ToolbarButton
          onClick={() => handleFormat('insertLink')}
          disabled={disabled}
          title="Insert link (Ctrl+K)"
          ariaLabel="Insert link"
        >
          <MaterialSymbol name="link" size={ICON_SIZE} />
        </ToolbarButton>
      </ToolbarGroup>

      {/* Superscript/Subscript Group */}
      <ToolbarGroup label="Script">
        <ToolbarButton
          onClick={() => handleFormat('superscript')}
          active={currentFormatting.superscript}
          disabled={disabled}
          title="Superscript (Ctrl+Shift+=)"
          ariaLabel="Superscript"
        >
          <MaterialSymbol name="superscript" size={ICON_SIZE} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => handleFormat('subscript')}
          active={currentFormatting.subscript}
          disabled={disabled}
          title="Subscript (Ctrl+=)"
          ariaLabel="Subscript"
        >
          <MaterialSymbol name="subscript" size={ICON_SIZE} />
        </ToolbarButton>
      </ToolbarGroup>

      {/* Alignment Dropdown */}
      {showAlignmentButtons && (
        <ToolbarGroup label="Alignment">
          <AlignmentButtons
            value={currentFormatting.alignment || 'left'}
            onChange={handleAlignmentChange}
            disabled={disabled}
          />
        </ToolbarGroup>
      )}

      {/* List Buttons and Line Spacing */}
      {(showListButtons || showLineSpacingPicker) && (
        <ToolbarGroup label="List formatting">
          {showListButtons && (
            <ListButtons
              listState={currentFormatting.listState || createDefaultListState()}
              onBulletList={handleBulletList}
              onNumberedList={handleNumberedList}
              onIndent={handleIndent}
              onOutdent={handleOutdent}
              disabled={disabled}
              showIndentButtons={true}
              compact
              hasIndent={(currentFormatting.indentLeft ?? 0) > 0}
            />
          )}
          {showLineSpacingPicker && (
            <LineSpacingPicker
              value={currentFormatting.lineSpacing}
              onChange={handleLineSpacingChange}
              disabled={disabled}
            />
          )}
        </ToolbarGroup>
      )}

      {/* Image controls - shown when image is selected */}
      {imageContext && onImageWrapType && (
        <ToolbarGroup label="Image">
          <ImageWrapDropdown
            imageContext={imageContext}
            onChange={onImageWrapType}
            disabled={disabled}
          />
          {onImageTransform && (
            <ImageTransformDropdown onTransform={onImageTransform} disabled={disabled} />
          )}
          {onOpenImageProperties && (
            <ToolbarButton
              onClick={onOpenImageProperties}
              disabled={disabled}
              title="Image properties (alt text, border)..."
              ariaLabel="Image properties"
            >
              <MaterialSymbol name="tune" size={ICON_SIZE} />
            </ToolbarButton>
          )}
        </ToolbarGroup>
      )}

      {/* Table Options - shown when cursor is in a table */}
      {tableContext?.isInTable && onTableAction && (
        <ToolbarGroup label="Table">
          <TableBorderPicker onAction={handleTableAction} disabled={disabled} />
          <TableBorderColorPicker
            onAction={handleTableAction}
            disabled={disabled}
            theme={theme}
            value={
              tableContext?.cellBorderColor
                ? resolveColor(tableContext.cellBorderColor, theme).replace(/^#/, '')
                : undefined
            }
          />
          <TableBorderWidthPicker onAction={handleTableAction} disabled={disabled} />
          <TableCellFillPicker
            onAction={handleTableAction}
            disabled={disabled}
            theme={theme}
            value={tableContext?.cellBackgroundColor}
          />
          <TableMoreDropdown
            onAction={handleTableAction}
            disabled={disabled}
            tableContext={tableContext}
          />
        </ToolbarGroup>
      )}

      {/* Clear Formatting */}
      <ToolbarButton
        onClick={() => handleFormat('clearFormatting')}
        disabled={disabled}
        title="Clear formatting"
        ariaLabel="Clear formatting"
      >
        <MaterialSymbol name="format_clear" size={ICON_SIZE} />
      </ToolbarButton>

      {/* Custom toolbar items */}
      {children}
    </div>
  );
}
