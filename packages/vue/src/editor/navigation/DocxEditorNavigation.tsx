import {
  computed,
  defineComponent,
  provide,
  watch,
  type CSSProperties,
  type PropType,
  type VNode,
} from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { useFormControlTranslate } from '../form-control-translate';
import { useChromeScopeClassName } from '../color-mode-context';
import { NavigationContext, type NavigationContextValue } from './navigation-context';
import { NAVIGATION_PANE_INSET, navigationPaneReservation } from './navigation-geometry';
import { useDocumentOutline } from './useDocumentOutline';
import { useDocumentSearch, type DocumentSearchHighlight } from './useDocumentSearch';
import { useNavigationFocus } from './useNavigationFocus';
import {
  useNavigationPane,
  type NavigationTab as NavigationTabId,
  type UseNavigationPaneOptions,
} from './useNavigationPane';
import { NavigationGoTo } from './parts-goto';
import { useDocxEditor } from '../context';
import { scopeDispose } from '../scope-dispose';
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
import { useChromeDir } from '../../i18n';

/** Props for `DocxEditor.Navigation`. @public */
export interface DocxEditorNavigationProps extends UseNavigationPaneOptions {
  /**
   * Label resolver. Defaults to the `translate` given to `DocxEditorRoot`, and for keys it
   * leaves unresolved, to the active locale catalogue.
   */
  t?: (key: string, params?: Record<string, string | number>) => string;
  toggle?: boolean | NavigationPartProps;
  /**
   * Which Find matches to highlight while the Find tab is open: `'all'` (default),
   * `'active'`, or `'none'`. The pane stops requesting highlights when it closes or leaves the
   * tab; another `useDocumentSearch` consumer can still request them.
   */
  searchHighlight?: DocumentSearchHighlight;
  /**
   * Whether Ctrl+F (Cmd+F on macOS) opens the pane on the Find tab. Defaults to `true`. The
   * shortcut applies only while focus is in this editor, so the rest of the page keeps the
   * browser's own search. Set `false` to leave the shortcut to the browser everywhere.
   */
  findShortcut?: boolean;
  /**
   * Whether Ctrl+G (Cmd+Option+G on macOS) opens the pane on the Go to tab. Defaults to
   * `true`, and applies only while focus is in this editor. The `openGoTo` editor command
   * opens the tab either way.
   */
  goToShortcut?: boolean;
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
  readonly GoTo: typeof NavigationGoTo;
  readonly Toggle: typeof NavigationToggle;
}

const DocxEditorNavigationImpl = defineComponent({
  name: 'DocxEditorNavigation',
  props: {
    t: { type: Function as PropType<DocxEditorNavigationProps['t']>, default: undefined },
    toggle: { type: [Boolean, Object] as PropType<boolean | NavigationPartProps>, default: true },
    searchHighlight: { type: String as PropType<DocumentSearchHighlight>, default: 'all' },
    findShortcut: { type: Boolean, default: true },
    goToShortcut: { type: Boolean, default: true },
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
    paneWidth: { type: Number, default: undefined },
    defaultOpen: { type: Boolean, default: undefined },
    defaultTab: { type: String as PropType<NavigationTabId>, default: undefined },
    open: { type: Boolean, default: undefined },
    tab: { type: String as PropType<NavigationTabId>, default: undefined },
    onOpenChange: { type: Function as PropType<(open: boolean) => void>, default: undefined },
    onTabChange: {
      type: Function as PropType<(tab: NavigationTabId) => void>,
      default: undefined,
    },
  },
  setup(props, { slots }) {
    const scope = useChromeScopeClassName();
    const chromeDir = useChromeDir();
    const paneOptions = (): UseNavigationPaneOptions => ({
      ...(props.paneWidth !== undefined ? { paneWidth: props.paneWidth } : {}),
      ...(props.defaultOpen !== undefined ? { defaultOpen: props.defaultOpen } : {}),
      ...(props.defaultTab !== undefined ? { defaultTab: props.defaultTab } : {}),
      ...(props.open !== undefined ? { open: props.open } : {}),
      ...(props.tab !== undefined ? { tab: props.tab } : {}),
      ...(props.onOpenChange ? { onOpenChange: props.onOpenChange } : {}),
      ...(props.onTabChange ? { onTabChange: props.onTabChange } : {}),
    });
    const pane = useNavigationPane(paneOptions);
    const outline = useDocumentOutline();
    const search = useDocumentSearch(() => ({
      highlight: pane.open.value && pane.tab.value === 'find' ? props.searchHighlight : 'none',
    }));
    // The host's resolver, else the one `DocxEditorRoot` was given, else the catalogue.
    const rootT = useFormControlTranslate();
    const focus = useNavigationFocus(
      pane,
      () => props.findShortcut,
      () => props.goToShortcut
    );
    const value = computed(() => ({
      pane,
      outline,
      search,
      t: props.t ?? rootT,
      intents: focus.intents,
      findShortcut: props.findShortcut,
      goToShortcut: props.goToShortcut,
    }));
    // The `openGoTo` command opens this pane's Go to tab.
    const editorRef = useDocxEditor();
    scopeDispose(
      // One registration for the pane's life: a prop change must not push it back on top of
      // a host's own Go To UI, so the shortcut flag is read when the chord arrives.
      watch(
        editorRef,
        (editor, _previous, onCleanup) => {
          if (!editor) return;
          onCleanup(
            editor.setGoToChrome({
              onRequest: () => focus.intents.openTab('goto'),
              get shortcut() {
                return props.goToShortcut;
              },
            })
          );
        },
        { immediate: true }
      )
    );
    provide(NavigationContext, value as unknown as NavigationContextValue);
    const width = computed(() => pane.paneWidth.value);

    return () => (
      <div
        ref={focus.rootRef}
        class={`${scope()}docx-nav${pane.open.value ? ' docx-nav--open' : ''}${pane.overlay.value ? ' docx-nav--overlay' : ''}${props.className ? ` ${props.className}` : ''}`}
        dir={chromeDir.value}
        data-open={pane.open.value ? 'true' : 'false'}
        onKeydown={focus.onKeyDown}
        style={{
          '--docx-nav-width': `${width.value}px`,
          '--docx-nav-inset': `${NAVIGATION_PANE_INSET}px`,
          '--docx-nav-reservation': `${navigationPaneReservation(width.value)}px`,
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
              <NavigationGoTo />
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
  GoTo: NavigationGoTo,
  Toggle: NavigationToggle,
}) as unknown as DocxEditorNavigationNamespace;

/** Alias matching React export name. */
export const Navigation = DocxEditorNavigation;

export {
  NavigationClose,
  NavigationFind,
  NavigationGoTo,
  NavigationHeader,
  NavigationHeadings,
  NavigationTab,
  NavigationTabs,
  NavigationTitle,
  NavigationToggle,
};

export type { NavigationPartProps, NavigationTabProps } from './parts';
