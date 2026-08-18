import {
  defineComponent,
  h,
  onMounted,
  onUnmounted,
  provide,
  watch,
  type CSSProperties,
  type PropType,
  type VNode,
} from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor, useReviewRailRegistry } from './context';
import { useEditorState } from './useEditorState';
import { ScopedByAncestorContext, useScopeClassName } from './scope-context';
import { zoomLevelForShortcut } from './zoom-levels';
import { useNavigationLayoutStore, useNavigationShift } from './navigation/navigation-layout';

const selectPaneOpen = (snapshot: EditorSnapshot): boolean => snapshot.reviewPaneOpen ?? true;
const selectZoomFitting = (snapshot: EditorSnapshot): boolean => snapshot.zoomMode?.type === 'fit';

/** @public */
export interface DocxEditorViewportProps {
  class?: string;
  className?: string;
  style?: CSSProperties;
  children?: VNode;
}

/** @public */
export const DocxEditorViewport = defineComponent({
  name: 'DocxEditorViewport',
  props: {
    class: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props, { slots }) {
    provide(ScopedByAncestorContext, true);
    const scopeClassName = useScopeClassName();
    const editorRef = useDocxEditor();
    const paneOpen = useEditorState(selectPaneOpen);
    const fitting = useEditorState(selectZoomFitting);
    const rail = useReviewRailRegistry();
    const reserve = (rail.value.mounted ?? 0) > 0;
    const navShift = useNavigationShift();
    const layoutStore = useNavigationLayoutStore();
    let viewportEl: HTMLElement | null = null;

    onMounted(() => {
      if (viewportEl) layoutStore?.setViewport(viewportEl);
    });
    onUnmounted(() => {
      layoutStore?.setViewport(null);
    });
    watch(navShift, () => {
      if (viewportEl) layoutStore?.setViewport(viewportEl);
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
      const style: Record<string, string | number | undefined> = {
        ...(props.style as Record<string, string | number | undefined>),
        '--docx-nav-shift': `${navShift.value}px`,
      };
      const attrs: Record<string, unknown> = {
        ref: (el: unknown) => {
          viewportEl = el instanceof HTMLElement ? el : null;
          layoutStore?.setViewport(viewportEl);
        },
        'data-testid': 'docx-editor-scroll',
        onKeydownCapture: onKeyDownCapture,
        class: [
          `${scopeClassName}docx-editor-one-surface docx-editor-one-surface__viewport docx-editor__scroll-container`,
          props.class,
        ]
          .filter(Boolean)
          .join(' '),
        style,
      };
      if (reserve) attrs['data-review-pane'] = paneOpen.value ? 'open' : 'closed';
      if (fitting.value) attrs['data-zoom-fit'] = '';
      return h('div', attrs, slots.default?.());
    };
  },
});
