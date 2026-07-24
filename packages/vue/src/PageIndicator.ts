// Page indicator (interactive-paginated-editing M5.1).
//
// The Vue counterpart of React's `PageIndicator.tsx`: `current of total` read
// from the public editor queries, so the adapter never measures the document to
// decide what page it is on. Renders nothing for a single-page document.

import { computed, defineComponent, h, type PropType } from 'vue';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import { useEditorSnapshot } from './useEditorSnapshot';

export interface PageIndicatorProps {
  readonly editor: Editor | null;
  readonly visible?: boolean;
}

export default defineComponent({
  name: 'PageIndicator',
  props: {
    editor: { type: Object as PropType<Editor | null>, default: null },
    visible: { type: Boolean, default: true },
  },
  setup(props) {
    // Re-render as the document changes, or the count goes stale.
    const revision = useEditorSnapshot(() => props.editor);
    const total = computed(() => {
      void revision.value;
      return props.editor ? props.editor.getTotalPages() : 0;
    });
    const label = computed(() => {
      void revision.value;
      if (!props.editor) return '';
      return `${props.editor.getCurrentPage('viewport') + 1} of ${total.value}`;
    });
    return () =>
      total.value > 1
        ? h(
            'div',
            {
              class: 'ep-shell__page-indicator-chip',
              'data-testid': 'page-indicator',
              style: { opacity: props.visible ? 1 : 0 },
              'aria-live': 'polite',
              role: 'status',
            },
            label.value,
          )
        : null;
  },
});
