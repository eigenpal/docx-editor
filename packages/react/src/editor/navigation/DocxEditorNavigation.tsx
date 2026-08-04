// The navigation pane: `DocxEditor.Navigation`.
//
// `<DocxEditor.Navigation />` on its own is the whole thing — a collapsed disc button that
// expands into a Headings/Find pane over the document's left gutter. Children replace the
// default composition part by part, and the three hooks behind it (`useNavigationPane`,
// `useDocumentOutline`, `useDocumentSearch`) are the escape hatch for a pane that shares
// none of this markup.
//
// THE PANE FLOATS; IT DOES NOT DOCK. It is absolutely positioned over the gutter to the
// left of the centred page, so opening it moves nothing as long as the gutter is wide
// enough to hold it. Only when the window is too narrow does it publish a shift, and only
// as much as it needs — see `navigation-geometry.ts`. That is the difference between the
// document sitting still and the document lurching sideways every time you open the pane.
//
// It stays MOUNTED when closed (width animates to zero, `inert` and `visibility` take it
// out of the tab order and hit testing), so a typed query and a scrolled heading list
// survive a close and reopen.

import { useMemo } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import { NavigationContext } from './navigation-context';
import {
  NAVIGATION_PANE_INSET,
  NAVIGATION_PANE_WIDTH,
  navigationPaneReservation,
} from './navigation-geometry';
import { useDocumentOutline } from './useDocumentOutline';
import { useDocumentSearch } from './useDocumentSearch';
import { useNavigationPane, type UseNavigationPaneOptions } from './useNavigationPane';
import type { NavigationPartProps } from './parts';
import {
  NavigationClose,
  NavigationFind,
  NavigationHeader,
  NavigationHeadings,
  NavigationTab,
  NavigationTabs,
  NavigationTitle,
  NavigationToggle,
} from './parts';

/** Props for `DocxEditor.Navigation`. @public */
export interface DocxEditorNavigationProps extends UseNavigationPaneOptions {
  /**
   * Label resolver. Defaults to the active `LocaleContext` catalogue (bundled English
   * unless a provider swapped it), matching `<DocxEditor>`'s own default.
   */
  t?: (key: string, params?: Record<string, string | number>) => string;
  /**
   * The collapsed disc button. `false` removes it; an OBJECT is props for the packaged one,
   * so a host can give it a class without restyling the library's.
   *
   * It is a prop rather than something you compose through `children` because the disc is
   * rendered OUTSIDE the panel: the panel is `inert` while the pane is shut, which is
   * exactly when the disc has to be clickable.
   */
  toggle?: boolean | NavigationPartProps;
  className?: string;
  style?: CSSProperties;
  /** Replaces the default composition (header, tabs, both panels). */
  children?: ReactNode;
}

/**
 * The document navigation pane — headings and find — over the left gutter.
 *
 * @public
 */
export function DocxEditorNavigation(props: DocxEditorNavigationProps): ReactElement {
  const { t: hostT, toggle = true, className, style, children, ...paneOptions } = props;

  const pane = useNavigationPane(paneOptions);
  const outline = useDocumentOutline();
  const search = useDocumentSearch();

  // Same precedence as `<DocxEditor>`: the host's resolver, else the active catalogue.
  // The cast bridges the two signatures — `TFunction` is keyed by the union derived from
  // `en.json`, the prop takes a plain string so a host can supply any resolver — and every
  // key this subtree passes is a real catalogue key.
  const { t: catalogT } = useTranslation();
  const value = useMemo(
    () => ({
      pane,
      outline,
      search,
      t:
        hostT ??
        ((key: string, params?: Record<string, string | number>) =>
          catalogT(key as TranslationKey, params)),
    }),
    [pane, outline, search, hostT, catalogT]
  );

  const width = props.paneWidth ?? NAVIGATION_PANE_WIDTH;

  return (
    <NavigationContext.Provider value={value}>
      <div
        className={`docx-nav${pane.open ? ' docx-nav--open' : ''}${className ? ` ${className}` : ''}`}
        data-open={pane.open ? 'true' : 'false'}
        style={
          {
            // Numbers this component owns, not file data: safe as computed inline values.
            '--docx-nav-width': `${width}px`,
            '--docx-nav-inset': `${NAVIGATION_PANE_INSET}px`,
            '--docx-nav-reservation': `${navigationPaneReservation(width)}px`,
            ...style,
          } as CSSProperties
        }
      >
        {toggle !== false && !pane.open && (
          <NavigationToggle {...(typeof toggle === 'object' ? toggle : {})} />
        )}
        <aside
          className="docx-nav__panel-shell"
          aria-label={value.t('navigation.ariaLabel')}
          // Closed but mounted: `inert` removes it from tab order and hit testing without
          // unmounting, so the query and scroll position survive a close/reopen.
          inert={!pane.open}
        >
          {children ?? (
            <>
              <NavigationHeader />
              <NavigationTabs />
              <NavigationHeadings />
              <NavigationFind />
            </>
          )}
        </aside>
      </div>
    </NavigationContext.Provider>
  );
}

/**
 * `DocxEditor.Navigation` with its parts attached as statics.
 *
 * @public
 */
export interface DocxEditorNavigationNamespace {
  (props: DocxEditorNavigationProps): ReactElement;
  readonly Header: typeof NavigationHeader;
  readonly Close: typeof NavigationClose;
  readonly Title: typeof NavigationTitle;
  readonly Tabs: typeof NavigationTabs;
  readonly Tab: typeof NavigationTab;
  readonly Headings: typeof NavigationHeadings;
  readonly Find: typeof NavigationFind;
  readonly Toggle: typeof NavigationToggle;
}

export const Navigation: DocxEditorNavigationNamespace = Object.assign(DocxEditorNavigation, {
  Header: NavigationHeader,
  Close: NavigationClose,
  Title: NavigationTitle,
  Tabs: NavigationTabs,
  Tab: NavigationTab,
  Headings: NavigationHeadings,
  Find: NavigationFind,
  Toggle: NavigationToggle,
});
