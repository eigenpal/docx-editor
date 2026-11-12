// `ChartDataPart`: the data editor of the selected chart (`chart.data`): the categories (or X values)
// and one card per series with its name and a value for each category. A field applies on Enter
// or blur, and each add or remove applies at once, each as one undo step. The checks come from
// core (`chartPaneCommand`). The React twin is
// `packages/react/src/editor/objects/chart-data-part.tsx`; both render the same markup.

import { defineComponent, onUpdated, ref, shallowRef } from 'vue';
import {
  chartPaneDraftContinues,
  chartPaneDraftKey,
  chartRowFocusAfterRemove,
  chartValueText,
  nextChartCategoryLabel,
  type ChartPaneChange,
} from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { chromeIcon } from '../toolbar/ToolbarButton';
import { DELETE_PATHS } from '../contextmenu/contextmenu-icons';
import { ChartField } from '../charts/chart-fields';
import { useSelectedChart } from '../charts/useSelectedChart';
import { objectControlProps, useObjectControl } from './object-controls';

/** The categories and series of the selected chart, or why they cannot change. @public */
export const ChartDataPart = defineComponent({
  name: 'ChartDataPart',
  props: objectControlProps,
  setup(props) {
    const { t } = useTranslation();
    const selected = useSelectedChart();
    const control = useObjectControl('chart.data');
    const root = ref<HTMLDivElement | null>(null);
    const refusal = ref<string | null>(null);
    const open = shallowRef<ReadonlySet<number>>(new Set([0]));
    let draftScope = { key: '', reset: 0 };
    // The focus moves after the part renders the changed chart, as the row it names is new.
    // `selectText` selects a new row's sample name, so the reader types the real one over it.
    let pendingFocus: { selector: string; selectText: boolean } | null = null;
    const focusLater = (selector: string, selectText = false): void => {
      pendingFocus = { selector, selectText };
    };
    onUpdated(() => {
      const request = pendingFocus;
      const target = request ? root.value?.querySelector<HTMLElement>(request.selector) : null;
      if (!request || !target) return;
      pendingFocus = null;
      target.focus();
      if (request.selectText && 'select' in target) (target as HTMLInputElement).select();
    });
    const toggle = (index: number, isOpen: boolean): void => {
      if (open.value.has(index) === isOpen) return;
      const next = new Set(open.value);
      if (isOpen) next.add(index);
      else next.delete(index);
      open.value = next;
    };
    return () => {
      const data = selected.data.value;
      const chart = selected.chart.value;
      const id = chart?.drawingNodeId ?? '';
      const scopeKey = data ? chartPaneDraftKey(id, data) : id;
      if (scopeKey !== draftScope.key)
        draftScope = {
          key: scopeKey,
          reset:
            draftScope.reset +
            (draftScope.key && data && chartPaneDraftContinues(draftScope.key, scopeKey) ? 0 : 1),
        };
      if (props.hidden) return null;
      if (!chart) return null;
      if (!data)
        return (
          <div class="docx-chart-pane__empty">
            <p class="docx-chart-pane__empty-title">{t('chart.pane.notEditableTitle')}</p>
            <p class="docx-chart-pane__empty-body">{selected.readReason.value ?? ''}</p>
          </div>
        );
      const draftKey = String(draftScope.reset);
      const disabled = !control.isEnabled.value;
      const xy = data.kind === 'xy';
      /** Applies one change: null when it applied, else the reason. */
      const apply = (change: ChartPaneChange): string | null => {
        const reason = control.apply(change);
        if (reason === null) refusal.value = null;
        return reason;
      };
      /** Applies an add or a remove; the part announces a refusal, as no field shows it. */
      const run = (change: ChartPaneChange): boolean => {
        const reason = control.apply(change);
        refusal.value = reason;
        return reason === null;
      };
      const workbookNote =
        data.workbook === 'kept'
          ? t('chart.data.workbookKept')
          : data.workbook === 'external'
            ? t('chart.data.workbookExternal')
            : null;
      return (
        <div
          ref={root}
          class={`docx-object-control docx-object-control--field docx-chart-data${props.className ? ` ${props.className}` : ''}`}
          data-slot="chart.data"
        >
          <p class="docx-chart-pane__alert" role="alert">
            {refusal.value ?? ''}
          </p>
          {disabled && control.disabledReason.value ? (
            <p class="docx-chart-pane__note">{control.disabledReason.value}</p>
          ) : null}
          <section class="docx-chart-pane__section">
            <h3 class="docx-chart-pane__title">
              {t(xy ? 'chart.data.xValues' : 'chart.data.categories')}
            </h3>
            <p class="docx-chart-pane__note">{t('chart.data.help')}</p>
            {workbookNote ? <p class="docx-chart-pane__note">{workbookNote}</p> : null}
            <ul class="docx-chart-pane__list">
              {data.categories.map((c, i) => (
                <li key={i} class="docx-chart-pane__row">
                  <ChartField
                    draftKey={draftKey}
                    label={t(xy ? 'chart.data.xValueLabel' : 'chart.data.categoryLabel', {
                      number: i + 1,
                    })}
                    value={c.label}
                    numeric={xy}
                    row={i}
                    disabled={disabled}
                    onCommit={(text: string) => apply({ type: 'label', category: i, text })}
                  />
                  <button
                    type="button"
                    class="docx-chart-pane__icon-button"
                    aria-label={t('chart.data.removeCategoryNamed', { name: c.label })}
                    title={t('chart.data.removeCategoryNamed', { name: c.label })}
                    disabled={disabled || data.categories.length <= 1}
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
              class="docx-dialog__button"
              disabled={disabled}
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
          <section class="docx-chart-pane__section">
            <h3 class="docx-chart-pane__title">{t('chart.data.series')}</h3>
            {data.series.map((series, j) => {
              const name = series.name || t('chart.data.unnamed');
              return (
                <details
                  key={j}
                  class="docx-chart-pane__card"
                  open={open.value.has(j)}
                  onToggle={(e: Event) => toggle(j, (e.currentTarget as HTMLDetailsElement).open)}
                >
                  <summary class="docx-chart-pane__summary" data-series={j}>
                    {name}
                  </summary>
                  <div class="docx-chart-pane__card-body">
                    <ChartField
                      draftKey={draftKey}
                      label={t('chart.data.seriesName', { number: j + 1 })}
                      visibleLabel={t('chart.data.name')}
                      value={series.name}
                      disabled={disabled}
                      onCommit={(text: string) => apply({ type: 'seriesName', series: j, text })}
                    />
                    <div class="docx-chart-pane__pair">
                      {data.categories.map((c, i) => (
                        <ChartField
                          key={i}
                          draftKey={draftKey}
                          label={t('chart.data.cellLabel', { series: name, category: c.label })}
                          visibleLabel={c.label}
                          value={chartValueText(series.values[i])}
                          numeric
                          disabled={disabled}
                          onCommit={(text: string) =>
                            apply({ type: 'value', series: j, category: i, text })
                          }
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      class="docx-dialog__button"
                      disabled={disabled || data.series.length <= 1}
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
              class="docx-dialog__button"
              disabled={disabled}
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
        </div>
      );
    };
  },
});
