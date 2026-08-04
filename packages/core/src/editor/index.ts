// @docx-editor.dev/engine-editor
//
// Browser editor composition root: the production tree-lane editor. Composes the typed
// OOXML tree session, engine-layout pagination, and the paginated surface into the
// PM-free Editor/EditorHost contract. Becomes @docx-editor.dev/core/editor at the section 7/14
// migration. Production placement: docs/architecture/production-engine-packages.md.

/** Stable package identity used by the import-graph / package-authority checks. */
export const ENGINE_EDITOR_PACKAGE = '@docx-editor.dev/core-contract/editor' as const;

export {
  createLayoutShaping,
  disposeLayoutShaping,
  toEditorFontError,
} from './font-configuration.ts';
export {
  WORD_DEFAULT_FONT,
  composeFontConfiguration,
  type FontConfigurationBase,
  type FontConfigurationFragment,
} from './font-composition.ts';
export {
  createFontSource,
  loadFonts,
  type FontLoadFailure,
  type FontLoadFailureReason,
  type FontUrlSource,
  type LoadFontsRequest,
  type LoadFontsResult,
} from './load-fonts.ts';
export {
  generateRulerTicks,
  rulerPageBox,
  PX_PER_INCH,
  PX_PER_CM,
  type RulerTick,
  type RulerUnit,
} from './ruler-ticks.ts';
export {
  dragIndent,
  handlePosition,
  snapTwips,
  SNAP_TWIPS_CM,
  SNAP_TWIPS_INCH,
  TWIPS_PER_CM,
  TWIPS_PER_INCH,
  type RulerDragOptions,
  type RulerIndent,
  type RulerIndentHandle,
  type RulerPageMetrics,
} from './ruler-indent.ts';
export {
  chromeProbeForSlot,
  commandForSlot,
  commandForSlotValue,
  commandForTableChromeSlotValue,
  runSave,
  runTableChromeCommand,
  runTableCommand,
  runToolbarCommand,
  tableChromeToolbarState,
  tableCommandToolbarState,
  toolbarCommandState,
  toolbarCommandStates,
  type RunTableChromeCommandResult,
  type ToolbarCommandState,
} from './toolbar-commands.ts';
export { tableCommandState } from './docx-editor-derive.ts';
export {
  applyTableChromePick,
  DEFAULT_TABLE_CHROME_DRAFT,
  defaultTableLabel,
  isTableChromeSlot,
  probeTableChromeCommand,
  TABLE_BORDER_STYLE_OPTIONS,
  TABLE_BORDER_TARGET_OPTIONS,
  TABLE_BORDER_WIDTH_OPTIONS,
  TABLE_CHROME_SLOT_IDS,
  tableChromeLabelKeyForTarget,
  tableChromeIconPaths,
  tableChromeVisible,
  type TableBorderTargetValue,
  type TableBorderStyleOption,
  type TableBorderTargetOption,
  type TableBorderWidthOption,
  type TableChromeDraft,
  type TableChromePick,
  type TableChromeSlotId,
  type TableInteractionLabelKey,
} from './table-chrome.ts';

export {
  CHROME_GROUPS,
  CHROME_MENUS,
  CHROME_UNAVAILABLE_KEY,
  chromeControlCount,
  chromeMenuSlots,
  chromeSlotId,
  defaultChromeGroups,
  type ChromeControl,
  type ChromeControlId,
  type ChromeControlState,
  type ChromeGroup,
  type ChromeGroupId,
  type ChromeMenu,
  type ChromeMenuEntry,
  type ChromeMenuId,
  type ChromeMenuItemEntry,
  type ChromeMenuSeparatorEntry,
  type ChromeMenuSubmenuEntry,
  type ChromeSlotId,
} from './chrome-controls.ts';
export {
  mountPaginatedSurface,
  type OpenPaginatedResult,
  type PaginatedSurface,
  type PaginatedSurfaceOptions,
  type PaginatedSurfaceState,
  type SurfaceFormatting,
} from './paginated-surface.ts';
export {
  createDocxEditor,
  type DocxEditorInstance,
  type DocxEditorConfig,
  type HyperlinkChromeHandlers,
} from './docx-editor.ts';
export {
  applyThemeShade,
  applyThemeTint,
  lowerColorValueForBorder,
  lowerColorValueForFill,
  resolveColorValueToCss,
  resolveThemeColorHex,
  validateThemeModifier,
} from './color-value-lower.ts';
export type { ColorLowerResult } from './color-value-lower.ts';
export type { HyperlinkOps, SurfaceHyperlink } from './surface-hyperlinks.ts';
export type { HyperlinkActivation, SurfaceNavigation } from './surface-navigation.ts';
// The types an adapter needs to CALL the surface, re-exported from the composition root.
// Adapters may depend on this package and not on the layout lane, so a host reaching into
// `engine-layout` for a parameter type would be reaching past the boundary for a name.
export type {
  SectionProperties,
  NavigationCommand,
  SemanticPosition,
  SemanticSelection,
  TextMeasurer,
} from '@docx-editor.dev/core-contract/layout';
