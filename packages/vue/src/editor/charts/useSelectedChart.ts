// `useSelectedChart`: the selected chart for a host's own chart controls, the Vue twin of the
// React hook (`packages/react/src/editor/charts/useSelectedChart.ts`). The reads and the
// commands come from core (`selected-chart.ts`).

import { computed, type ComputedRef } from 'vue';
import {
  editSelectedChartData,
  execSelectedChart,
  readSelectedChart,
  type ChartPaneChange,
  type ChartData,
  type ChartFormat,
  type SelectedChartCommand,
  type SelectedChartState,
} from '@docx-editor.dev/core/editor';
import type { EditorSnapshot, ExecResult } from '@docx-editor.dev/core/contracts/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';

/** What `useSelectedChart` returns. @public */
export interface UseSelectedChartReturn {
  /** The selected chart, or null when no single chart is selected. */
  readonly chart: ComputedRef<SelectedChartState | null>;
  /** The categories and series, or null when there is no chart or they cannot be read. */
  readonly data: ComputedRef<ChartData | null>;
  /** The type, elements, and colors, or null when there is no chart or they cannot be read. */
  readonly format: ComputedRef<ChartFormat | null>;
  /** Why `data` or `format` is null for a selected chart, translated. */
  readonly readReason: ComputedRef<string | null>;
  /** Whether a `setChartData` command can run now. */
  readonly canEditData: ComputedRef<boolean>;
  /** Whether `setChartType`, `setChartFormat`, and `setChartColor` can run now. */
  readonly canEditFormat: ComputedRef<boolean>;
  /** Why the data cannot change, translated, or null when it can. */
  readonly dataDisabledReason: ComputedRef<string | null>;
  /** Why the type and elements cannot change, translated, or null when they can. */
  readonly formatDisabledReason: ComputedRef<string | null>;
  /**
   * Run a chart edit on the chart this composable shows, as `editor.exec` does, without the
   * `drawingNodeId`: `execute({ type: 'setChartType', chartType: 'line' })`.
   */
  readonly execute: (command: SelectedChartCommand) => ExecResult;
  /**
   * Apply one checked data change, as the packaged pane does: `editData({ type: 'value',
   * series: 0, category: 1, text: '4.5' })`. Text that is not a number refuses, with the
   * reason as a translation key. One undo step.
   */
  readonly editData: (change: ChartPaneChange) => ExecResult;
}

const selectChart = (snapshot: EditorSnapshot) => snapshot.chart;
const selectEditable = (snapshot: EditorSnapshot) => snapshot.editable;
const selectMode = (snapshot: EditorSnapshot) => snapshot.editingMode;

/**
 * The selected chart, its data and format, whether each can change, and `execute` for the
 * chart commands. Use it inside `DocxEditor.Root` to build a chart pane of your own, and pass
 * that pane to `DocxEditor.SidePanel` in its default slot. @public
 */
export function useSelectedChart(): UseSelectedChartReturn {
  const editorRef = useDocxEditor();
  const { t } = useTranslation();
  const chart = useEditorState(selectChart);
  const editable = useEditorState(selectEditable);
  const editingMode = useEditorState(selectMode);
  const view = computed(() =>
    readSelectedChart(editorRef.value, chart.value, {
      editable: editable.value,
      editingMode: editingMode.value,
    })
  );
  return {
    chart: computed(() => view.value.chart),
    data: computed(() => view.value.data),
    format: computed(() => view.value.format),
    readReason: computed(() => localizeDisabledReason(view.value.readReason, t)),
    canEditData: computed(() => view.value.canEditData),
    canEditFormat: computed(() => view.value.canEditFormat),
    dataDisabledReason: computed(() => localizeDisabledReason(view.value.dataDisabledReason, t)),
    formatDisabledReason: computed(() =>
      localizeDisabledReason(view.value.formatDisabledReason, t)
    ),
    execute: (command) => execSelectedChart(editorRef.value, chart.value, command),
    editData: (change) => editSelectedChartData(editorRef.value, chart.value, change),
  };
}
