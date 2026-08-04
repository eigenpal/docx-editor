// The compound toolbar's public surface.

export {
  DocxEditorToolbar,
  type DocxEditorToolbarNamespace,
  type DocxEditorToolbarProps,
} from './DocxEditorToolbar';
export { ToolbarButton, type ToolbarButtonProps } from './ToolbarButton';
export { ToolbarAction, type ToolbarActionProps } from './ToolbarAction';
export {
  ToolbarSeparator,
  type ToolbarPartComponent,
  type ToolbarPartProps,
  type ToolbarSeparatorProps,
  type ToolbarSlotPartComponent,
  type ToolbarSlotPartProps,
} from './parts';
export {
  useFontFamily,
  type FontFamilyItemProps,
  type FontFamilyNamespace,
  type FontFamilyPartProps,
  type FontFamilyProps,
  type UseFontFamilyResult,
} from './FontFamily';
export {
  useParagraphStyle,
  type ParagraphStyleItemProps,
  type ParagraphStyleNamespace,
  type ParagraphStyleOption,
  type ParagraphStylePartProps,
  type ParagraphStyleProps,
  type UseParagraphStyleResult,
} from './ParagraphStyle';
export { ToolbarAlignment, type ToolbarAlignmentComponent } from './Alignment';
export type { ToolbarTranslate } from './toolbar-context';
