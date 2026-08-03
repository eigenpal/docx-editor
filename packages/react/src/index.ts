/**
 * @docx-editor.dev/react
 *
 * React adapter for the DOCX editor. A thin renderer over the `Editor`
 * contract from `@docx-editor.dev/core-contract`: it supplies DOM and paints
 * the engine's positioned display list, and holds no editing-engine state.
 *
 * @packageDocumentation
 * @public
 */

export const VERSION = '0.0.2';

export { DocxEditor, type DocxEditorNamespace } from './components/DocxEditor';

// Provider-first composition layer: the primitives behind `DocxEditor` (also reachable
// as `DocxEditor.Root` / `.Viewport` / `.Content`) and the hooks a custom chrome is
// built from.
export { DocxEditorRoot, type DocxEditorRootProps } from './editor/DocxEditorRoot';
export { DocxEditorViewport, type DocxEditorViewportProps } from './editor/DocxEditorViewport';
export { DocxEditorContent, type DocxEditorContentProps } from './editor/DocxEditorContent';
export {
  DocxEditorLoading,
  DocxEditorLoadingSpinner,
  type DocxEditorLoadingComponent,
  type DocxEditorLoadingProps,
  type DocxEditorLoadingSpinnerProps,
} from './editor/DocxEditorLoading';
export { useDocxEditor } from './editor/context';
// Context-fed chrome parts (also reachable as `DocxEditor.HorizontalRuler` /
// `.VerticalRuler` / `.DocumentOutline`): thin reactive wrappers over the props-driven
// ruler and outline components, fed from the provided editor.
export {
  DocxEditorHorizontalRuler,
  DocxEditorVerticalRuler,
  type DocxEditorRulerProps,
} from './editor/DocxEditorRulers';
export {
  DocxEditorDocumentOutline,
  type DocxEditorDocumentOutlineProps,
} from './editor/DocxEditorOutline';
export {
  DocxEditorPageSetupDialog,
  type DocxEditorPageSetupDialogProps,
} from './editor/DocxEditorPageSetup';
// The navigation pane (also reachable as `DocxEditor.Navigation`): the compound over the
// left gutter, its parts, and the three hooks a custom pane is built from. The pane FLOATS
// — it displaces the page only when the gutter is too narrow to hold it, and
// `navigationShift` is that rule as a pure function a host can reuse or test.
export {
  DocxEditorNavigation,
  NavigationClose,
  NavigationFind,
  NavigationHeader,
  NavigationHeadings,
  NavigationTab,
  NavigationTabs,
  NavigationTitle,
  NavigationToggle,
  NAVIGATION_PANE_GAP,
  NAVIGATION_PANE_INSET,
  NAVIGATION_PANE_WIDTH,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MATCH_LIMIT,
  navigationPaneReservation,
  navigationShift,
  useDocumentOutline,
  useDocumentSearch,
  useNavigationPane,
  useNavigationShift,
  type DocxEditorNavigationNamespace,
  type DocxEditorNavigationProps,
  type NavigationPartProps,
  type NavigationShiftInput,
  type NavigationTabProps,
  type NavigationTabValue,
  type OutlineHeading,
  type OutlineHeadingItem,
  type UseDocumentOutlineResult,
  type UseDocumentSearchResult,
  type UseNavigationPaneOptions,
  type UseNavigationPaneResult,
} from './editor/navigation';
// The link popover (also reachable as `DocxEditor.HyperLink`) and its headless hook. The
// parts live on the namespace statics; a host that wants a different panel takes the hook.
export {
  DocxEditorHyperLink,
  type DocxEditorHyperLinkNamespace,
  type HyperLinkActionProps,
  type HyperLinkPartProps,
  type HyperLinkProps,
} from './editor/DocxEditorHyperLink';
export {
  useHyperlinkPopup,
  useHyperlinkPopupInstance,
  type HyperlinkPopupAnchor,
  type HyperlinkPopupMode,
  type HyperlinkPopupState,
  type UseHyperlinkPopupResult,
} from './editor/useHyperlinkPopup';
export { useEditorState } from './editor/useEditorState';
export { useEditorCommand, type EditorCommandState } from './editor/useEditorCommand';
export { useEditorEvent } from './editor/useEditorEvent';
export { usePageSetup, type PageSetupUpdate, type UsePageSetupReturn } from './editor/usePageSetup';

// The compound toolbar (also reachable as `DocxEditor.Toolbar`): default set with
// in-place slot overrides, generic Button, and the font-family compound + hook. The
// concrete part components live on the namespace statics; the index exports the
// namespace, the hook, and the part prop types (the existing `Toolbar`/`ToolbarButton`
// exports below keep their names, so the new parts are not re-exported bare).
export {
  DocxEditorToolbar,
  useFontFamily,
  useParagraphStyle,
  type DocxEditorToolbarNamespace,
  type DocxEditorToolbarProps,
  type ToolbarAlignmentComponent,
  type FontFamilyItemProps,
  type FontFamilyNamespace,
  type FontFamilyPartProps,
  type FontFamilyProps,
  type ParagraphStyleItemProps,
  type ParagraphStyleNamespace,
  type ParagraphStyleOption,
  type ParagraphStylePartProps,
  type ParagraphStyleProps,
  ToolbarIndentLeft,
  ToolbarIndentRight,
  type ToolbarButtonProps,
  type ToolbarIndentComponent,
  type ToolbarIndentProps,
  type ToolbarPartComponent,
  type ToolbarPartProps,
  type ToolbarSeparatorProps,
  type ToolbarSlotPartComponent,
  type ToolbarSlotPartProps,
  type ToolbarTranslate,
  type UseFontFamilyResult,
  type UseParagraphStyleResult,
} from './editor/toolbar';

// The shared engine helpers both adapters expose, so the two package surfaces
// match (enforced by `bun run check:export-parity`).
export {
  CHROME_GROUPS,
  commandForSlot,
  runToolbarCommand,
  toolbarCommandState,
  type ChromeSlotId,
  type ToolbarCommandState,
} from '@docx-editor.dev/core-contract/editor';
export { PaginatedDocxEditor } from './components/PaginatedDocxEditor';
export { PaginatedDocxEditorShell } from './components/PaginatedDocxEditorShell';
export type { PaginatedDocxEditorShellProps } from './components/PaginatedDocxEditorShell';
export type {
  PaginatedDocxEditorHandle,
  // The Vue name for the same contract, exported so the two adapters pair by name.
  PaginatedDocxEditorHandle as PaginatedDocxEditorExpose,
  PaginatedDocxEditorProps,
} from './components/PaginatedDocxEditor';
export { EditorFontError } from './types';
export type {
  DocxEditorProps,
  DocxEditorRef,
  EditorMode,
  EditorFontErrorCode,
  FontConfiguration,
  FontFaceRequest,
  FontSource,
  FontSourceSubstitution,
} from './types';
// The font-composition surface, re-exported so the 80% path (fonts package + adapter)
// never needs a core import.
export {
  WORD_DEFAULT_FONT,
  composeFontConfiguration,
  createFontSource,
  loadFonts,
  type FontConfigurationBase,
  type FontConfigurationFragment,
  type FontLoadFailure,
  type FontLoadFailureReason,
  type FontUrlSource,
  type LoadFontsRequest,
  type LoadFontsResult,
} from '@docx-editor.dev/core-contract/editor';

// Re-export the contract types a consumer needs to drive the editor.
export type {
  Editor,
  EditorHost,
  EditorCommand,
  EditorQuery,
  EditorSnapshot,
  EditorScope,
  PageSetup,
} from '@docx-editor.dev/core-contract/contracts/editor';
export type {
  DisplayPage,
  DisplayItem,
  DocPoint,
} from '@docx-editor.dev/core-contract/contracts/geometry';
export type { DocxDocument } from '@docx-editor.dev/core-contract/contracts/types';
export { DocxEditorShell } from './components/DocxEditor/DocxEditorShell';
export { Toolbar, ToolbarButton, ToolbarGroup, type ToolbarProps } from './components/Toolbar';
export { TitleBar, MenuBar, DocumentName, Logo, TitleBarRight } from './components/TitleBar';
export { PageIndicator } from './components/DocxEditor/PageIndicator';
export { HorizontalRuler, type HorizontalRulerProps } from './components/ui/HorizontalRuler';
export { VerticalRuler, RULER_WIDTH, type VerticalRulerProps } from './components/ui/VerticalRuler';
export {
  generateRulerTicks,
  rulerPageBox,
  PX_PER_INCH,
  PX_PER_CM,
  type RulerTick,
  type RulerUnit,
} from './rulerTicks';
export { useEditorSnapshot } from './useEditorSnapshot';
