// `DocxEditor.ShapePane`: the fill and the outline of the selected shape, text box, line, or
// group, as an arrangement of the shape parts (`PANE_SECTIONS.shape`). Format shape moves the
// focus to its first field, wherever the host shows the pane. The pane holds no editing logic:
// each part runs its own slot. The React twin is `packages/react/src/editor/shapes/ShapePane.tsx`;
// both render the same markup.

import { defineComponent, nextTick, provide, ref, watch } from 'vue';
import {
  focusChartPane,
  listenPaneRequests,
  takePaneRequestFor,
} from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useChromeScopeClassName } from '../color-mode-context';
import { ScopedByAncestorContext } from '../scope-context';
import { DocxEditorPaneSections } from '../objects/pane-sections';
import { useSelectedShape } from './useSelectedShape';

/** Props for `DocxEditor.ShapePane`. @public */
export interface DocxEditorShapePaneProps {
  /** A class name added to the pane. */
  className?: string;
}

/** The fill and outline of the selected shape, or why the pane shows none. @public */
export const DocxEditorShapePane = defineComponent({
  name: 'DocxEditorShapePane',
  props: {
    className: { type: String, default: undefined },
  },
  setup(props) {
    const { t } = useTranslation();
    const scope = useChromeScopeClassName();
    provide(ScopedByAncestorContext, true);
    const editorRef = useDocxEditor();
    const shape = useSelectedShape();
    const root = ref<HTMLDivElement | null>(null);
    // Format shape asks for the focus. A host that mounts the pane for the request mounts it
    // after the request, so the pane takes a pending one when it mounts.
    watch(
      editorRef,
      (editor, _, onCleanup) => {
        if (!editor) return;
        if (takePaneRequestFor(editor, 'shape')?.focus)
          void nextTick(() => focusChartPane(root.value));
        onCleanup(
          listenPaneRequests(
            editor,
            () => {
              if (takePaneRequestFor(editor, 'shape')?.focus)
                void nextTick(() => focusChartPane(root.value));
            },
            { panes: ['shape'] }
          )
        );
      },
      { immediate: true }
    );
    return () => {
      // The pane carries the scope, so its parts need none of their own.
      const classes = `${scope()}${['docx-chart-pane', 'docx-shape-pane', props.className]
        .filter(Boolean)
        .join(' ')}`;
      const format = shape.format.value;
      const drawingNodeId = shape.drawingNodeId.value;
      if (!format || !drawingNodeId)
        return (
          <div class={classes} ref={root} data-shape="">
            <div class="docx-chart-pane__empty">
              <p class="docx-chart-pane__empty-title">{t('shape.pane.emptyTitle')}</p>
              <p class="docx-chart-pane__empty-body">{t('shape.pane.emptyBody')}</p>
            </div>
          </div>
        );
      // Parts keep unsaved text per shape: a group, or one shape in it.
      const key = shape.memberId.value ?? drawingNodeId;
      return (
        <div class={classes} ref={root} data-shape={drawingNodeId}>
          <DocxEditorPaneSections key={key} pane="shape" />
          {format.outline.visible === null ? (
            <p class="docx-chart-pane__note">{t('shape.pane.mixedOutline')}</p>
          ) : null}
        </div>
      );
    };
  },
});
