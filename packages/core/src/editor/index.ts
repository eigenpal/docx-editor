/**
 * `@docx-editor.dev/core/editor` — the editor facade and its chrome vocabulary.
 *
 * `createDocxEditor` implements the full `Editor` contract over a paginated surface, and the
 * chrome registry (`CHROME_GROUPS`, `ChromeSlotId`) is the toolbar taxonomy both adapters derive
 * their default arrangement from. Enabled state has exactly one source — `toolbarCommandState`,
 * which asks the engine — so a control and the engine can never disagree.
 *
 * @packageDocumentation
 * @public
 */
// Lane: editor. Responsibilities and dependency rules:
// docs/architecture/production-engine-packages.md.
//
// Browser composition root: composes the typed OOXML tree session, layout pagination,
// and the paginated surface into the PM-free Editor contract.

export {
  createLayoutShaping,
  disposeLayoutShaping,
  toEditorFontError,
} from './font-configuration.ts';
export {
  MAX_RESOLVER_FAMILIES,
  WORD_DEFAULT_FONT,
  composeFontConfiguration,
  type FontConfigurationBase,
  type FontConfigurationFragment,
  type FontResolutionRequest,
  type FontResolver,
} from './font-composition.ts';
export { blankDocumentBytes } from './blank-document.ts';
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
  formattingBarChromeGroups,
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
// `DocxEditorInstance.fontMeasurement()` returns it, so the lane that exports the instance
// has to export the answer too.
export type { FontMeasurementState } from './docx-editor-types.ts';
// Automation over an editor that is already open. The protocol itself lives in the neutral
// automation subpath — only the adapter that needs a live editor ships from here, and only as
// a factory: there is no composition hook a consumer could point at a second document model.
export { BROWSER_AUTOMATION_CAPABILITIES, createBrowserAutomationHost } from './automation-host.ts';
// The capability seam: what `createDocxEditor({ modules })` accepts and what a
// capability package (the pro review module) implements.
export {
  resolveEditorModules,
  type CollectReviewItems,
  type EditorModule,
  type EditorModuleRegistry,
  type ReviewModelInput,
  type ReviewModuleContribution,
} from '../contracts/modules.ts';
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
export {
  canExecuteImageCommand,
  captureImageMutationPreconditions,
  executeImageCommand,
  selectedImageStateOf,
  selectedDrawingOverlayTargetOf,
  computeMovedImagePosition,
  computeResizedImageExtentEmu,
  isStaleImageInteractionCommit,
  pointsToEmu,
  emuToOverlayPoints,
  IMAGE_OVERLAY_NUDGE_PT,
  IMAGE_OVERLAY_NUDGE_SHIFT_PT,
  EMU_PER_POINT,
  type ImageContext,
  type SelectedImageState,
  type ImageInteractionSession,
  type ImageOverlayScrollPort,
  type ImageResizeHandle,
  type SelectedDrawingOverlayTarget,
} from './docx-editor-images.ts';
export { surfaceExtent, type SurfaceExtent } from './surface-pages.ts';
export {
  REVIEW_RAIL_DOCK_MIN_PX,
  reviewPaneLayoutFor,
  type ReviewPaneLayout,
} from './review-pane-layout.ts';
// The fit's vocabulary. Adapters need the constants to render a zoom control that agrees
// with the engine (the ladder, the default mode) without hard-coding either.
export {
  AUTO_ZOOM_MODE,
  FIT_GUTTER_PX,
  FIXED_ZOOM_MODE,
  ZOOM_MAX,
  ZOOM_MIN,
  fitZoom,
  isFitMode,
  resolveZoomMode,
  type FitZoomInput,
} from './zoom-fit.ts';
export {
  computeImageResizeResult,
  createImageOverlayScrollPort,
  cssPixelsToLayoutPoints,
  layoutPointsToCssPixels,
  overlayFrameToSheetCssPixels,
  resizePreservesAspect,
  surfacePaintScale,
  finalizeImageOverlayInteraction,
  type AnchorFrameOrigin,
  type ImageResizeResult,
  type FinalizedImageOverlayInteraction,
  type OverlayFrameRect,
  type SurfaceOverlayCoordinates,
} from './surface-overlay-coordinates.ts';
export {
  IMAGE_WRAP_TARGETS,
  type ImageWrapTarget,
  type DrawingPositionInput,
} from '../store/package/drawing-projection.ts';
export {
  DRAWING_REL_FROM_H,
  DRAWING_REL_FROM_V,
  propertiesCommandHasPositionFields,
  positionInputFromPropertiesCommand,
  validateDrawingPositionInput,
  validateSetImagePositionCommand,
} from '../store/package/drawing-position-input.ts';
export {
  cropPercentFromCropPermille,
  cropPercentFromPermille,
  cropPercentFromSourceCrop,
  cropPermilleFromCropPercent,
  cropPermilleFromPercent,
  sourceCropFromCropPercent,
  validateImageCropPercent,
  type ImageCropPercent,
  type ImageCropPermille,
} from '../store/package/image-crop-units.ts';
export {
  resolveSvgIntrinsicSize,
  sniffImageMime,
  validateRasterHeader,
  type ImageDecodePort,
  type RenderableImageMime,
  type SupportedImageMime,
  type VectorImageMime,
} from '../store/package/image-resources.ts';
export {
  DEFAULT_IMAGE_RESOURCE_LIMITS,
  resolveImageResourceLimits,
  type ImageResourceLimits,
} from '../store/runtime/limits.ts';
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
} from '@docx-editor.dev/core/layout';
