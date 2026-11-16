// Insert > Chart as a toolbar dropdown: the chart types of `CHART_INSERT_CHOICES`. A pick
// inserts the chart at the caret, selects it, and asks the host to show the Chart pane
// without the focus (`runToolbarCommand` on `insert.chart`).

import { defineComponent, ref, watch, type VNode } from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
import {
  CHART_INSERT_CHOICES,
  chartTypeIconPaths,
  chartTypeLabelKey,
  hostDocumentOf,
  isDomNode,
} from '@docx-editor.dev/core/editor';
import type { ChartType } from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useStableDocxId } from '../../lib/stable-id';
import { useEditorValueCommand } from '../useEditorValueCommand';
import { useToolbarLabel } from '../toolbar/toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { Slot } from '../toolbar/Slot';
import { panelRowContent, triggerClassName, usePanelRow } from '../toolbar/panel-row';

/** Props for `DocxEditor.Toolbar.ChartInsert`. @public */
export interface ChartInsertProps {
  className?: string;
  hidden?: boolean;
  asChild?: boolean;
  /** The default slot: the trigger content, or the trigger itself with `asChild`. */
  children?: DocxEditorChildren;
}

/** The Insert chart dropdown: one item for each chart type. @public */
export const ChartInsert = defineComponent({
  name: 'ChartInsert',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
    asChild: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const { t } = useTranslation();
    const label = useToolbarLabel();
    const isPanelRow = usePanelRow();
    const command = useEditorValueCommand('insert.chart');
    const open = ref(false);
    const rootRef = ref<HTMLDivElement | null>(null);
    const triggerRef = ref<HTMLButtonElement | null>(null);
    const menuId = useStableDocxId('chart-insert');

    watch(open, (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      const onMouseDown = (event: MouseEvent) => {
        const root = rootRef.value;
        if (root && isDomNode(event.target) && root.contains(event.target)) return;
        open.value = false;
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        open.value = false;
        triggerRef.value?.focus();
      };
      const doc = hostDocumentOf(rootRef.value);
      doc.addEventListener('mousedown', onMouseDown, true);
      doc.addEventListener('keydown', onKeyDown);
      onCleanup(() => {
        doc.removeEventListener('mousedown', onMouseDown, true);
        doc.removeEventListener('keydown', onKeyDown);
      });
    });

    const choose = (type: ChartType) => {
      open.value = false;
      command.execute(type);
    };

    return () => {
      if (props.hidden) return null;
      const control = chromeControlForSlot('insert.chart');
      const text = label(control?.labelKey ?? 'chart.insert');
      const panelRow = isPanelRow(props.asChild, !!slots.default);
      const shared = {
        type: 'button' as const,
        ref: triggerRef,
        class: `${triggerClassName(panelRow)} docx-toolbar__chart-insert-trigger${props.className ? ` ${props.className}` : ''}`,
        'data-slot': 'insert.chart',
        disabled: !command.isEnabled.value,
        ...(!command.isEnabled.value ? { 'data-disabled': '' } : {}),
        'aria-haspopup': 'menu' as const,
        'aria-expanded': open.value,
        'aria-controls': open.value ? menuId : undefined,
        'aria-label': text,
        title: command.disabledReason.value ?? text,
        onMousedown: guardToolbarMousedown,
        onClick: () => {
          open.value = !open.value;
        },
      };
      return (
        <div ref={rootRef} class="docx-toolbar__chart-insert">
          {props.asChild ? (
            <Slot {...shared}>{{ default: () => slots.default?.() }}</Slot>
          ) : (
            <button {...shared}>
              {panelRow
                ? panelRowContent(chromeIcon(control?.paths), text)
                : (slots.default?.() ?? chromeIcon(control?.paths))}
            </button>
          )}
          {open.value ? (
            <div
              id={menuId}
              role="menu"
              class="docx-toolbar__image-wrap-menu docx-toolbar__chart-insert-menu"
              aria-label={text}
              onMousedown={(event: MouseEvent) => event.stopPropagation()}
            >
              {CHART_INSERT_CHOICES.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="menuitem"
                  class="docx-toolbar__image-wrap-item"
                  data-value={type}
                  aria-label={t('chart.insertType', { type: t(chartTypeLabelKey(type)) })}
                  onMousedown={guardToolbarMousedown}
                  onClick={() => choose(type)}
                >
                  {chromeIcon(chartTypeIconPaths(type))}
                  <span>{t(chartTypeLabelKey(type))}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      );
    };
  },
});
(ChartInsert as { docxSlot?: string }).docxSlot = 'insert.chart';

/** @public */
export interface ChartInsertPartComponent {
  (props: ChartInsertProps): VNode | null;
  readonly docxSlot: 'insert.chart';
}

/** @public */
export const ToolbarChartInsert = Object.assign(ChartInsert, {
  docxSlot: 'insert.chart' as const,
}) as unknown as ChartInsertPartComponent;
