import {
  computed,
  defineComponent,
  provide,
  type CSSProperties,
  type PropType,
  type VNode,
} from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { useTranslation, type TranslationKey } from '../../i18n';
import { useScopeClassName } from '../scope-context';
import { NavigationContext, type NavigationContextValue } from './navigation-context';
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
  t?: (key: string, params?: Record<string, string | number>) => string;
  toggle?: boolean | NavigationPartProps;
  className?: string;
  style?: CSSProperties;
  children?: DocxEditorChildren;
}

/** @public */
export interface DocxEditorNavigationNamespace {
  (props: DocxEditorNavigationProps): VNode;
  readonly Header: typeof NavigationHeader;
  readonly Close: typeof NavigationClose;
  readonly Title: typeof NavigationTitle;
  readonly Tabs: typeof NavigationTabs;
  readonly Tab: typeof NavigationTab;
  readonly Headings: typeof NavigationHeadings;
  readonly Find: typeof NavigationFind;
  readonly Toggle: typeof NavigationToggle;
}

const DocxEditorNavigationImpl = defineComponent({
  name: 'DocxEditorNavigation',
  props: {
    t: { type: Function as PropType<DocxEditorNavigationProps['t']>, default: undefined },
    toggle: { type: [Boolean, Object] as PropType<boolean | NavigationPartProps>, default: true },
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
    paneWidth: { type: Number, default: undefined },
    defaultOpen: { type: Boolean, default: undefined },
    defaultTab: { type: String as PropType<'headings' | 'find'>, default: undefined },
  },
  setup(props, { slots }) {
    const scope = useScopeClassName();
    const paneOptions = {
      ...(props.paneWidth !== undefined ? { paneWidth: props.paneWidth } : {}),
      ...(props.defaultOpen !== undefined ? { defaultOpen: props.defaultOpen } : {}),
      ...(props.defaultTab !== undefined ? { defaultTab: props.defaultTab } : {}),
    };
    const pane = useNavigationPane(paneOptions);
    const outline = useDocumentOutline();
    const search = useDocumentSearch();
    const { t: catalogT } = useTranslation();
    const value = computed(() => ({
      pane,
      outline,
      search,
      t:
        props.t ??
        ((key: string, params?: Record<string, string | number>) =>
          catalogT(key as TranslationKey, params)),
    }));
    provide(NavigationContext, value as unknown as NavigationContextValue);
    const width = props.paneWidth ?? NAVIGATION_PANE_WIDTH;

    return () => (
      <div
        class={`${scope}docx-nav${pane.open.value ? ' docx-nav--open' : ''}${props.className ? ` ${props.className}` : ''}`}
        data-open={pane.open.value ? 'true' : 'false'}
        style={{
          '--docx-nav-width': `${width}px`,
          '--docx-nav-inset': `${NAVIGATION_PANE_INSET}px`,
          '--docx-nav-reservation': `${navigationPaneReservation(width)}px`,
          ...props.style,
        }}
      >
        {props.toggle !== false && !pane.open.value && (
          <NavigationToggle {...(typeof props.toggle === 'object' ? props.toggle : {})} />
        )}
        <aside
          class="docx-nav__panel-shell"
          aria-label={value.value.t('navigation.ariaLabel')}
          inert={!pane.open.value}
        >
          {slots.default?.() ?? (
            <>
              <NavigationHeader />
              <NavigationTabs />
              <NavigationHeadings />
              <NavigationFind />
            </>
          )}
        </aside>
      </div>
    );
  },
});

/** @public */
export const DocxEditorNavigation = Object.assign(DocxEditorNavigationImpl, {
  Header: NavigationHeader,
  Close: NavigationClose,
  Title: NavigationTitle,
  Tabs: NavigationTabs,
  Tab: NavigationTab,
  Headings: NavigationHeadings,
  Find: NavigationFind,
  Toggle: NavigationToggle,
}) as unknown as DocxEditorNavigationNamespace;

/** Alias matching React export name. */
export const Navigation = DocxEditorNavigation;

export {
  NavigationClose,
  NavigationFind,
  NavigationHeader,
  NavigationHeadings,
  NavigationTab,
  NavigationTabs,
  NavigationTitle,
  NavigationToggle,
};

export type { NavigationPartProps, NavigationTabProps } from './parts';
