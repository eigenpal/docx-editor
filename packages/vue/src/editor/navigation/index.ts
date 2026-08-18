export {
  DocxEditorNavigation,
  Navigation,
  NavigationClose,
  NavigationFind,
  NavigationHeader,
  NavigationHeadings,
  NavigationTab,
  NavigationTabs,
  NavigationTitle,
  NavigationToggle,
  type DocxEditorNavigationNamespace,
  type DocxEditorNavigationProps,
  type NavigationPartProps,
  type NavigationTabProps,
} from './DocxEditorNavigation';
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
