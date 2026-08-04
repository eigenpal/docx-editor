// The navigation pane's public surface: the compound part, its parts' prop types, and the
// three hooks it is built from.

export {
  DocxEditorNavigation,
  Navigation,
  type DocxEditorNavigationNamespace,
  type DocxEditorNavigationProps,
} from './DocxEditorNavigation';
export {
  NavigationClose,
  NavigationFind,
  NavigationHeader,
  NavigationHeadings,
  NavigationTab,
  NavigationTabs,
  NavigationTitle,
  NavigationToggle,
  type NavigationPartProps,
  type NavigationTabProps,
} from './parts';
export {
  useNavigationPane,
  type NavigationTab as NavigationTabValue,
  type UseNavigationPaneOptions,
  type UseNavigationPaneResult,
} from './useNavigationPane';
export {
  useDocumentOutline,
  type OutlineHeading,
  type OutlineHeadingItem,
  type UseDocumentOutlineResult,
} from './useDocumentOutline';
export {
  useDocumentSearch,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MATCH_LIMIT,
  type UseDocumentSearchResult,
} from './useDocumentSearch';
export {
  NAVIGATION_PANE_GAP,
  NAVIGATION_PANE_INSET,
  NAVIGATION_PANE_WIDTH,
  navigationPaneReservation,
  navigationShift,
  type NavigationShiftInput,
} from './navigation-geometry';
export { useNavigationShift } from './navigation-layout';
