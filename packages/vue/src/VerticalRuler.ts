// Display-only horizontal ruler (interactive-paginated-editing M5.1).
//
// The Vue counterpart of React's `VerticalRuler.tsx`, sharing the engine's
// tick geometry so the two adapters cannot drift. Display-only: the original
// margin, indent, and tab drag handles have no greenfield contract to write
// through, so they are omitted rather than rendered inert.

import { computed, defineComponent, h, type PropType } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { generateRulerTicks, rulerPageBox, type RulerUnit } from '@docx-editor.dev/core/editor';
import { useEditorSnapshot } from './useEditorSnapshot';

/** Matches React's `RULER_WIDTH` gutter. */
export const RULER_WIDTH = 20;

export interface VerticalRulerProps {
  readonly editor: Editor | null;
  readonly zoom?: number;
  readonly unit?: RulerUnit;
}

export default defineComponent({
  name: 'VerticalRuler',
  props: {
    editor: { type: Object as PropType<Editor | null>, default: null },
    zoom: { type: Number, default: 1 },
    unit: { type: String as PropType<RulerUnit>, default: 'inch' },
  },
  setup(props) {
    const revision = useEditorSnapshot(() => props.editor);
    const box = computed(() => {
      void revision.value;
      return props.editor ? rulerPageBox(props.editor.getPageGeometry()) : null;
    });
    const ticks = computed(() =>
      box.value ? generateRulerTicks(box.value.height, props.unit) : []
    );
    return () =>
      box.value
        ? h(
            'div',
            {
              class: 'ep-ruler ep-ruler--vertical',
              'data-testid': 'vertical-ruler',
              role: 'presentation',
              'aria-hidden': 'true',
              style: { width: `${RULER_WIDTH}px`, height: `${box.value.height * props.zoom}px` },
            },
            ticks.value.map((tick) =>
              h(
                'div',
                {
                  key: tick.position,
                  class: 'ep-ruler__tick',
                  style: { top: `${tick.position * props.zoom}px`, width: `${tick.height}px` },
                },
                tick.label ? [h('span', { class: 'ep-ruler__label' }, tick.label)] : []
              )
            )
          )
        : null;
  },
});
