// `DocxEditor.ChartPane`: the type of the selected chart, its elements (title, legend, data
// labels, axes, gridlines, axis titles), its colors, and then its data: the categories (or X
// values) and one card per series with its name and a value for each category. Edit chart
// moves the focus to its first field, wherever the host shows the pane. A field applies
// when the user presses Enter or leaves it, and a check box, list, or color when it changes,
// each as one undo step. The checks and the commands come from core (`chart-pane.ts`), so the
// Vue twin (`packages/vue/src/editor/charts/ChartPane.tsx`) checks the same input with the
// same keys and renders the same markup.

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  CHART_LEGEND_CHOICES,
  CHART_TYPE_CHOICES,
  chartAxisTitleLabels,
  chartColorCommand,
  chartColorPick,
  chartPaneCommand,
  chartPaneDraftContinues,
  chartPaneDraftKey,
  chartRowFocusAfterRemove,
  chartSeriesNote,
  chartThemeHexes,
  chartTitleCommand,
  chartTypeChangeNote,
  chartTypeHint,
  chartTypeLabelKey,
  chartValueText,
  focusChartPane,
  listenPaneRequests,
  nextChartCategoryLabel,
  takePaneRequest,
  type ChartPaneChange,
} from '@docx-editor.dev/core/editor';
import type { ChartData, ChartFormatChange, ChartType } from '@docx-editor.dev/core/editor';
import type { EditorCommand, EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { chromeIcon } from '../toolbar/ToolbarButton';
import { DELETE_PATHS } from '../contextmenu/contextmenu-icons';
import {
  ChartCheck,
  ChartColorField,
  ChartField,
  ChartSelect,
  useChartTranslate,
} from './chart-fields';

/** The most color fields the pane shows: a pie chart can have thousands of points. */
const MAX_COLOR_FIELDS = 100;

const selectChart = (snapshot: EditorSnapshot) => snapshot.chart;
const selectViewing = (snapshot: EditorSnapshot) =>
  !snapshot.editable || snapshot.editingMode === 'viewing';

/** Props for `DocxEditor.ChartPane`. @public */
export interface DocxEditorChartPaneProps {
  /** A class name added to the pane. */
  className?: string;
}

/**
 * Focus the element that `selector` names under `root` once a render shows it: the row it
 * names is new after an add or a remove. `selectText` selects a new row's sample name, so the
 * reader types the real one over it.
 */
function useRowFocus(root: { current: HTMLElement | null }) {
  const pending = useRef<{ selector: string; selectText: boolean } | null>(null);
  const [, rerender] = useState(0);
  useEffect(() => {
    const request = pending.current;
    const target = request ? root.current?.querySelector<HTMLElement>(request.selector) : null;
    if (!request || !target) return;
    pending.current = null;
    target.focus();
    if (request.selectText && 'select' in target) (target as HTMLInputElement).select();
  });
  return (selector: string, selectText = false) => {
    pending.current = { selector, selectText };
    rerender((n) => n + 1);
  };
}

/**
 * The type, elements, and colors of the selected chart, then its data; or why it shows none.
 * @public
 */
export function DocxEditorChartPane({ className }: DocxEditorChartPaneProps): ReactElement {
  const { t } = useTranslation();
  const translate = useChartTranslate();
  const editor = useDocxEditor();
  const chart = useEditorState(selectChart);
  const viewing = useEditorState(selectViewing);
  const root = useRef<HTMLDivElement>(null);
  const focusLater = useRowFocus(root);
  // Edit chart asks for the focus. A host that mounts the pane for the request mounts it after
  // the request, so the pane takes a pending one when it mounts.
  useEffect(() => {
    if (!editor) return undefined;
    if (takePaneRequest(editor)?.focus) focusChartPane(root.current);
    return listenPaneRequests(editor, () => {
      if (takePaneRequest(editor)?.focus) queueMicrotask(() => focusChartPane(root.current));
    });
  }, [editor]);
  const axesOffId = useId();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [draftScope, setDraftScope] = useState({ key: '', reset: 0 });
  const [typeNote, setTypeNote] = useState<{ id: string; key: string } | null>(null);
  const reasonText = (reason: string | null | undefined): string =>
    localizeDisabledReason(reason ?? null, t) ?? '';
  const classes = `docx-chart-pane${className ? ` ${className}` : ''}`;
  const dataRead =
    editor && chart
      ? editor.query({ type: 'chartData', drawingNodeId: chart.drawingNodeId })
      : null;
  const formatRead =
    editor && chart
      ? editor.query({ type: 'chartFormat', drawingNodeId: chart.drawingNodeId })
      : null;
  if (!chart || !dataRead || !formatRead)
    return (
      <div className={classes} ref={root} data-chart-version="">
        <div className="docx-chart-pane__empty">
          <p className="docx-chart-pane__empty-title">{t('chart.pane.emptyTitle')}</p>
          <p className="docx-chart-pane__empty-body">{t('chart.pane.emptyBody')}</p>
        </div>
      </div>
    );
  const id = chart.drawingNodeId;
  const data: ChartData | null = dataRead.ok ? dataRead.data : null;
  const format = formatRead.ok ? formatRead.format : null;
  const scopeKey = data ? chartPaneDraftKey(id, data) : id;
  const nextScope =
    scopeKey === draftScope.key
      ? draftScope
      : {
          key: scopeKey,
          reset:
            draftScope.reset +
            (draftScope.key && data && chartPaneDraftContinues(draftScope.key, scopeKey) ? 0 : 1),
        };
  if (nextScope !== draftScope) setDraftScope(nextScope);
  const draftKey = String(nextScope.reset);
  const dataDisabled = viewing || !chart.editable;
  const formatDisabled = viewing || !chart.formattable;
  /** Runs a command: null when it ran (or there was none), else the reason. */
  const exec = (command: EditorCommand | null): string | null => {
    if (!command || !editor) return null;
    const result = editor.exec(command);
    return result.ok ? null : reasonText(result.reason);
  };
  /** Runs a command of the type, elements, or colors; the pane announces a refusal. */
  const runFormat = (command: EditorCommand | null): string | null => {
    const reason = exec(command);
    setRefusal(reason);
    return reason;
  };
  /** Applies one data change: null when it applied, else the reason. */
  const apply = (change: ChartPaneChange): string | null => {
    if (!data) return null;
    const command = chartPaneCommand(id, data, change);
    if (!command.ok) return t(command.error);
    setRefusal(null);
    return exec(command.command);
  };
  /** Applies an add or a remove; the pane announces a refusal, as no field shows it. */
  const run = (change: ChartPaneChange): boolean => {
    const reason = apply(change);
    setRefusal(reason);
    return reason === null;
  };
  const toggle = (index: number, isOpen: boolean): void =>
    setOpen((prev) => {
      if (prev.has(index) === isOpen) return prev;
      const next = new Set(prev);
      if (isOpen) next.add(index);
      else next.delete(index);
      return next;
    });
  const changeType = (chartType: ChartType): void => {
    if (!format || !editor) return;
    const reason = runFormat({ type: 'setChartType', drawingNodeId: id, chartType });
    const after = reason === null ? editor.query({ type: 'chartFormat', drawingNodeId: id }) : null;
    const key = after?.ok ? chartTypeChangeNote(format, after.format) : null;
    setTypeNote(key ? { id, key } : null);
  };
  const set = (change: ChartFormatChange) =>
    runFormat({ type: 'setChartFormat', drawingNodeId: id, format: change });
  const themeHexes = chartThemeHexes(editor?.getDocumentThemeColors());
  const notes = format
    ? [
        typeNote?.id === id ? typeNote.key : chartTypeHint(format),
        chartSeriesNote(format, data?.series.length ?? 0),
      ].filter((key): key is string => key !== null)
    : [];
  const axisLabels = format ? chartAxisTitleLabels(format) : null;
  const axesOff = format?.axes === false;
  const xy = data?.kind === 'xy';
  const workbookNote =
    data?.workbook === 'kept'
      ? t('chart.data.workbookKept')
      : data?.workbook === 'external'
        ? t('chart.data.workbookExternal')
        : null;
  return (
    <div className={classes} ref={root} data-chart-version={chart.version}>
      <p className="docx-chart-pane__alert" role="alert">
        {refusal ?? ''}
      </p>
      {format ? (
        <>
          <section className="docx-chart-pane__section">
            <ChartSelect
              label={t('chart.format.type')}
              value={format.type ?? ''}
              other={t('chart.types.other')}
              options={CHART_TYPE_CHOICES.map((v) => [v, t(chartTypeLabelKey(v))] as const)}
              disabled={formatDisabled}
              onChange={changeType}
            />
            <div role="status" className="docx-chart-pane__status">
              {notes.map((key) => (
                <p key={key} className="docx-chart-pane__note">
                  {translate(key)}
                </p>
              ))}
            </div>
          </section>
          <section className="docx-chart-pane__section">
            <h3 className="docx-chart-pane__title">{t('chart.format.elements')}</h3>
            <ChartCheck
              label={t('chart.format.showTitle')}
              checked={format.title !== null}
              disabled={formatDisabled}
              onChange={(on) => set({ title: on ? t('chart.format.defaultTitle') : null })}
            />
            {format.title !== null ? (
              <div className="docx-chart-pane__sub">
                <ChartField
                  draftKey={draftKey}
                  label={t('chart.format.titleText')}
                  visibleLabel={t('chart.format.titleText')}
                  value={format.title}
                  disabled={formatDisabled}
                  onCommit={(text) => runFormat(chartTitleCommand(id, format, 'title', text))}
                />
              </div>
            ) : null}
            <ChartSelect
              label={t('chart.format.legend')}
              value={format.legend}
              options={CHART_LEGEND_CHOICES.map(
                (v) => [v, t(`chart.format.legendPositions.${v}`)] as const
              )}
              disabled={formatDisabled}
              onChange={(legend) => set({ legend })}
            />
            <ChartCheck
              label={t('chart.format.dataLabels')}
              checked={format.dataLabels}
              disabled={formatDisabled}
              onChange={(dataLabels) => set({ dataLabels })}
            />
            {format.axes !== null && axisLabels ? (
              <>
                <ChartCheck
                  label={t('chart.format.axes')}
                  checked={format.axes}
                  disabled={formatDisabled}
                  onChange={(axes) => set({ axes })}
                />
                <ChartCheck
                  label={t('chart.format.gridlines')}
                  checked={format.gridlines === true}
                  disabled={formatDisabled || axesOff}
                  {...(axesOff ? { describedBy: axesOffId } : {})}
                  onChange={(gridlines) => set({ gridlines })}
                />
                <div className="docx-chart-pane__pair">
                  <ChartField
                    draftKey={draftKey}
                    label={t(axisLabels.category)}
                    visibleLabel={t(axisLabels.category)}
                    value={format.axisTitles?.category ?? ''}
                    disabled={formatDisabled || axesOff}
                    {...(axesOff ? { describedBy: axesOffId } : {})}
                    onCommit={(text) =>
                      runFormat(chartTitleCommand(id, format, 'categoryAxisTitle', text))
                    }
                  />
                  <ChartField
                    draftKey={draftKey}
                    label={t(axisLabels.value)}
                    visibleLabel={t(axisLabels.value)}
                    value={format.axisTitles?.value ?? ''}
                    disabled={formatDisabled || axesOff}
                    {...(axesOff ? { describedBy: axesOffId } : {})}
                    onCommit={(text) =>
                      runFormat(chartTitleCommand(id, format, 'valueAxisTitle', text))
                    }
                  />
                </div>
                <p className="docx-chart-pane__note" id={axesOffId}>
                  {t(axesOff ? 'chart.format.axesOff' : 'chart.format.axisTitleHelp')}
                </p>
              </>
            ) : null}
          </section>
          <section className="docx-chart-pane__section">
            <h3 className="docx-chart-pane__title">{t('chart.format.colors')}</h3>
            {format.colors.slice(0, MAX_COLOR_FIELDS).map((entry, i) => (
              <ChartColorField
                key={i}
                name={entry.name || t('chart.data.unnamed')}
                label={t('chart.format.seriesColor', {
                  name: entry.name || t('chart.data.unnamed'),
                })}
                value={chartColorPick(entry)}
                automatic={entry.automatic}
                themeHexes={themeHexes}
                disabled={formatDisabled}
                onChange={(pick) => runFormat(chartColorCommand(id, i, pick))}
              />
            ))}
          </section>
        </>
      ) : (
        <div className="docx-chart-pane__empty">
          <p className="docx-chart-pane__empty-title">{t('chart.pane.notEditableTitle')}</p>
          <p className="docx-chart-pane__empty-body">{reasonText(chart.formatReason)}</p>
        </div>
      )}
      {data ? (
        <>
          <section className="docx-chart-pane__section">
            <h3 className="docx-chart-pane__title">
              {t(xy ? 'chart.data.xValues' : 'chart.data.categories')}
            </h3>
            <p className="docx-chart-pane__note">{t('chart.data.help')}</p>
            {workbookNote ? <p className="docx-chart-pane__note">{workbookNote}</p> : null}
            <ul className="docx-chart-pane__list">
              {data.categories.map((c, i) => (
                <li key={i} className="docx-chart-pane__row">
                  <ChartField
                    draftKey={draftKey}
                    label={t(xy ? 'chart.data.xValueLabel' : 'chart.data.categoryLabel', {
                      number: i + 1,
                    })}
                    value={c.label}
                    numeric={xy}
                    row={i}
                    disabled={dataDisabled}
                    onCommit={(text) => apply({ type: 'label', category: i, text })}
                  />
                  <button
                    type="button"
                    className="docx-chart-pane__icon-button"
                    aria-label={t('chart.data.removeCategoryNamed', { name: c.label })}
                    title={t('chart.data.removeCategoryNamed', { name: c.label })}
                    disabled={dataDisabled || data.categories.length <= 1}
                    onClick={() => {
                      const count = data.categories.length;
                      if (run({ type: 'removeCategory', category: i }))
                        focusLater(
                          `.docx-chart-pane__list [data-row="${chartRowFocusAfterRemove(i, count)}"]`
                        );
                    }}
                  >
                    {chromeIcon(DELETE_PATHS)}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="docx-dialog__button"
              disabled={dataDisabled}
              onClick={() => {
                const at = data.categories.length;
                const label = nextChartCategoryLabel(
                  data,
                  t('chart.sample.category', { number: at + 1 })
                );
                if (run({ type: 'addCategory', label }))
                  focusLater(`.docx-chart-pane__list [data-row="${at}"]`, true);
              }}
            >
              {t('chart.data.addCategory')}
            </button>
          </section>
          <section className="docx-chart-pane__section">
            <h3 className="docx-chart-pane__title">{t('chart.data.series')}</h3>
            {data.series.map((series, j) => {
              const name = series.name || t('chart.data.unnamed');
              return (
                <details
                  key={j}
                  className="docx-chart-pane__card"
                  open={open.has(j)}
                  onToggle={(e) => toggle(j, e.currentTarget.open)}
                >
                  <summary className="docx-chart-pane__summary" data-series={j}>
                    {name}
                  </summary>
                  <div className="docx-chart-pane__card-body">
                    <ChartField
                      draftKey={draftKey}
                      label={t('chart.data.seriesName', { number: j + 1 })}
                      visibleLabel={t('chart.data.name')}
                      value={series.name}
                      disabled={dataDisabled}
                      onCommit={(text) => apply({ type: 'seriesName', series: j, text })}
                    />
                    <div className="docx-chart-pane__pair">
                      {data.categories.map((c, i) => (
                        <ChartField
                          key={i}
                          draftKey={draftKey}
                          label={t('chart.data.cellLabel', { series: name, category: c.label })}
                          visibleLabel={c.label}
                          value={chartValueText(series.values[i])}
                          numeric
                          disabled={dataDisabled}
                          onCommit={(text) =>
                            apply({ type: 'value', series: j, category: i, text })
                          }
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="docx-dialog__button"
                      disabled={dataDisabled || data.series.length <= 1}
                      aria-label={t('chart.data.removeSeriesNamed', { name })}
                      onClick={() => {
                        const count = data.series.length;
                        if (run({ type: 'removeSeries', series: j }))
                          focusLater(
                            `.docx-chart-pane__summary[data-series="${chartRowFocusAfterRemove(j, count)}"]`
                          );
                      }}
                    >
                      {t('chart.data.removeSeries')}
                    </button>
                  </div>
                </details>
              );
            })}
            <button
              type="button"
              className="docx-dialog__button"
              disabled={dataDisabled}
              onClick={() => {
                const at = data.series.length;
                if (
                  run({ type: 'addSeries', name: t('chart.sample.series', { number: at + 1 }) })
                ) {
                  toggle(at, true);
                  // The new series' name, so the reader can name it at once.
                  focusLater(
                    `.docx-chart-pane__summary[data-series="${at}"] + .docx-chart-pane__card-body input`,
                    true
                  );
                }
              }}
            >
              {t('chart.data.addSeries')}
            </button>
          </section>
        </>
      ) : (
        <div className="docx-chart-pane__empty">
          <p className="docx-chart-pane__empty-title">{t('chart.pane.notEditableTitle')}</p>
          <p className="docx-chart-pane__empty-body">
            {reasonText(dataRead.ok ? null : dataRead.reason)}
          </p>
        </div>
      )}
    </div>
  );
}
