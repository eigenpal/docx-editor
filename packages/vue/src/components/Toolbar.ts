import { defineComponent, h, type CSSProperties, type VNode } from 'vue';
import type { DocxEditorChildren } from '../docx-editor-children';
import type { RefObject } from '../docx-editor-ref-object';
import type { ColorValue, Theme } from '@docx-editor.dev/core/contracts/editor';
import type { DocumentStyleSummary } from '../lib/stylePreview';
import type { FontOption } from '../lib/fontOptions';
import type { ListState } from '../lib/listState';

type ParagraphAlignment = 'left' | 'center' | 'right' | 'both' | 'distribute';

type TableAction =
  | 'addRowAbove'
  | 'addRowBelow'
  | 'addColumnLeft'
  | 'addColumnRight'
  | 'deleteRow'
  | 'deleteColumn'
  | 'mergeCells'
  | 'splitCell'
  | 'deleteTable'
  | 'selectTable'
  | 'selectRow'
  | 'selectColumn'
  | 'borderAll'
  | 'borderOutside'
  | 'borderInside'
  | 'borderNone'
  | 'borderTop'
  | 'borderBottom'
  | 'borderLeft'
  | 'borderRight'
  | { type: 'cellFillColor'; color: string | null }
  | { type: 'borderColor'; color: string }
  | { type: 'borderWidth'; size: number }
  | {
      type: 'cellBorder';
      side: 'top' | 'bottom' | 'left' | 'right' | 'all';
      style: string;
      size: number;
      color: string;
    };

/** @public @deprecated */
export interface SelectionFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  highlight?: string;
  alignment?: ParagraphAlignment;
  listState?: ListState;
  lineSpacing?: number;
  styleId?: string;
  indentLeft?: number;
  bidi?: boolean;
}

/** @public @deprecated */
export type FormattingAction =
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
  | { type: 'fontFamily'; value: string }
  | { type: 'fontSize'; value: number }
  | { type: 'textColor'; value: ColorValue | string }
  | { type: 'highlightColor'; value: string }
  | { type: 'alignment'; value: ParagraphAlignment }
  | { type: 'lineSpacing'; value: number }
  | { type: 'applyStyle'; value: string };

/**
 * Props for the deprecated formatting rail.
 * @public @deprecated Use `DocxEditor.Toolbar` from the composition layer instead.
 */
export interface ToolbarProps {
  currentFormatting?: SelectionFormatting;
  onFormat?: (action: FormattingAction) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  enableShortcuts?: boolean;
  editorRef?: RefObject<HTMLElement>;
  children?: DocxEditorChildren;
  inline?: boolean;
  showFontPicker?: boolean;
  fontFamilies?: ReadonlyArray<string | FontOption>;
  documentFonts?: readonly FontOption[];
  showFontSizePicker?: boolean;
  showTextColorPicker?: boolean;
  showHighlightColorPicker?: boolean;
  showAlignmentButtons?: boolean;
  showListButtons?: boolean;
  showLineSpacingPicker?: boolean;
  showStylePicker?: boolean;
  documentStyles?: readonly DocumentStyleSummary[];
  theme?: Theme | null;
  onPrint?: () => void;
  onOpen?: () => void;
  onSave?: () => void;
  showZoomControl?: boolean;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  onRefocusEditor?: () => void;
  onInsertTable?: (rows: number, columns: number) => void;
  showTableInsert?: boolean;
  showHelpMenu?: boolean;
  onInsertImage?: () => void;
  onInsertPageBreak?: () => void;
  onInsertSectionBreakNextPage?: () => void;
  onInsertSectionBreakContinuous?: () => void;
  onInsertTOC?: () => void;
  onInsertShape?: (data: {
    shapeType: string;
    width: number;
    height: number;
    fillColor?: string;
    fillType?: string;
    outlineWidth?: number;
    outlineColor?: string;
  }) => void;
  imageContext?: {
    wrapType: string;
    displayMode: string;
    cssFloat: string | null;
  } | null;
  onImageWrapType?: (wrapType: string) => void;
  onImageTransform?: (action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV') => void;
  onOpenImageProperties?: () => void;
  onPageSetup?: () => void;
  onWatermark?: () => void;
  tableContext?: {
    isInTable: boolean;
    rowCount?: number;
    columnCount?: number;
    canSplitCell?: boolean;
    hasMultiCellSelection?: boolean;
    cellBorderColor?: ColorValue;
    cellBackgroundColor?: string;
  } | null;
  onTableAction?: (action: TableAction) => void;
}

/** @public @deprecated Use `DocxEditor.Toolbar` from the composition layer instead. */
export const Toolbar = defineComponent({
  name: 'Toolbar',
  props: {
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    return () =>
      h(
        'div',
        {
          class: ['docx-toolbar', props.className].filter(Boolean).join(' '),
          role: 'toolbar',
        },
        slots.default?.()
      );
  },
});

/** @public @deprecated Use `DocxEditor.Toolbar` button parts instead. */
export interface LegacyToolbarButtonProps {
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  children: VNode;
  className?: string;
  ariaLabel?: string;
}

/** @public @deprecated Use `DocxEditor.Toolbar` button parts instead. */
export const ToolbarButton = defineComponent({
  name: 'LegacyToolbarButton',
  props: {
    active: { type: Boolean, default: undefined },
    disabled: { type: Boolean, default: undefined },
    title: { type: String, default: undefined },
    className: { type: String, default: undefined },
    ariaLabel: { type: String, default: undefined },
  },
  emits: ['click'],
  setup(props, { emit, slots }) {
    return () =>
      h(
        'button',
        {
          type: 'button',
          class: `docx-toolbar__button${props.className ? ` ${props.className}` : ''}`,
          disabled: props.disabled,
          title: props.title,
          'aria-label': props.ariaLabel,
          onClick: () => emit('click'),
        },
        slots.default?.()
      );
  },
});

/** @public @deprecated Use `DocxEditor.Toolbar` group parts instead. */
export const ToolbarGroup = defineComponent({
  name: 'ToolbarGroup',
  setup(_, { slots }) {
    return () => h('div', { class: 'docx-toolbar__group', role: 'group' }, slots.default?.());
  },
});
