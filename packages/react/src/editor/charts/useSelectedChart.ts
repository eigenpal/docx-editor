// `useSelectedChart`: the selected chart for a host's own chart controls. The reads and the
// commands come from core (`selected-chart.ts`), so the Vue composable returns the same thing
// (`packages/vue/src/editor/charts/useSelectedChart.ts`).

import { useMemo } from 'react';
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
  readonly chart: SelectedChartState | null;
  /** The categories and series, or null when there is no chart or they cannot be read. */
  readonly data: ChartData | null;
  /** The type, elements, and colors, or null when there is no chart or they cannot be read. */
  readonly format: ChartFormat | null;
  /** Why `data` or `format` is null for a selected chart, as a translation key. */
  readonly readReason: string | null;
  /** Whether a `setChartData` command can run now. */
  readonly canEditData: boolean;
  /** Whether `setChartType`, `setChartFormat`, and `setChartColor` can run now. */
  readonly canEditFormat: boolean;
  /** Why the data cannot change, for `localizeDisabledReason`, or null when it can. */
  readonly dataDisabledReason: string | null;
  /** Why the type and elements cannot change, or null when they can. */
  readonly formatDisabledReason: string | null;
  /**
   * Run a chart edit on the chart this hook shows, as `editor.exec` does, without the
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
 * that pane to `DocxEditor.SidePanel` as its children. The value changes only when the chart,
 * its part, or the editing mode changes. @public
 */
export function useSelectedChart(): UseSelectedChartReturn {
  const editor = useDocxEditor();
  const chart = useEditorState(selectChart);
  const editable = useEditorState(selectEditable);
  const editingMode = useEditorState(selectMode);
  return useMemo(
    () => ({
      ...readSelectedChart(editor, chart, { editable, editingMode }),
      execute: (command: SelectedChartCommand) => execSelectedChart(editor, chart, command),
    }),
    [editor, chart, editable, editingMode]
  );
}
