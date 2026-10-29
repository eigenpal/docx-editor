import { useTranslation } from '../i18n';
import {
  isElementNode,
  isHTMLElementNode,
  keepScrollAtInlineEnd,
} from '@docx-editor.dev/core/editor';
import {
  computed,
  defineComponent,
  h,
  onMounted,
  onUnmounted,
  provide,
  watch,
  type CSSProperties,
  type PropType,
} from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { claimsReviewGutter, useDocxEditor, useReviewRailRegistry } from './context';
import { useEditorState } from './useEditorState';
import { ScopedByAncestorContext } from './scope-context';
import { useChromeScopeClassName } from './color-mode-context';
import { InsideViewportContext } from './viewport-context';
import { zoomLevelForShortcut } from './zoom-levels';
import { useNavigationLayoutStore, useNavigationShift } from './navigation/navigation-layout';
import {
  REVIEW_MARKERS_GUTTER,
  reviewGutterScrolls,
  useReviewColumnSide,
  useReviewGutter,
} from './review-gutter';
import { mergeHostClass } from '../lib/mergeHostClass';
import type { DocxEditorChildren } from '../docx-editor-children';

const selectPaneOpen = (snapshot: EditorSnapshot): boolean => snapshot.reviewPaneOpen ?? true;
const selectZoomFitting = (snapshot: EditorSnapshot): boolean => snapshot.zoomMode?.type === 'fit';

/** @public */
export interface DocxEditorViewportProps {
  class?: string;
  className?: string;
  style?: CSSProperties;
  children?: DocxEditorChildren;
}

/** @public */
export const DocxEditorViewport = defineComponent({
  name: 'DocxEditorViewport',
  props: {
    class: { type: String, default: undefined },
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props, { slots }) {
    const translation = useTranslation();
    provide(ScopedByAncestorContext, true);
    provide(InsideViewportContext, true);
    const scopeClassName = useChromeScopeClassName();
    const editorRef = useDocxEditor();
    const paneOpen = useEditorState(selectPaneOpen);
    const fitting = useEditorState(selectZoomFitting);
    const rail = useReviewRailRegistry();
    const reserve = computed(() => claimsReviewGutter(rail.value));
    const reviewGutter = useReviewGutter();
    // A right-to-left interface puts the column on the page's left and the navigation pane on
    // its right. The custom properties stay logical; the stylesheet maps them under
    // `data-chrome-dir`, because this element keeps a left-to-right base.
    const columnSide = useReviewColumnSide();
    const navShift = useNavigationShift();
    const layoutStore = useNavigationLayoutStore();
    let viewportEl: HTMLElement | null = null;

    // A column that does not fit scrolls sideways. On the left it starts in view, so the
    // viewport keeps to its right end instead: the page first, the cards one scroll away,
    // also while a navigation shift, zoom, or new pages widen the content.
    const scrollsLeft = computed(
      () => columnSide() === 'left' && reserve.value && reviewGutterScrolls(reviewGutter.value)
    );
    let releaseEnd: (() => void) | null = null;
    const keepPageInView = () => {
      releaseEnd?.();
      releaseEnd = scrollsLeft.value && viewportEl ? keepScrollAtInlineEnd(viewportEl) : null;
    };
    onMounted(() => {
      if (viewportEl) layoutStore?.setViewport(viewportEl);
      keepPageInView();
    });
    onUnmounted(() => {
      releaseEnd?.();
      layoutStore?.setViewport(null);
    });
    watch(navShift, (shift) => {
      if (viewportEl) viewportEl.style.setProperty('--docx-nav-shift', `${shift}px`);
      layoutStore?.setViewport(viewportEl);
    });
    watch(scrollsLeft, keepPageInView, { flush: 'post' });
    const onKeyDownCapture = (event: KeyboardEvent) => {
      const editor = editorRef.value;
      if (!editor || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      const target = event.target;
      if (isElementNode(target) && target.closest('input, textarea, select, [role="dialog"]')) {
        return;
      }
      const next = zoomLevelForShortcut(event.key, editor.getZoom());
      if (next === null) return;
      event.preventDefault();
      editor.setZoom(next);
    };

    return () => {
      const side = columnSide();
      const attrs: Record<string, unknown> = {
        ref: (el: unknown) => {
          viewportEl = isHTMLElementNode(el) ? el : null;
          layoutStore?.setViewport(viewportEl);
          if (viewportEl) {
            viewportEl.style.setProperty('--docx-nav-shift', `${navShift.value}px`);
          }
        },
        'data-testid': 'docx-editor-scroll',
        tabindex: 0,
        role: 'region',
        'aria-label': translation.t('editor.documentViewport'),
        onKeydownCapture: onKeyDownCapture,
        class: mergeHostClass(
          `${scopeClassName()}docx-editor-one-surface docx-editor-one-surface__viewport docx-editor__scroll-container`,
          props.class,
          props.className
        ),
        style: {
          ...props.style,
          '--docx-nav-shift': `${navShift.value}px`,
          ...(reserve.value
            ? {
                '--docx-review-gutter': `${reviewGutter.value.inlineEnd}px`,
                '--docx-review-gutter-start': `${reviewGutter.value.inlineStart}px`,
                // What a closed pane reserves on both edges. Under `overflow: 'scroll'`
                // the fit subtracts this in both pane states, so the page keeps one size.
                '--docx-review-strip': `${2 * REVIEW_MARKERS_GUTTER}px`,
              }
            : {}),
        } as CSSProperties,
      };
      if (reserve.value) attrs['data-review-pane'] = paneOpen.value ? 'open' : 'closed';
      // The navigation pane opens on the chrome's start side, so its shift pads the right then.
      if (side === 'left') attrs['data-chrome-dir'] = 'rtl';
      if (reserve.value && side === 'left') attrs['data-review-side'] = 'left';
      if (fitting.value) attrs['data-zoom-fit'] = '';
      return h('div', attrs, slots.default?.());
    };
  },
});
