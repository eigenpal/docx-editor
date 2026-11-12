// `DocxEditor.ShapePane`: the fill and the outline of the selected shape, text box, line, or
// group. Format shape moves the focus to its first field, wherever the host shows the pane. A
// picked color applies at once, and a typed field when the user presses Enter or leaves it, each
// as one undo step. A gradient, pattern, or picture fill shows by name; a picked color or No
// fill replaces it. The checks and the commands come from core (`shape-pane.ts`), so the Vue
// twin (`packages/vue/src/editor/shapes/ShapePane.tsx`) checks the same input with the same keys
// and renders the same markup.

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  SHAPE_OUTLINE_WIDTHS,
  chartThemeHexes,
  focusChartPane,
  listenPaneRequests,
  shapeFillEditable,
  shapeFillLabelKey,
  shapeFillSummary,
  shapeHexText,
  shapeOutlineSummary,
  shapeTransparencyText,
  shapeWidthText,
  takePaneRequestFor,
  type ChartColorPick,
  type ShapePaneChange,
} from '@docx-editor.dev/core/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
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
export function DocxEditorShapePane({ className }: DocxEditorShapePaneProps): ReactElement {
  const { t } = useTranslation();
  const translate = useChartTranslate();
  const editor = useDocxEditor();
  const shape = useSelectedShape();
  const root = useRef<HTMLDivElement>(null);
  const ids = useId();
  const [refusal, setRefusal] = useState<string | null>(null);
  // Format shape asks for the focus. A host that mounts the pane for the request mounts it
  // after the request, so the pane takes a pending one when it mounts.
  useEffect(() => {
    if (!editor) return undefined;
    if (takePaneRequestFor(editor, 'shape')?.focus) focusChartPane(root.current);
    return listenPaneRequests(editor, () => {
      if (takePaneRequestFor(editor, 'shape')?.focus)
        queueMicrotask(() => focusChartPane(root.current));
    });
  }, [editor]);
  // A refusal belongs to the shape it was about.
  const [refusalShape, setRefusalShape] = useState(shape.drawingNodeId);
  if (refusalShape !== shape.drawingNodeId) {
    setRefusalShape(shape.drawingNodeId);
    setRefusal(null);
  }
  const classes = `docx-chart-pane docx-shape-pane${className ? ` ${className}` : ''}`;
  const { format, drawingNodeId } = shape;
  if (!format || !drawingNodeId)
    return (
      <div className={classes} ref={root} data-shape="">
        <div className="docx-chart-pane__empty">
          <p className="docx-chart-pane__empty-title">{t('shape.pane.emptyTitle')}</p>
          <p className="docx-chart-pane__empty-body">{t('shape.pane.emptyBody')}</p>
        </div>
      </div>
    );
  const themeHexes = chartThemeHexes(editor?.getDocumentThemeColors());
  /** Applies one change: null when it applied, else the translated reason. */
  const apply = (change: ShapePaneChange): string | null => {
    const result = shape.edit(change);
    return result.ok ? null : (localizeDisabledReason(result.reason, t) ?? '');
  };
  /** Applies a picked color; the pane announces a refusal, as no field shows it. */
  const run = (change: ShapePaneChange): void => setRefusal(apply(change));
  const { fill, outline } = format;
  const fillReasonId = `${ids}-fill-reason`;
  const outlineReasonId = `${ids}-outline-reason`;
  const hexHelpId = `${ids}-hex-help`;
  const fillDisabled = !shape.canEditFill;
  const outlineDisabled = !shape.canEditOutline;
  const widthText = outline.visible === false ? '' : shapeWidthText(outline.widthPt);
  const widthOptions = SHAPE_OUTLINE_WIDTHS.map(
    (value) => [String(value), t('shape.pane.widthPoints', { value })] as const
  );
  const fillPick = (pick: ChartColorPick | 'none'): void =>
    run(pick === 'none' ? { type: 'noFill' } : { type: 'fillColor', color: pick });
  const outlinePick = (pick: ChartColorPick | 'none'): void =>
    run(pick === 'none' ? { type: 'noOutline' } : { type: 'outlineColor', color: pick });
  return (
    <div className={classes} ref={root} data-shape={drawingNodeId}>
      <p className="docx-chart-pane__alert" role="alert">
        {refusal ?? ''}
      </p>
      <p className="docx-chart-pane__note" id={hexHelpId} hidden>
        {t('shape.pane.hexHelp')}
      </p>
      <section className="docx-chart-pane__section" aria-labelledby={`${ids}-fill`}>
        <h3 className="docx-chart-pane__title" id={`${ids}-fill`}>
          {t('shape.pane.fill')}
        </h3>
        {shapeFillEditable(fill) ? null : (
          <p className="docx-chart-pane__note" data-fill-type={fill.type}>
            {t('shape.pane.readOnlyFill', { fill: translate(shapeFillLabelKey(fill)) })}
          </p>
        )}
        <ShapeColorField
          label={t('shape.pane.fillColor')}
          openLabel={t('shape.pane.openFillColors')}
          noneLabel={t('shape.pane.noFill')}
          summary={shapeFillSummary(fill, themeHexes, translate)}
          color={fill.type === 'solid' ? fill.color : null}
          none={fill.type === 'none'}
          themeHexes={themeHexes}
          disabled={fillDisabled}
          {...(fillDisabled ? { describedBy: fillReasonId } : {})}
          onPick={fillPick}
        />
        <ChartField
          draftKey={drawingNodeId}
          label={t('shape.pane.fillHex')}
          visibleLabel={t('shape.pane.fillHex')}
          value={fill.type === 'solid' ? shapeHexText(fill.color) : ''}
          disabled={fillDisabled}
          describedBy={fillDisabled ? fillReasonId : hexHelpId}
          onCommit={(text) => apply({ type: 'fillColor', color: text })}
        />
        <ChartField
          draftKey={drawingNodeId}
          label={t('shape.pane.transparency')}
          visibleLabel={t('shape.pane.transparency')}
          value={shapeTransparencyText(fill)}
          numeric
          disabled={!shape.canEditTransparency}
          {...(shape.canEditTransparency ? {} : { describedBy: `${ids}-transparency-reason` })}
          onCommit={(text) => apply({ type: 'fillTransparency', text })}
        />
        {fillDisabled ? (
          <p className="docx-chart-pane__note" id={fillReasonId}>
            {shape.fillDisabledReason}
          </p>
        ) : null}
        {!fillDisabled && !shape.canEditTransparency ? (
          <p className="docx-chart-pane__note" id={`${ids}-transparency-reason`}>
            {shape.transparencyDisabledReason}
          </p>
        ) : null}
      </section>
      <section className="docx-chart-pane__section" aria-labelledby={`${ids}-outline`}>
        <h3 className="docx-chart-pane__title" id={`${ids}-outline`}>
          {t('shape.pane.outline')}
        </h3>
        <ShapeColorField
          label={t('shape.pane.outlineColor')}
          openLabel={t('shape.pane.openOutlineColors')}
          noneLabel={t('shape.pane.noOutline')}
          summary={shapeOutlineSummary(outline, themeHexes, translate)}
          color={outline.visible ? outline.color : null}
          none={outline.visible === false}
          themeHexes={themeHexes}
          disabled={outlineDisabled}
          {...(outlineDisabled ? { describedBy: outlineReasonId } : {})}
          onPick={outlinePick}
        />
        <ChartField
          draftKey={drawingNodeId}
          label={t('shape.pane.outlineHex')}
          visibleLabel={t('shape.pane.outlineHex')}
          value={outline.visible ? shapeHexText(outline.color) : ''}
          disabled={outlineDisabled}
          describedBy={outlineDisabled ? outlineReasonId : hexHelpId}
          onCommit={(text) => apply({ type: 'outlineColor', color: text })}
        />
        <div className="docx-chart-pane__pair">
          <ChartSelect
            label={t('shape.pane.widthPreset')}
            value={widthText}
            other={widthText ? t('shape.pane.otherWidth') : ''}
            options={widthOptions}
            disabled={outlineDisabled}
            onChange={(text) => run({ type: 'outlineWidth', text })}
          />
          <ChartField
            draftKey={drawingNodeId}
            label={t('shape.pane.width')}
            visibleLabel={t('shape.pane.width')}
            value={widthText}
            numeric
            disabled={outlineDisabled}
            {...(outlineDisabled ? { describedBy: outlineReasonId } : {})}
            onCommit={(text) => apply({ type: 'outlineWidth', text })}
          />
        </div>
        {outline.visible === null ? (
          <p className="docx-chart-pane__note">{t('shape.pane.mixedOutline')}</p>
        ) : null}
        {outlineDisabled ? (
          <p className="docx-chart-pane__note" id={outlineReasonId}>
            {shape.outlineDisabledReason}
          </p>
        ) : null}
      </section>
    </div>
  );
}
