import { defineComponent, h, provide, type CSSProperties, type PropType } from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor, useReviewRailRegistry } from './context';
import { useEditorState } from './useEditorState';
import { ScopedByAncestorContext, useScopeClassName } from './scope-context';
import { zoomLevelForShortcut } from './zoom-levels';

const selectPaneOpen = (snapshot: EditorSnapshot): boolean => snapshot.reviewPaneOpen ?? true;
const selectZoomFitting = (snapshot: EditorSnapshot): boolean => snapshot.zoomMode?.type === 'fit';

/** @public */
export interface DocxEditorViewportProps {
  className?: string;
  style?: CSSProperties;
}

/** @public */
export const DocxEditorViewport = defineComponent({
  name: 'DocxEditorViewport',
  props: {
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
    const reserve = (rail.value.mounted ?? 0) > 0;

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
        '--docx-nav-shift': '0px',
      };
      const attrs: Record<string, unknown> = {
        'data-testid': 'docx-editor-scroll',
        onKeydownCapture: onKeyDownCapture,
        class: [
          `${scopeClassName}docx-editor-one-surface docx-editor-one-surface__viewport docx-editor__scroll-container`,
          props.className,
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
