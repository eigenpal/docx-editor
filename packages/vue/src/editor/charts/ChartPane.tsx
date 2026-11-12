// `DocxEditor.ChartPane`: the type of the selected chart, its elements, its colors, and its data,
// as an arrangement of the chart parts (`PANE_SECTIONS.chart`). Edit chart moves the focus to
// its first field, wherever the host shows the pane. The pane holds no editing logic: each part
// runs its own slot. The React twin is `packages/react/src/editor/charts/ChartPane.tsx`; both
// render the same markup.

import { defineComponent, nextTick, ref, watch } from 'vue';
import {
  focusChartPane,
  listenPaneRequests,
  takePaneRequestFor,
} from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { DocxEditorPaneSections } from '../objects/pane-sections';
import { useSelectedChart } from './useSelectedChart';

/** Props for `DocxEditor.ChartPane`. @public */
export interface DocxEditorChartPaneProps {
  /** A class name added to the pane. */
  className?: string;
}

/**
 * The type, elements, and colors of the selected chart, then its data; or why it shows none.
 * @public
 */
export const DocxEditorChartPane = defineComponent({
  name: 'DocxEditorChartPane',
  props: {
    className: { type: String, default: undefined },
  },
  setup(props) {
    const { t } = useTranslation();
    const editorRef = useDocxEditor();
    const selected = useSelectedChart();
    const root = ref<HTMLDivElement | null>(null);
    // Edit chart asks for the focus. A host that mounts the pane for the request mounts it
    // after the request, so the pane takes a pending one when it mounts.
    watch(
      editorRef,
      (editor, _, onCleanup) => {
        if (!editor) return;
        if (takePaneRequestFor(editor, 'chart')?.focus)
          void nextTick(() => focusChartPane(root.value));
        onCleanup(
          listenPaneRequests(editor, () => {
            if (takePaneRequestFor(editor, 'chart')?.focus)
              void nextTick(() => focusChartPane(root.value));
          })
        );
      },
      { immediate: true }
    );
    return () => {
      const classes = ['docx-chart-pane', props.className].filter(Boolean).join(' ');
      const chart = selected.chart.value;
      if (!chart)
        return (
          <div class={classes} ref={root} data-chart-version="">
            <div class="docx-chart-pane__empty">
              <p class="docx-chart-pane__empty-title">{t('chart.pane.emptyTitle')}</p>
              <p class="docx-chart-pane__empty-body">{t('chart.pane.emptyBody')}</p>
            </div>
          </div>
        );
      const format = selected.format.value;
      return (
        <div class={classes} ref={root} data-chart-version={chart.version}>
          {format ? null : (
            <div class="docx-chart-pane__empty">
              <p class="docx-chart-pane__empty-title">{t('chart.pane.notEditableTitle')}</p>
              <p class="docx-chart-pane__empty-body">
                {selected.formatDisabledReason.value ?? selected.readReason.value ?? ''}
              </p>
            </div>
          )}
          <DocxEditorPaneSections
            key={chart.drawingNodeId}
            pane="chart"
            filter={(section) => section.id === 'data' || selected.format.value !== null}
          />
        </div>
      );
    };
  },
});
