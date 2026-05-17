/**
 * @eigenpal/docx-editor-vue/ui
 *
 * UI entry point — toolbar primitives, pickers, dialogs.
 * Mirrors packages/react/src/ui.ts so consumer code that imports
 * `@eigenpal/docx-editor-react/ui { ColorPicker, FontPicker }` and
 * swaps to `@eigenpal/docx-editor-vue/ui` works without surface
 * changes.
 *
 * @example
 *   import { Toolbar, FontPicker, ColorPicker } from '@eigenpal/docx-editor-vue/ui';
 */

// ─── TOOLBAR ──────────────────────────────────────────────────────────────
export { default as Toolbar } from './components/Toolbar.vue';
export { default as EditorToolbar } from './components/EditorToolbar.vue';
export { default as TitleBar } from './components/TitleBar.vue';
export { default as ResponsiveToolbar } from './components/ui/ResponsiveToolbar.vue';
export { default as MenuBar } from './components/MenuBar.vue';
export { default as MenuDropdown } from './components/ui/MenuDropdown.vue';
export { default as DocumentName } from './components/DocumentName.vue';
export { default as EditingModeDropdown } from './components/EditingModeDropdown.vue';

// ─── PICKERS ──────────────────────────────────────────────────────────────
export { default as FontPicker } from './components/ui/FontPicker.vue';
export { default as FontSizePicker } from './components/ui/FontSizePicker.vue';
export { default as LineSpacingPicker } from './components/ui/LineSpacingPicker.vue';
export { default as StylePicker } from './components/ui/StylePicker.vue';
export { default as ColorPicker } from './components/ui/ColorPicker.vue';
export { default as AlignmentButtons } from './components/ui/AlignmentButtons.vue';
export { default as ListButtons } from './components/ui/ListButtons.vue';
// Mirrors React's ui.ts, which surfaces these from ListButtons. The `*.vue`
// ambient module declares only a default export, so `tsc` can't see the
// SFC's `<script>`-block re-exports — re-export from core directly instead.
export { createDefaultListState, type ListState } from '@eigenpal/docx-editor-core/utils/listState';
export { default as ZoomControl } from './components/ui/ZoomControl.vue';
export { default as Tooltip } from './components/ui/Tooltip.vue';
export { default as LoadingIndicator } from './components/ui/LoadingIndicator.vue';
export { default as Button } from './components/ui/Button.vue';
export { default as IconGridDropdown } from './components/ui/IconGridDropdown.vue';
export { default as Popover } from './components/ui/Popover.vue';

// ─── TABLE ────────────────────────────────────────────────────────────────
export { default as TableToolbar } from './components/ui/TableToolbar.vue';
export { default as TableStyleGallery } from './components/ui/TableStyleGallery.vue';
export { default as TableGridPicker } from './components/ui/TableGridPicker.vue';
export { default as TableGridInline } from './components/ui/TableGridInline.vue';
export { default as TableInsertButtons } from './components/ui/TableInsertButtons.vue';
export { default as TableMergeButton } from './components/ui/TableMergeButton.vue';
export { default as TableMoreDropdown } from './components/ui/TableMoreDropdown.vue';
export { default as TableCellFillPicker } from './components/ui/TableCellFillPicker.vue';
export { default as TableBorderPicker } from './components/ui/TableBorderPicker.vue';
export { default as TableBorderColorPicker } from './components/ui/TableBorderColorPicker.vue';
export { default as TableBorderWidthPicker } from './components/ui/TableBorderWidthPicker.vue';

// ─── IMAGE ────────────────────────────────────────────────────────────────
export { default as ImageWrapDropdown } from './components/ui/ImageWrapDropdown.vue';
export { default as ImageTransformDropdown } from './components/ui/ImageTransformDropdown.vue';

// ─── SIDEBAR ──────────────────────────────────────────────────────────────
export { default as UnifiedSidebar } from './components/UnifiedSidebar.vue';
export { default as CommentCard } from './components/sidebar/CommentCard.vue';
export { default as TrackedChangeCard } from './components/sidebar/TrackedChangeCard.vue';
export { default as AddCommentCard } from './components/sidebar/AddCommentCard.vue';
export { default as ReplyInput } from './components/sidebar/ReplyInput.vue';
export { default as ReplyThread } from './components/sidebar/ReplyThread.vue';
export { default as ResolvedCommentMarker } from './components/sidebar/ResolvedCommentMarker.vue';
export { default as CommentMarginMarkers } from './components/CommentMarginMarkers.vue';

// ─── DIALOGS ──────────────────────────────────────────────────────────────
export { default as FindReplaceDialog } from './components/dialogs/FindReplaceDialog.vue';
export { default as FootnotePropertiesDialog } from './components/dialogs/FootnotePropertiesDialog.vue';
export { default as HyperlinkDialog } from './components/dialogs/HyperlinkDialog.vue';
export { default as ImagePositionDialog } from './components/dialogs/ImagePositionDialog.vue';
export { default as ImagePropertiesDialog } from './components/dialogs/ImagePropertiesDialog.vue';
export { default as InsertImageDialog } from './components/dialogs/InsertImageDialog.vue';
export { default as InsertSymbolDialog } from './components/dialogs/InsertSymbolDialog.vue';
export { default as InsertTableDialog } from './components/dialogs/InsertTableDialog.vue';
export { default as KeyboardShortcutsDialog } from './components/dialogs/KeyboardShortcutsDialog.vue';
export { default as PageSetupDialog } from './components/dialogs/PageSetupDialog.vue';
export { default as PasteSpecialDialog } from './components/dialogs/PasteSpecialDialog.vue';
export { default as SplitCellDialog } from './components/dialogs/SplitCellDialog.vue';
export { default as TablePropertiesDialog } from './components/dialogs/TablePropertiesDialog.vue';

// ─── MISC ─────────────────────────────────────────────────────────────────
export { default as PrintButton } from './components/PrintButton.vue';
export { default as PrintPreview } from './components/ui/PrintPreview.vue';
export { default as HorizontalRuler } from './components/ui/HorizontalRuler.vue';
export { default as VerticalRuler } from './components/ui/VerticalRuler.vue';
export { default as UnsavedIndicator } from './components/ui/UnsavedIndicator.vue';

// ─── CARDS / STYLES ───────────────────────────────────────────────────────
export { CARD_STYLE_COLLAPSED, CARD_STYLE_EXPANDED } from './components/sidebar/cardStyles';
