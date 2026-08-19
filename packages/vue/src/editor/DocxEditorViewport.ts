import {
  defineComponent,
  h,
  onMounted,
  onUnmounted,
  provide,
  watch,
  computed,
  type CSSProperties,
  type PropType,
} from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor, useReviewRailRegistry } from './context';
import { useEditorState } from './useEditorState';
import { ScopedByAncestorContext, useScopeClassName } from './scope-context';
import { zoomLevelForShortcut } from './zoom-levels';
import { useNavigationLayoutStore, useNavigationShift } from './navigation/navigation-layout';
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
    provide(ScopedByAncestorContext, true);
    const scopeClassName = useScopeClassName();
    const editorRef = useDocxEditor();
    const paneOpen = useEditorState(selectPaneOpen);
    const fitting = useEditorState(selectZoomFitting);
    const rail = useReviewRailRegistry();
    const reserve = computed(() => (rail.value.mounted ?? 0) > 0);
    const navShift = useNavigationShift();
    const layoutStore = useNavigationLayoutStore();
    let viewportEl: HTMLElement | null = null;

    onMounted(() => {
      if (viewportEl) layoutStore?.setViewport(viewportEl);
    });
    onUnmounted(() => {
      layoutStore?.setViewport(null);
    });
    watch(navShift, (shift) => {
      if (viewportEl) viewportEl.style.setProperty('--docx-nav-shift', `${shift}px`);
      layoutStore?.setViewport(viewportEl);
    });

    const onKeyDownCapture = (event: KeyboardEvent) => {
      const editor = editorRef.value;
      if (!editor || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [role="dialog"]')) {
        return;
      }
      const next = zoomLevelForShortcut(event.key, editor.getZoom());
      if (next === null) return;
      event.preventDefault();
      editor.setZoom(next);
    };

    return () => {
      const attrs: Record<string, unknown> = {
        ref: (el: unknown) => {
          viewportEl = el instanceof HTMLElement ? el : null;
          layoutStore?.setViewport(viewportEl);
          if (viewportEl) {
            viewportEl.style.setProperty('--docx-nav-shift', `${navShift.value}px`);
          }
        },
        'data-testid': 'docx-editor-scroll',
        onKeydownCapture: onKeyDownCapture,
        class: mergeHostClass(
          `${scopeClassName}docx-editor-one-surface docx-editor-one-surface__viewport docx-editor__scroll-container`,
          props.class,
          props.className
        ),
        style: props.style,
      };
      if (reserve.value) attrs['data-review-pane'] = paneOpen.value ? 'open' : 'closed';
      if (fitting.value) attrs['data-zoom-fit'] = '';
      return h('div', attrs, slots.default?.());
    };
  },
});
