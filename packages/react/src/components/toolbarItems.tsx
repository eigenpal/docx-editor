import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ColorValue,
  ParagraphAlignment,
  Style,
  Theme,
} from '@eigenpal/docx-core/types/document';
import { resolveColor } from '@eigenpal/docx-core/utils/colorResolver';
import type { TableContextInfo } from '@eigenpal/docx-core/prosemirror';

import type { FormattingAction, SelectionFormatting } from './toolbarTypes';
import type { EditorMode } from './ui/EditingModeDropdown';
import type { TableAction } from './ui/TableToolbar';
import { FontPicker } from './ui/FontPicker';
import { FontSizePicker, halfPointsToPoints } from './ui/FontSizePicker';
import { AdvancedColorPicker } from './ui/AdvancedColorPicker';
import { AlignmentButtons } from './ui/AlignmentButtons';
import { ListButtons, createDefaultListState } from './ui/ListButtons';
import { LineSpacingPicker } from './ui/LineSpacingPicker';
import { StylePicker } from './ui/StylePicker';
import { TableGridInline } from './ui/TableGridInline';
import { TableGridPicker } from './ui/TableGridPicker';
import { TableBorderPicker } from './ui/TableBorderPicker';
import { TableBorderColorPicker } from './ui/TableBorderColorPicker';
import { TableBorderWidthPicker } from './ui/TableBorderWidthPicker';
import { TableCellFillPicker } from './ui/TableCellFillPicker';
import { TableStyleGallery } from './ui/TableStyleGallery';
import { TableMoreDropdown } from './ui/TableMoreDropdown';
import { ImageWrapDropdown } from './ui/ImageWrapDropdown';
import { ImageTransformDropdown } from './ui/ImageTransformDropdown';
import { ZoomControl } from './ui/ZoomControl';
import { MenuDropdown, type MenuEntry } from './ui/MenuDropdown';
import { EditingModeDropdown } from './ui/EditingModeDropdown';
import { MaterialSymbol } from './ui/MaterialSymbol';
import { ribbonConfig, type RibbonComponentId, type RibbonItemSize } from './Ribbon/ribbonConfig';
import { ribbonActions, type RibbonActionContext } from './Ribbon/ribbonActions';

const ICON_SIZE = 20;

export type CompactButtonItem = {
  kind: 'button';
  id: string;
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
};

export type CompactComponentItem = {
  kind: 'component';
  id: string;
  node: ReactNode;
};

export type CompactGroupEntry = {
  kind: 'group';
  id: string;
  label?: string;
  items: Array<CompactButtonItem | CompactComponentItem>;
};

export type CompactStandaloneEntry = CompactComponentItem | CompactButtonItem;

export type CompactEntry = CompactGroupEntry | CompactStandaloneEntry;

export type RibbonButtonItem = {
  kind: 'button';
  id: string;
  label: string;
  icon?: string;
  onClick?: () => void;
  isActive?: boolean;
  disabled?: boolean;
  showLabel?: boolean;
  size?: RibbonItemSize;
};

export type RibbonComponentItem = {
  kind: 'component';
  id: string;
  component: RibbonComponentId;
  size?: RibbonItemSize;
};

export type RibbonItemModel = RibbonButtonItem | RibbonComponentItem;

export type RibbonGroupModel = {
  id: string;
  label: string;
  items: RibbonItemModel[];
};

export type RibbonTabModel = {
  id: string;
  label: string;
  groups: RibbonGroupModel[];
};

export type ToolbarItemActions = {
  format: (action: FormattingAction) => void;
  align: (alignment: ParagraphAlignment) => void;
};

type TableContextLike = {
  isInTable: boolean;
  rowCount?: number;
  columnCount?: number;
  canSplitCell?: boolean;
  hasMultiCellSelection?: boolean;
  cellBorderColor?: ColorValue;
  cellBackgroundColor?: string;
  table?: {
    attrs?: {
      justification?: string;
      styleId?: string;
    };
  };
} | null;

export interface UseToolbarItemsOptions {
  currentFormatting?: SelectionFormatting;
  documentStyles?: Style[];
  theme?: Theme | null;
  disabled?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  readOnly?: boolean;
  onFormat?: (action: FormattingAction) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onFind?: () => void;
  onReplace?: () => void;
  onInsertTable?: (rows: number, columns: number) => void;
  onInsertImage?: () => void;
  onInsertPageBreak?: () => void;
  onPageSetup?: () => void;
  onInsertTOC?: () => void;
  onToggleCommentsSidebar?: () => void;
  editingMode?: EditorMode;
  onSetEditingMode?: (mode: EditorMode) => void;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  onToggleOutline?: () => void;
  tableContext?: TableContextInfo | TableContextLike;
  onTableAction?: (action: TableAction) => void;
  imageContext?: {
    wrapType: string;
    displayMode: string;
    cssFloat: string | null;
  } | null;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onToggleLocalClipboard?: () => void;
  localClipboardEnabled?: boolean;
  onToggleShowMarks?: () => void;
  showMarksEnabled?: boolean;
  onToggleParagraphBorder?: () => void;
  showRulerEnabled?: boolean;
  onToggleRuler?: () => void;
  onZoomPageWidth?: () => void;
  onZoomOnePage?: () => void;
  layoutMode?: 'print' | 'web';
  onSetLayoutMode?: (mode: 'print' | 'web') => void;
  onOpenHeaderFooter?: (position: 'header' | 'footer') => void;
  onCloseHeaderFooter?: () => void;
  hfEditPosition?: 'header' | 'footer' | null;
  onOpenImageProperties?: () => void;
  onRefocusEditor?: () => void;
  showFontPicker?: boolean;
  showFontSizePicker?: boolean;
  showTextColorPicker?: boolean;
  showHighlightColorPicker?: boolean;
  showAlignmentButtons?: boolean;
  showListButtons?: boolean;
  showLineSpacingPicker?: boolean;
  showStylePicker?: boolean;
  showPrintButton?: boolean;
  showZoomControl?: boolean;
  showTableInsert?: boolean;
  onPrint?: () => void;
  onImageWrapType?: (wrapType: string) => void;
  onImageTransform?: (action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV') => void;
}

export function useToolbarItems(options: UseToolbarItemsOptions): {
  compact: CompactEntry[];
  ribbon: RibbonTabModel[];
  actions: ToolbarItemActions;
  renderRibbonComponent: (componentId: RibbonComponentId, key: string) => ReactNode | null;
} {
  const {
    currentFormatting = {},
    documentStyles,
    theme,
    disabled = false,
    canUndo = false,
    canRedo = false,
    readOnly = false,
    onFormat,
    onUndo,
    onRedo,
    onFind,
    onReplace,
    onInsertTable,
    onInsertImage,
    onInsertPageBreak,
    onPageSetup,
    onInsertTOC,
    onToggleCommentsSidebar,
    editingMode,
    onSetEditingMode,
    zoom,
    onZoomChange,
    onToggleOutline,
    tableContext,
    onTableAction,
    imageContext,
    onCopy,
    onCut,
    onPaste,
    onToggleLocalClipboard,
    localClipboardEnabled = false,
    onToggleShowMarks,
    showMarksEnabled = false,
    onToggleParagraphBorder,
    showRulerEnabled,
    onToggleRuler,
    onZoomPageWidth,
    onZoomOnePage,
    layoutMode = 'print',
    onSetLayoutMode,
    onOpenHeaderFooter,
    onCloseHeaderFooter,
    hfEditPosition,
    onOpenImageProperties,
    onRefocusEditor,
    showFontPicker = true,
    showFontSizePicker = true,
    showTextColorPicker = true,
    showHighlightColorPicker = true,
    showAlignmentButtons = true,
    showListButtons = true,
    showLineSpacingPicker = true,
    showStylePicker = true,
    showPrintButton = true,
    showZoomControl = true,
    showTableInsert = true,
    onPrint,
    onImageWrapType,
    onImageTransform,
  } = options;

  const isReadOnly = readOnly || editingMode === 'viewing';
  const [formattingOverrides, setFormattingOverrides] = useState<
    Pick<
      SelectionFormatting,
      'bold' | 'italic' | 'underline' | 'strike' | 'superscript' | 'subscript'
    >
  >({});

  useEffect(() => {
    setFormattingOverrides({
      bold: currentFormatting.bold,
      italic: currentFormatting.italic,
      underline: currentFormatting.underline,
      strike: currentFormatting.strike,
      superscript: currentFormatting.superscript,
      subscript: currentFormatting.subscript,
    });
  }, [
    currentFormatting.bold,
    currentFormatting.italic,
    currentFormatting.underline,
    currentFormatting.strike,
    currentFormatting.superscript,
    currentFormatting.subscript,
  ]);

  const refocusEditor = useCallback(() => {
    if (!onRefocusEditor) return;
    requestAnimationFrame(() => onRefocusEditor());
  }, [onRefocusEditor]);

  const formatAction = useCallback(
    (action: FormattingAction) => {
      if (disabled || !onFormat) return;
      if (typeof action === 'string') {
        setFormattingOverrides((prev) => {
          switch (action) {
            case 'bold':
              return { ...prev, bold: !prev.bold };
            case 'italic':
              return { ...prev, italic: !prev.italic };
            case 'underline':
              return { ...prev, underline: !prev.underline };
            case 'strikethrough':
              return { ...prev, strike: !prev.strike };
            case 'superscript': {
              const next = !prev.superscript;
              return { ...prev, superscript: next, subscript: next ? false : prev.subscript };
            }
            case 'subscript': {
              const next = !prev.subscript;
              return { ...prev, subscript: next, superscript: next ? false : prev.superscript };
            }
            case 'clearFormatting':
              return {
                ...prev,
                bold: false,
                italic: false,
                underline: false,
                strike: false,
                superscript: false,
                subscript: false,
              };
            default:
              return prev;
          }
        });
      }
      onFormat(action);
    },
    [disabled, onFormat]
  );

  const alignmentAction = useCallback(
    (alignment: ParagraphAlignment) => {
      if (disabled || !onFormat) return;
      onFormat({ type: 'alignment', value: alignment });
    },
    [disabled, onFormat]
  );

  const fontFamilyChange = useCallback(
    (fontFamily: string) => {
      if (disabled || !onFormat) return;
      onFormat({ type: 'fontFamily', value: fontFamily });
      refocusEditor();
    },
    [disabled, onFormat, refocusEditor]
  );

  const fontSizeChange = useCallback(
    (sizeInPoints: number) => {
      if (disabled || !onFormat) return;
      onFormat({ type: 'fontSize', value: sizeInPoints });
      refocusEditor();
    },
    [disabled, onFormat, refocusEditor]
  );

  const textColorChange = useCallback(
    (color: ColorValue | string) => {
      if (disabled || !onFormat) return;
      onFormat({ type: 'textColor', value: color });
      refocusEditor();
    },
    [disabled, onFormat, refocusEditor]
  );

  const highlightColorChange = useCallback(
    (color: ColorValue | string) => {
      if (disabled || !onFormat) return;
      const highlightValue = typeof color === 'string' ? color : '';
      onFormat({ type: 'highlightColor', value: highlightValue });
      refocusEditor();
    },
    [disabled, onFormat, refocusEditor]
  );

  const lineSpacingChange = useCallback(
    (twipsValue: number) => {
      if (disabled || !onFormat) return;
      onFormat({ type: 'lineSpacing', value: twipsValue });
      refocusEditor();
    },
    [disabled, onFormat, refocusEditor]
  );

  const styleChange = useCallback(
    (styleId: string) => {
      if (disabled || !onFormat) return;
      onFormat({ type: 'applyStyle', value: styleId });
      refocusEditor();
    },
    [disabled, onFormat, refocusEditor]
  );

  const tableInsert = useCallback(
    (rows: number, columns: number) => {
      if (disabled || !onInsertTable) return;
      onInsertTable(rows, columns);
      refocusEditor();
    },
    [disabled, onInsertTable, refocusEditor]
  );

  const tableAction = useCallback(
    (action: TableAction) => {
      if (disabled || !onTableAction) return;
      onTableAction(action);
      refocusEditor();
    },
    [disabled, onTableAction, refocusEditor]
  );

  const compactButton = (
    id: string,
    label: string,
    icon: ReactNode,
    options?: {
      onClick?: () => void;
      isActive?: boolean;
      disabled?: boolean;
      title?: string;
      ariaLabel?: string;
    }
  ): CompactButtonItem => ({
    kind: 'button',
    id,
    label,
    icon,
    onClick: options?.onClick,
    isActive: options?.isActive,
    disabled: options?.disabled,
    title: options?.title,
    ariaLabel: options?.ariaLabel,
  });

  const compactComponent = (id: string, node: ReactNode): CompactComponentItem => ({
    kind: 'component',
    id,
    node,
  });

  const compactEntries: CompactEntry[] = [];

  if ((showPrintButton && onPrint) || onPageSetup) {
    compactEntries.push(
      compactComponent(
        'fileMenu',
        <MenuDropdown
          label="File"
          disabled={disabled}
          items={[
            ...(showPrintButton && onPrint
              ? [{ icon: 'print', label: 'Print', shortcut: 'Ctrl+P', onClick: onPrint } as MenuEntry]
              : []),
            ...(onPageSetup
              ? [{ icon: 'settings', label: 'Page setup', onClick: onPageSetup } as MenuEntry]
              : []),
          ]}
        />
      )
    );
  }

  compactEntries.push(
    compactComponent(
      'formatMenu',
      <MenuDropdown
        label="Format"
        disabled={disabled}
        items={[
          {
            icon: 'format_textdirection_l_to_r',
            label: 'Left-to-right text',
            onClick: () => formatAction('setLtr'),
            disabled: disabled || !onFormat,
          },
          {
            icon: 'format_textdirection_r_to_l',
            label: 'Right-to-left text',
            onClick: () => formatAction('setRtl'),
            disabled: disabled || !onFormat,
          },
        ]}
      />
    )
  );

  const insertMenuItems: MenuEntry[] = [
    ...(onInsertImage
      ? [{ icon: 'image', label: 'Image', onClick: onInsertImage } as MenuEntry]
      : []),
    ...(showTableInsert && onInsertTable
      ? [
          {
            icon: 'grid_on',
            label: 'Table',
            submenuContent: (closeMenu: () => void) => (
              <TableGridInline
                onInsert={(rows: number, cols: number) => {
                  tableInsert(rows, cols);
                  closeMenu();
                }}
              />
            ),
          } as MenuEntry,
        ]
      : []),
    ...(onInsertImage || (showTableInsert && onInsertTable)
      ? [{ type: 'separator' as const } as MenuEntry]
      : []),
    {
      icon: 'page_break',
      label: 'Page break',
      onClick: onInsertPageBreak,
      disabled: !onInsertPageBreak,
    },
    {
      icon: 'format_list_numbered',
      label: 'Table of contents',
      onClick: onInsertTOC,
      disabled: !onInsertTOC,
    },
  ];

  compactEntries.push(
    compactComponent(
      'insertMenu',
      <MenuDropdown label="Insert" disabled={disabled} items={insertMenuItems} />
    )
  );

  compactEntries.push({
    kind: 'group',
    id: 'history',
    label: 'History',
    items: [
      compactButton('undo', 'Undo', <MaterialSymbol name="undo" size={ICON_SIZE} />, {
        onClick: () => {
          if (!disabled && canUndo) onUndo?.();
        },
        disabled: disabled || !canUndo,
        title: 'Undo (Ctrl+Z)',
        ariaLabel: 'Undo',
      }),
      compactButton('redo', 'Redo', <MaterialSymbol name="redo" size={ICON_SIZE} />, {
        onClick: () => {
          if (!disabled && canRedo) onRedo?.();
        },
        disabled: disabled || !canRedo,
        title: 'Redo (Ctrl+Y)',
        ariaLabel: 'Redo',
      }),
    ],
  });

  if (showZoomControl) {
    compactEntries.push({
      kind: 'group',
      id: 'zoom',
      label: 'Zoom',
      items: [
        compactComponent(
          'zoomControl',
          <ZoomControl
            value={zoom}
            onChange={onZoomChange}
            minZoom={0.5}
            maxZoom={2}
            disabled={disabled}
            compact
            showButtons={false}
          />
        ),
      ],
    });
  }

  if (showStylePicker) {
    compactEntries.push({
      kind: 'group',
      id: 'styles',
      label: 'Styles',
      items: [
        compactComponent(
          'stylePicker',
          <StylePicker
            value={currentFormatting.styleId || 'Normal'}
            onChange={styleChange}
            styles={documentStyles}
            theme={theme}
            disabled={disabled}
            width={150}
          />
        ),
      ],
    });
  }

  if (showFontPicker || showFontSizePicker) {
    const fontItems: Array<CompactButtonItem | CompactComponentItem> = [];
    if (showFontPicker) {
      fontItems.push(
        compactComponent(
          'fontFamily',
          <FontPicker
            value={currentFormatting.fontFamily || 'Arial'}
            onChange={fontFamilyChange}
            disabled={disabled}
            width={70}
            placeholder="Arial"
          />
        )
      );
    }
    if (showFontSizePicker) {
      fontItems.push(
        compactComponent(
          'fontSize',
          <FontSizePicker
            value={
              currentFormatting.fontSize !== undefined
                ? halfPointsToPoints(currentFormatting.fontSize)
                : 11
            }
            onChange={fontSizeChange}
            disabled={disabled}
            width={50}
            placeholder="11"
          />
        )
      );
    }
    compactEntries.push({
      kind: 'group',
      id: 'font',
      label: 'Font',
      items: fontItems,
    });
  }

  const textItems: Array<CompactButtonItem | CompactComponentItem> = [
    compactButton('bold', 'Bold', <MaterialSymbol name="format_bold" size={ICON_SIZE} />, {
      onClick: () => formatAction('bold'),
      isActive: currentFormatting.bold,
      disabled,
      title: 'Bold (Ctrl+B)',
      ariaLabel: 'Bold',
    }),
    compactButton('italic', 'Italic', <MaterialSymbol name="format_italic" size={ICON_SIZE} />, {
      onClick: () => formatAction('italic'),
      isActive: currentFormatting.italic,
      disabled,
      title: 'Italic (Ctrl+I)',
      ariaLabel: 'Italic',
    }),
    compactButton(
      'underline',
      'Underline',
      <MaterialSymbol name="format_underlined" size={ICON_SIZE} />,
      {
        onClick: () => formatAction('underline'),
        isActive: currentFormatting.underline,
        disabled,
        title: 'Underline (Ctrl+U)',
        ariaLabel: 'Underline',
      }
    ),
    compactButton(
      'strikethrough',
      'Strikethrough',
      <MaterialSymbol name="strikethrough_s" size={ICON_SIZE} />,
      {
        onClick: () => formatAction('strikethrough'),
        isActive: currentFormatting.strike,
        disabled,
        title: 'Strikethrough',
        ariaLabel: 'Strikethrough',
      }
    ),
  ];

  if (showTextColorPicker) {
    textItems.push(
      compactComponent(
        'textColor',
        <AdvancedColorPicker
          mode="text"
          value={currentFormatting.color?.replace(/^#/, '')}
          onChange={textColorChange}
          theme={theme}
          disabled={disabled}
          title="Font Color"
        />
      )
    );
  }

  if (showHighlightColorPicker) {
    textItems.push(
      compactComponent(
        'highlightColor',
        <AdvancedColorPicker
          mode="highlight"
          value={currentFormatting.highlight}
          onChange={highlightColorChange}
          theme={theme}
          disabled={disabled}
          title="Text Highlight Color"
        />
      )
    );
  }

  textItems.push(
    compactButton('insertLink', 'Insert link', <MaterialSymbol name="link" size={ICON_SIZE} />, {
      onClick: () => formatAction('insertLink'),
      disabled,
      title: 'Insert link (Ctrl+K)',
      ariaLabel: 'Insert link',
    })
  );

  compactEntries.push({
    kind: 'group',
    id: 'textFormatting',
    label: 'Text formatting',
    items: textItems,
  });

  compactEntries.push({
    kind: 'group',
    id: 'script',
    label: 'Script',
    items: [
      compactButton(
        'superscript',
        'Superscript',
        <MaterialSymbol name="superscript" size={ICON_SIZE} />,
        {
          onClick: () => formatAction('superscript'),
          isActive: currentFormatting.superscript,
          disabled,
          title: 'Superscript (Ctrl+Shift+=)',
          ariaLabel: 'Superscript',
        }
      ),
      compactButton(
        'subscript',
        'Subscript',
        <MaterialSymbol name="subscript" size={ICON_SIZE} />,
        {
          onClick: () => formatAction('subscript'),
          isActive: currentFormatting.subscript,
          disabled,
          title: 'Subscript (Ctrl+=)',
          ariaLabel: 'Subscript',
        }
      ),
    ],
  });

  if (showAlignmentButtons) {
    compactEntries.push(
      compactComponent(
        'alignmentButtons',
        <AlignmentButtons
          value={currentFormatting.alignment || 'left'}
          onChange={alignmentAction}
          disabled={disabled}
        />
      )
    );
  }

  if (showListButtons || showLineSpacingPicker) {
    const listItems: Array<CompactButtonItem | CompactComponentItem> = [];
    if (showListButtons) {
      listItems.push(
        compactComponent(
          'listButtons',
          <ListButtons
            listState={currentFormatting.listState || createDefaultListState()}
            onBulletList={() => formatAction('bulletList')}
            onNumberedList={() => formatAction('numberedList')}
            onIndent={() => formatAction('indent')}
            onOutdent={() => formatAction('outdent')}
            disabled={disabled}
            showIndentButtons
            compact
            hasIndent={(currentFormatting.indentLeft ?? 0) > 0}
          />
        )
      );
    }
    if (showLineSpacingPicker) {
      listItems.push(
        compactComponent(
          'lineSpacing',
          <LineSpacingPicker
            value={currentFormatting.lineSpacing}
            onChange={lineSpacingChange}
            disabled={disabled}
          />
        )
      );
    }
    compactEntries.push({
      kind: 'group',
      id: 'listFormatting',
      label: 'List formatting',
      items: listItems,
    });
  }

  if (imageContext && onImageWrapType) {
    const imageItems: Array<CompactButtonItem | CompactComponentItem> = [
      compactComponent(
        'imageWrap',
        <ImageWrapDropdown
          imageContext={imageContext}
          onChange={onImageWrapType}
          disabled={disabled}
        />
      ),
    ];
    if (onImageTransform) {
      imageItems.push(
        compactComponent(
          'imageTransform',
          <ImageTransformDropdown onTransform={onImageTransform} disabled={disabled} />
        )
      );
    }
    if (onOpenImageProperties) {
      imageItems.push(
        compactButton(
          'imageProperties',
          'Image properties',
          <MaterialSymbol name="tune" size={ICON_SIZE} />,
          {
            onClick: onOpenImageProperties,
            disabled,
            title: 'Image properties (alt text, border)...',
            ariaLabel: 'Image properties',
          }
        )
      );
    }
    compactEntries.push({
      kind: 'group',
      id: 'image',
      label: 'Image',
      items: imageItems,
    });
  }

  if (tableContext?.isInTable && onTableAction) {
    compactEntries.push({
      kind: 'group',
      id: 'table',
      label: 'Table',
      items: [
        compactComponent(
          'tableBorderPicker',
          <TableBorderPicker onAction={tableAction} disabled={disabled} />
        ),
        compactComponent(
          'tableBorderColor',
          <TableBorderColorPicker
            onAction={tableAction}
            disabled={disabled}
            theme={theme}
            value={
              tableContext?.cellBorderColor
                ? resolveColor(tableContext.cellBorderColor, theme).replace(/^#/, '')
                : undefined
            }
          />
        ),
        compactComponent(
          'tableBorderWidth',
          <TableBorderWidthPicker onAction={tableAction} disabled={disabled} />
        ),
        compactComponent(
          'tableCellFill',
          <TableCellFillPicker
            onAction={tableAction}
            disabled={disabled}
            theme={theme}
            value={tableContext?.cellBackgroundColor}
          />
        ),
        compactComponent(
          'tableMore',
          <TableMoreDropdown
            onAction={tableAction}
            disabled={disabled}
            tableContext={tableContext}
          />
        ),
      ],
    });
  }

  compactEntries.push(
    compactButton(
      'clearFormatting',
      'Clear formatting',
      <MaterialSymbol name="format_clear" size={ICON_SIZE} />,
      {
        onClick: () => formatAction('clearFormatting'),
        disabled,
        title: 'Clear formatting',
        ariaLabel: 'Clear formatting',
      }
    )
  );

  const actionContext: RibbonActionContext = useMemo(
    () => ({
      selectionFormatting: currentFormatting,
      onFormat: formatAction,
      onUndo,
      onRedo,
      onFind,
      onReplace,
      onInsertPageBreak,
      onPageSetup,
      onInsertImage,
      onInsertTOC,
      onToggleComments: onToggleCommentsSidebar,
      editingMode,
      onSetEditingMode,
      zoom,
      onZoomChange,
      onToggleOutline,
      onTableAction,
      onCopy,
      onCut,
      onPaste,
      onToggleLocalClipboard,
      localClipboardEnabled,
      onToggleShowMarks,
      showMarksEnabled,
      onToggleParagraphBorder,
      onToggleRuler,
      onZoomPageWidth,
      onZoomOnePage,
      onSetLayoutMode,
      onOpenHeaderFooter,
      onCloseHeaderFooter,
      onOpenImageProperties,
    }),
    [
      currentFormatting,
      formatAction,
      onUndo,
      onRedo,
      onFind,
      onReplace,
      onInsertPageBreak,
      onPageSetup,
      onInsertImage,
      onInsertTOC,
      onToggleCommentsSidebar,
      editingMode,
      onSetEditingMode,
      zoom,
      onZoomChange,
      onToggleOutline,
      onTableAction,
      onCopy,
      onCut,
      onPaste,
      onToggleLocalClipboard,
      localClipboardEnabled,
      onToggleShowMarks,
      showMarksEnabled,
      onToggleParagraphBorder,
      onToggleRuler,
      onZoomPageWidth,
      onZoomOnePage,
      onSetLayoutMode,
      onOpenHeaderFooter,
      onCloseHeaderFooter,
      onOpenImageProperties,
    ]
  );

  const getActionActive = useCallback(
    (actionId?: string): boolean | undefined => {
      if (!actionId) return undefined;
      switch (actionId) {
        case 'bold':
          return !!(formattingOverrides.bold ?? currentFormatting.bold);
        case 'italic':
          return !!(formattingOverrides.italic ?? currentFormatting.italic);
        case 'underline':
          return !!(formattingOverrides.underline ?? currentFormatting.underline);
        case 'strikethrough':
          return !!(formattingOverrides.strike ?? currentFormatting.strike);
        case 'superscript':
          return !!(formattingOverrides.superscript ?? currentFormatting.superscript);
        case 'subscript':
          return !!(formattingOverrides.subscript ?? currentFormatting.subscript);
        case 'localClipboard':
          return !!localClipboardEnabled;
        case 'showMarks':
          return !!showMarksEnabled;
        case 'showBookmarks':
          return !!showMarksEnabled;
        case 'trackChanges':
          return editingMode === 'suggesting';
        case 'readOnly':
          return editingMode === 'viewing';
        case 'printLayout':
          return layoutMode === 'print';
        case 'webLayout':
          return layoutMode === 'web';
        case 'toggleRuler':
          return !!showRulerEnabled;
        default:
          return undefined;
      }
    },
    [
      currentFormatting.bold,
      currentFormatting.italic,
      currentFormatting.underline,
      currentFormatting.strike,
      currentFormatting.superscript,
      currentFormatting.subscript,
      formattingOverrides.bold,
      formattingOverrides.italic,
      formattingOverrides.underline,
      formattingOverrides.strike,
      formattingOverrides.superscript,
      formattingOverrides.subscript,
      localClipboardEnabled,
      showMarksEnabled,
      editingMode,
      layoutMode,
      showRulerEnabled,
    ]
  );

  const contextFlags = useMemo(
    () => ({
      table: !!tableContext?.isInTable,
      headerFooter: !!hfEditPosition,
      image: !!imageContext,
    }),
    [tableContext?.isInTable, hfEditPosition, imageContext]
  );

  const ribbonTabs: RibbonTabModel[] = useMemo(
    () =>
      ribbonConfig.tabs
        .filter((tab) => !tab.when || contextFlags[tab.when])
        .map((tab) => ({
          id: tab.id,
          label: tab.label,
          groups: tab.groups.map((group) => ({
            id: group.id,
            label: group.label,
            items: group.items.map((item) => {
              if (item.type === 'component') {
                return {
                  kind: 'component',
                  id: item.id,
                  component: item.component,
                  size: item.size,
                };
              }

              const handler = item.actionId ? ribbonActions[item.actionId] : undefined;
              type DirectFormatAction = Extract<FormattingAction, string>;
              const directFormatActions = new Set<DirectFormatAction>([
                'bold',
                'italic',
                'underline',
                'strikethrough',
                'superscript',
                'subscript',
                'clearFormatting',
                'insertLink',
                'bulletList',
                'numberedList',
                'indent',
                'outdent',
              ]);
              const isDirectFormatAction = (actionId?: string): actionId is DirectFormatAction =>
                !!actionId && directFormatActions.has(actionId as DirectFormatAction);
              const actionId = item.actionId;
              let onClick: (() => void) | undefined;
              let hasHandler = false;
              if (isDirectFormatAction(actionId)) {
                onClick = () => formatAction(actionId);
                hasHandler = !!onFormat;
              } else if (handler) {
                onClick = () => handler(actionContext);
                hasHandler = true;
              }
              const isActive = getActionActive(item.actionId);
              const requiresHeaderFooter =
                item.actionId === 'openHeader' ||
                item.actionId === 'openFooter' ||
                item.actionId === 'closeHeaderFooter';
              const hasHeaderFooterHandler =
                item.actionId === 'closeHeaderFooter'
                  ? !!onCloseHeaderFooter
                  : !!onOpenHeaderFooter;
              const disabledItem =
                (isReadOnly && !item.allowInReadOnly) ||
                !hasHandler ||
                (requiresHeaderFooter && !hasHeaderFooterHandler);

              return {
                kind: 'button',
                id: item.id,
                label: item.label,
                icon: item.icon,
                onClick,
                isActive,
                disabled: disabledItem,
                showLabel: item.showLabel,
                size: item.size,
              };
            }),
          })),
        })),
    [
      actionContext,
      contextFlags,
      getActionActive,
      isReadOnly,
      onCloseHeaderFooter,
      onOpenHeaderFooter,
    ]
  );

  const renderRibbonComponent = useCallback(
    (componentId: RibbonComponentId, key: string) => {
      switch (componentId) {
        case 'fontFamily':
          return (
            <FontPicker
              key={key}
              value={currentFormatting.fontFamily || 'Arial'}
              onChange={fontFamilyChange}
              disabled={isReadOnly}
              width={100}
              placeholder="Arial"
            />
          );
        case 'fontSize':
          return (
            <FontSizePicker
              key={key}
              value={
                currentFormatting.fontSize !== undefined
                  ? halfPointsToPoints(currentFormatting.fontSize)
                  : 11
              }
              onChange={fontSizeChange}
              disabled={isReadOnly}
              width={56}
              placeholder="11"
            />
          );
        case 'textColor':
          return (
            <AdvancedColorPicker
              key={key}
              mode="text"
              value={currentFormatting.color?.replace(/^#/, '')}
              onChange={textColorChange}
              theme={theme}
              disabled={isReadOnly}
              title="Font Color"
            />
          );
        case 'highlightColor':
          return (
            <AdvancedColorPicker
              key={key}
              mode="highlight"
              value={currentFormatting.highlight}
              onChange={highlightColorChange}
              theme={theme}
              disabled={isReadOnly}
              title="Text Highlight Color"
            />
          );
        case 'stylePicker':
          return (
            <StylePicker
              key={key}
              value={currentFormatting.styleId || 'Normal'}
              onChange={styleChange}
              styles={documentStyles}
              theme={theme}
              disabled={isReadOnly}
              width={150}
            />
          );
        case 'listButtons':
          return (
            <ListButtons
              key={key}
              listState={currentFormatting.listState || createDefaultListState()}
              onBulletList={() => formatAction('bulletList')}
              onNumberedList={() => formatAction('numberedList')}
              onIndent={() => formatAction('indent')}
              onOutdent={() => formatAction('outdent')}
              disabled={isReadOnly}
              showIndentButtons
              compact
              hasIndent={(currentFormatting.indentLeft ?? 0) > 0}
            />
          );
        case 'alignmentButtons':
          return (
            <AlignmentButtons
              key={key}
              value={currentFormatting.alignment || 'left'}
              onChange={alignmentAction}
              disabled={isReadOnly}
            />
          );
        case 'lineSpacing':
          return (
            <LineSpacingPicker
              key={key}
              value={currentFormatting.lineSpacing}
              onChange={lineSpacingChange}
              disabled={isReadOnly}
            />
          );
        case 'tableGrid':
          return (
            <TableGridPicker
              key={key}
              onInsert={(rows, columns) => onInsertTable?.(rows, columns)}
              disabled={isReadOnly || !onInsertTable}
              tooltip="Insert table"
            />
          );
        case 'tableBorderColor':
          return (
            <TableBorderColorPicker
              key={key}
              onAction={tableAction}
              disabled={isReadOnly || !onTableAction}
              theme={theme}
              value={
                tableContext?.cellBorderColor
                  ? resolveColor(tableContext.cellBorderColor, theme).replace(/^#/, '')
                  : undefined
              }
            />
          );
        case 'tableBorderWidth':
          return (
            <TableBorderWidthPicker
              key={key}
              onAction={tableAction}
              disabled={isReadOnly || !onTableAction}
            />
          );
        case 'tableCellFill':
          return (
            <TableCellFillPicker
              key={key}
              onAction={tableAction}
              disabled={isReadOnly || !onTableAction}
              theme={theme}
              value={tableContext?.cellBackgroundColor}
            />
          );
        case 'tableStyleGallery':
          return (
            <TableStyleGallery
              key={key}
              currentStyleId={tableContext?.table?.attrs?.styleId}
              documentStyles={documentStyles}
              onAction={tableAction}
            />
          );
        case 'zoomControl':
          return null;
        case 'editingMode':
          return (
            <EditingModeDropdown
              key={key}
              mode={editingMode ?? 'editing'}
              onModeChange={(mode) => onSetEditingMode?.(mode)}
              disabled={readOnly || !onSetEditingMode}
            />
          );
        default:
          return null;
      }
    },
    [
      alignmentAction,
      currentFormatting,
      documentStyles,
      editingMode,
      fontFamilyChange,
      fontSizeChange,
      formatAction,
      highlightColorChange,
      isReadOnly,
      lineSpacingChange,
      onInsertTable,
      onSetEditingMode,
      onTableAction,
      readOnly,
      styleChange,
      tableAction,
      tableContext,
      textColorChange,
      theme,
    ]
  );

  const actions = useMemo(
    () => ({
      format: formatAction,
      align: alignmentAction,
    }),
    [formatAction, alignmentAction]
  );

  return {
    compact: compactEntries,
    ribbon: ribbonTabs,
    actions,
    renderRibbonComponent,
  };
}
