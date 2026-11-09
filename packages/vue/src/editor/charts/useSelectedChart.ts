// `useSelectedChart`: the selected chart for a host's own chart controls, the Vue twin of the
// React hook (`packages/react/src/editor/charts/useSelectedChart.ts`). The reads and the
// commands come from core (`selected-chart.ts`).

import { computed, type ComputedRef } from 'vue';
import {
  execSelectedChart,
  readSelectedChart,
  type ChartData,
  type ChartFormat,
  type SelectedChartCommand,
  type SelectedChartState,
} from '@docx-editor.dev/core/editor';
import type { EditorSnapshot, ExecResult } from '@docx-editor.dev/core/contracts/editor';
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
  /** Why `data` or `format` is null for a selected chart, as a translation key. */
  readonly readReason: ComputedRef<string | null>;
  /** Whether a `setChartData` command can run now. */
  readonly canEditData: ComputedRef<boolean>;
  /** Whether `setChartType`, `setChartFormat`, and `setChartColor` can run now. */
  readonly canEditFormat: ComputedRef<boolean>;
  /** Why the data cannot change, for `localizeDisabledReason`, or null when it can. */
  readonly dataDisabledReason: ComputedRef<string | null>;
  /** Why the type and elements cannot change, or null when they can. */
  readonly formatDisabledReason: ComputedRef<string | null>;
  /**
   * Run a chart edit on the chart this composable shows, as `editor.exec` does, without the
   * `drawingNodeId`: `execute({ type: 'setChartType', chartType: 'line' })`.
   */
  readonly execute: (command: SelectedChartCommand) => ExecResult;
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
    readReason: computed(() => view.value.readReason),
    canEditData: computed(() => view.value.canEditData),
    canEditFormat: computed(() => view.value.canEditFormat),
    dataDisabledReason: computed(() => view.value.dataDisabledReason),
    formatDisabledReason: computed(() => view.value.formatDisabledReason),
    execute: (command) => execSelectedChart(editorRef.value, chart.value, command),
  };
}
