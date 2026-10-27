import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  shallowRef,
  Teleport,
  watch,
  type CSSProperties,
  type PropType,
  type VNode,
} from 'vue';
import type { DocxEditorChildren } from '../docx-editor-children';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useTranslation } from '../i18n';
import { isDevelopment } from '../lib/is-development';
import { useDocxEditor } from './context';
import { yieldTask } from './deferred-notifier';
import { twipsToPixels } from '../lib/units';
import { useEditorState } from './useEditorState';

const selectShowLoading = (snapshot: EditorSnapshot) =>
  snapshot.isLoading || snapshot.isOpening === true;
const selectLoadingPageSize = (snapshot: EditorSnapshot) => ({
  width: twipsToPixels(snapshot.pageSetup?.pageWidthTwips ?? 12_240) * snapshot.zoom,
  height: twipsToPixels(snapshot.pageSetup?.pageHeightTwips ?? 15_840) * snapshot.zoom,
});

/**
 * Props for `DocxEditor.Loading`. Two slots replace parts of the packaged screen: `indicator`
 * replaces only the spinner and, with `overlay`, moves below the laid-out pages while a large
 * document lays out its remaining pages; `default` replaces the whole first screen.
 *
 * ```vue
 * <DocxEditor.Loading overlay>
 *   <template #indicator><MyLogoSpinner label="Opening document" /></template>
 * </DocxEditor.Loading>
 * ```
 *
 * @public
 */
export interface DocxEditorLoadingProps {
  when?: boolean;
  overlay?: boolean;
  className?: string;
  style?: CSSProperties;
  /** The `indicator` slot: your own indicator, in place of the packaged spinner. */
  indicator?: DocxEditorChildren;
  /** The default slot: the whole first loading screen. */
  children?: DocxEditorChildren;
}

let warnedWithoutChrome = false;

/** Warn once that the `loadingIndicator` slot does nothing under `chrome: false`. */
export function warnLoadingIndicatorWithoutChrome(): void {
  if (warnedWithoutChrome || !isDevelopment()) return;
  warnedWithoutChrome = true;
  console.warn(
    '[docx-editor] the loadingIndicator slot is ignored with chrome set to false, which ' +
      'renders no loading screen. Compose DocxEditor.Loading with overlay and an indicator ' +
      'slot in a positioned box instead.'
  );
}

/**
 * The element below the laid-out pages that holds the indicator while a large document lays
 * out its remaining pages, or null. Only the overlay registers: the packaged frame has one.
 */
function useOpeningIndicator(enabled: () => boolean) {
  const editor = useDocxEditor();
  const element = shallowRef<HTMLElement | null>(null);
  const setElement = (next: HTMLElement | null): void => {
    element.value = next;
  };
  const stop = watch(
    [editor, enabled],
    ([current, on], _previous, onCleanup) => {
      if (!current || !on) return;
      current.setOpeningIndicatorHost({ publish: setElement });
      onCleanup(() => {
        current.setOpeningIndicatorHost(null);
        element.value = null;
      });
    },
    { immediate: true }
  );
  onBeforeUnmount(stop);
  return element;
}

/** Props for `DocxEditor.Loading.Spinner`. @public */
export interface DocxEditorLoadingSpinnerProps {
  className?: string;
}

/** @public */
export const DocxEditorLoadingSpinner = defineComponent({
  name: 'DocxEditorLoadingSpinner',
  props: {
    className: { type: String, default: undefined },
  },
  setup(props) {
    return () =>
      h('span', {
        class: `docx-editor__loading-spinner${props.className ? ` ${props.className}` : ''}`,
        ariaHidden: 'true',
      });
  },
});

const DocxEditorLoadingImpl = defineComponent({
  name: 'DocxEditorLoading',
  props: {
    when: { type: Boolean, default: false },
    overlay: { type: Boolean, default: false },
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props, { slots }) {
    const showLoading = useEditorState(selectShowLoading);
    const pageSize = useEditorState(selectLoadingPageSize);
    const below = useOpeningIndicator(() => props.overlay);
    const editor = useDocxEditor();
    // Whether the last render in the document showed the screen. Recorded after the render
    // lands: a render under a pending `Suspense` is not on screen yet.
    let shown = false;
    let rendered = false;
    const commit = () => {
      shown = rendered;
    };
    onMounted(commit);
    onUpdated(commit);
    // `Root` replaces the editor when new bytes arrive, attaches it one update later, and
    // publishes the new state a microtask after that. Until then neither flag holds. The
    // screen stays through it: a new element would replay the overlay's appearance delay,
    // and restart the spinner and any host indicator. The hold ends two tasks later, after
    // the root's own notification, so an editor that is never attached cannot keep it up.
    const holding = shallowRef(false);
    let hold = 0;
    watch(
      editor,
      () => {
        if (!shown) return;
        const current = ++hold;
        holding.value = true;
        yieldTask(() =>
          yieldTask(() => {
            if (hold === current) holding.value = false;
          })
        );
      },
      { flush: 'sync' }
    );
    onBeforeUnmount(() => {
      hold += 1;
    });
    const { t } = useTranslation();

    return () => {
      const visible = !below.value && (props.when || showLoading.value || holding.value);
      rendered = visible;
      const status = () =>
        slots.indicator?.() ?? [
          h(DocxEditorLoadingSpinner),
          h('span', { class: 'docx-editor-sr-only' }, t('loading.label')),
        ];
      // The first pages show and take input, so the opening state is over; the indicator moves
      // below the laid-out pages until the last one is laid out.
      if (below.value) return h(Teleport, { to: below.value }, status());
      if (!visible) return null;
      const classes = `docx-editor docx-editor__loading${
        props.overlay ? ' docx-editor__loading--overlay' : ''
      }${props.className ? ` ${props.className}` : ''}`;
      return h(
        'div',
        { class: classes, style: props.style, role: 'status', ariaLive: 'polite' },
        slots.default?.() ??
          h(
            'div',
            {
              class: 'docx-paginated-surface docx-editor__loading-surface',
              style: {
                width: `${pageSize.value.width}px`,
                height: `${pageSize.value.height}px`,
              },
            },
            [
              h('div', { class: 'docx-pages' }, [
                h('div', { class: 'docx-page docx-editor__loading-page' }, [
                  h('div', { class: 'docx-editor__loading-page-status' }, status()),
                ]),
              ]),
            ]
          )
      );
    };
  },
});

/** @public */
export interface DocxEditorLoadingComponent {
  (props: DocxEditorLoadingProps): VNode;
  readonly Spinner: typeof DocxEditorLoadingSpinner;
}

/** @public */
export const DocxEditorLoading = Object.assign(DocxEditorLoadingImpl, {
  Spinner: DocxEditorLoadingSpinner,
}) as unknown as DocxEditorLoadingComponent;
