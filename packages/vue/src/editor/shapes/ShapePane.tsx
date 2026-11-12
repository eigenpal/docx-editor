// `DocxEditor.ShapePane`: the fill and the outline of the selected shape, text box, line, or
// group, the Vue twin of `packages/react/src/editor/shapes/ShapePane.tsx`. Format shape moves the
// focus to its first field, wherever the host shows the pane. A picked color applies at once, and
// a typed field when the user presses Enter or leaves it, each as one undo step. The checks and
// the commands come from core (`shape-pane.ts`); both panes render the same markup.

import { defineComponent, nextTick, ref, watch } from 'vue';
import {
  SHAPE_OUTLINE_WIDTHS,
  chartThemeHexes,
  focusChartPane,
  listenPaneRequests,
  shapeFillEditable,
  shapeFillLabelKey,
  shapeFillPick,
  shapeFillSummary,
  shapeHexText,
  shapeOutlinePick,
  shapeOutlineSummary,
  shapeTransparencyText,
  shapeWidthText,
  takePaneRequestFor,
  type ChartColorPick,
  type ShapePaneChange,
} from '@docx-editor.dev/core/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
import { useStableDocxId } from '../../lib/stable-id';
import { useDocxEditor } from '../context';
import { ChartField, ChartSelect, useChartTranslate } from '../charts/chart-fields';
import { ShapeColorField } from './ShapeColorField';
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
    const translate = useChartTranslate();
    const editorRef = useDocxEditor();
    const shape = useSelectedShape();
    const root = ref<HTMLDivElement | null>(null);
    const ids = useStableDocxId('shape-pane');
    const refusal = ref<string | null>(null);
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
    // A refusal belongs to the shape it was about.
    watch(shape.drawingNodeId, () => {
      refusal.value = null;
    });
    /** Applies one change: null when it applied, else the translated reason. */
    const apply = (change: ShapePaneChange): string | null => {
      const result = shape.edit(change);
      return result.ok ? null : (localizeDisabledReason(result.reason, t) ?? '');
    };
    /** Applies a picked color; the pane announces a refusal, as no field shows it. */
    const run = (change: ShapePaneChange): void => {
      refusal.value = apply(change);
    };
    const fillPick = (pick: ChartColorPick | 'none'): void =>
      run(pick === 'none' ? { type: 'noFill' } : { type: 'fillColor', color: pick });
    const outlinePick = (pick: ChartColorPick | 'none'): void =>
      run(pick === 'none' ? { type: 'noOutline' } : { type: 'outlineColor', color: pick });

    return () => {
      const classes = ['docx-chart-pane', 'docx-shape-pane', props.className]
        .filter(Boolean)
        .join(' ');
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
      const themeHexes = chartThemeHexes(editorRef.value?.getDocumentThemeColors());
      const { fill, outline } = format;
      const fillReasonId = `${ids}-fill-reason`;
      const outlineReasonId = `${ids}-outline-reason`;
      const transparencyReasonId = `${ids}-transparency-reason`;
      const hexHelpId = `${ids}-hex-help`;
      const fillDisabled = !shape.canEditFill.value;
      const outlineDisabled = !shape.canEditOutline.value;
      const canEditTransparency = shape.canEditTransparency.value;
      const widthText = outline.visible === false ? '' : shapeWidthText(outline.widthPt);
      const widthOptions = SHAPE_OUTLINE_WIDTHS.map(
        (value) => [String(value), t('shape.pane.widthPoints', { value })] as const
      );
      return (
        <div class={classes} ref={root} data-shape={drawingNodeId}>
          <p class="docx-chart-pane__alert" role="alert">
            {refusal.value ?? ''}
          </p>
          <p class="docx-chart-pane__note" id={hexHelpId} hidden>
            {t('shape.pane.hexHelp')}
          </p>
          <section class="docx-chart-pane__section" aria-labelledby={`${ids}-fill`}>
            <h3 class="docx-chart-pane__title" id={`${ids}-fill`}>
              {t('shape.pane.fill')}
            </h3>
            {shapeFillEditable(fill) ? null : (
              <p class="docx-chart-pane__note" data-fill-type={fill.type}>
                {t('shape.pane.readOnlyFill', { fill: translate(shapeFillLabelKey(fill)) })}
              </p>
            )}
            <ShapeColorField
              label={t('shape.pane.fillColor')}
              openLabel={t('shape.pane.openFillColors')}
              noneLabel={t('shape.pane.noFill')}
              summary={shapeFillSummary(fill, themeHexes, translate)}
              color={fill.type === 'solid' ? fill.color : null}
              current={shapeFillPick(fill, themeHexes)}
              none={fill.type === 'none'}
              themeHexes={themeHexes}
              disabled={fillDisabled}
              describedBy={fillDisabled ? fillReasonId : undefined}
              onPick={fillPick}
            />
            <ChartField
              draftKey={drawingNodeId}
              label={t('shape.pane.fillHex')}
              visibleLabel={t('shape.pane.fillHex')}
              value={fill.type === 'solid' ? shapeHexText(fill.color) : ''}
              disabled={fillDisabled}
              describedBy={fillDisabled ? fillReasonId : hexHelpId}
              onCommit={(text: string) => apply({ type: 'fillColor', color: text })}
            />
            <ChartField
              draftKey={drawingNodeId}
              label={t('shape.pane.transparency')}
              visibleLabel={t('shape.pane.transparency')}
              value={shapeTransparencyText(fill)}
              numeric
              disabled={!canEditTransparency}
              describedBy={canEditTransparency ? undefined : transparencyReasonId}
              onCommit={(text: string) => apply({ type: 'fillTransparency', text })}
            />
            {fillDisabled ? (
              <p class="docx-chart-pane__note" id={fillReasonId}>
                {shape.fillDisabledReason.value}
              </p>
            ) : null}
            {!fillDisabled && !canEditTransparency ? (
              <p class="docx-chart-pane__note" id={transparencyReasonId}>
                {shape.transparencyDisabledReason.value}
              </p>
            ) : null}
          </section>
          <section class="docx-chart-pane__section" aria-labelledby={`${ids}-outline`}>
            <h3 class="docx-chart-pane__title" id={`${ids}-outline`}>
              {t('shape.pane.outline')}
            </h3>
            <ShapeColorField
              label={t('shape.pane.outlineColor')}
              openLabel={t('shape.pane.openOutlineColors')}
              noneLabel={t('shape.pane.noOutline')}
              summary={shapeOutlineSummary(outline, themeHexes, translate)}
              color={outline.visible ? outline.color : null}
              current={shapeOutlinePick(outline, themeHexes)}
              none={outline.visible === false}
              themeHexes={themeHexes}
              disabled={outlineDisabled}
              describedBy={outlineDisabled ? outlineReasonId : undefined}
              onPick={outlinePick}
            />
            <ChartField
              draftKey={drawingNodeId}
              label={t('shape.pane.outlineHex')}
              visibleLabel={t('shape.pane.outlineHex')}
              value={outline.visible ? shapeHexText(outline.color) : ''}
              disabled={outlineDisabled}
              describedBy={outlineDisabled ? outlineReasonId : hexHelpId}
              onCommit={(text: string) => apply({ type: 'outlineColor', color: text })}
            />
            <div class="docx-chart-pane__pair">
              <ChartSelect
                label={t('shape.pane.widthPreset')}
                value={widthText}
                other={widthText ? t('shape.pane.otherWidth') : ''}
                options={widthOptions}
                disabled={outlineDisabled}
                onChange={(text: string) => run({ type: 'outlineWidth', text })}
              />
              <ChartField
                draftKey={drawingNodeId}
                label={t('shape.pane.width')}
                visibleLabel={t('shape.pane.width')}
                value={widthText}
                numeric
                disabled={outlineDisabled}
                describedBy={outlineDisabled ? outlineReasonId : undefined}
                onCommit={(text: string) => apply({ type: 'outlineWidth', text })}
              />
            </div>
            {outline.visible === null ? (
              <p class="docx-chart-pane__note">{t('shape.pane.mixedOutline')}</p>
            ) : null}
            {outlineDisabled ? (
              <p class="docx-chart-pane__note" id={outlineReasonId}>
                {shape.outlineDisabledReason.value}
              </p>
            ) : null}
          </section>
        </div>
      );
    };
  },
});
