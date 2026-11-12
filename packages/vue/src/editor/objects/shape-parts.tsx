// The shape parts: one exported control for each `shape.*` slot. Each works alone, in a host's
// toolbar, popover, drawer, or pane, and `DocxEditor.ShapePane` is an arrangement of them
// (`PANE_SECTIONS.shape`). The React twin is `packages/react/src/editor/objects/shape-parts.tsx`.

import { defineComponent } from 'vue';
import {
  SHAPE_OUTLINE_DASHES,
  SHAPE_OUTLINE_WIDTHS,
  documentThemeHexes,
  shapeDashLabelKey,
  shapeFillEditable,
  shapeFillLabelKey,
  shapeFillSummary,
  shapeOutlineSummary,
} from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useChartTranslate } from '../charts/chart-fields';
import { useSelectedShape } from '../shapes/useSelectedShape';
import {
  ChoiceControl,
  ColorControl,
  TextControl,
  objectControlProps,
  type ObjectControlProps,
} from './object-controls';

/** Props of a shape part. @public */
export type ShapePartProps = ObjectControlProps;

/** The props a part passes on to its control. */
const passOn = (props: ObjectControlProps) => ({
  className: props.className,
  label: props.label,
  variant: props.variant,
  hidden: props.hidden,
});

/** The fill colour of the selected shape (`shape.fill`), with No fill. @public */
export const ShapeFill = defineComponent({
  name: 'ShapeFill',
  props: objectControlProps,
  setup(props) {
    const { t } = useTranslation();
    const translate = useChartTranslate();
    const editorRef = useDocxEditor();
    const shape = useSelectedShape();
    return () => {
      const hexes = documentThemeHexes(editorRef.value?.getDocumentThemeColors());
      const fill = shape.format.value?.fill;
      const summary = fill ? shapeFillSummary(fill, hexes, translate) : '';
      return (
        <ColorControl
          {...passOn(props)}
          slotId="shape.fill"
          summary={summary}
          noneLabel={t('shape.pane.noFill')}
          after={
            fill && !shapeFillEditable(fill) ? (
              <p class="docx-chart-pane__note" data-fill-type={fill.type}>
                {t('shape.pane.readOnlyFill', { fill: translate(shapeFillLabelKey(fill)) })}
              </p>
            ) : null
          }
        />
      );
    };
  },
});

/** The transparency of a solid fill, in percent (`shape.fillTransparency`). @public */
export const ShapeFillTransparency = defineComponent({
  name: 'ShapeFillTransparency',
  props: objectControlProps,
  setup(props) {
    const shape = useSelectedShape();
    return () => (
      <TextControl
        {...passOn(props)}
        slotId="shape.fillTransparency"
        numeric
        draftKey={shape.memberId.value ?? shape.drawingNodeId.value ?? ''}
        parse={(text: string) => text}
      />
    );
  },
});

/** The outline colour of the selected shape (`shape.outlineColor`), with No line. @public */
export const ShapeOutlineColor = defineComponent({
  name: 'ShapeOutlineColor',
  props: objectControlProps,
  setup(props) {
    const { t } = useTranslation();
    const translate = useChartTranslate();
    const editorRef = useDocxEditor();
    const shape = useSelectedShape();
    return () => {
      const hexes = documentThemeHexes(editorRef.value?.getDocumentThemeColors());
      const format = shape.format.value;
      const summary = format ? shapeOutlineSummary(format.outline, hexes, translate) : '';
      return (
        <ColorControl
          {...passOn(props)}
          slotId="shape.outlineColor"
          summary={summary}
          noneLabel={t('shape.pane.noOutline')}
        />
      );
    };
  },
});

/**
 * The outline width in points (`shape.outlineWidth`): a list of preset widths, and in a field
 * a number box for any other width. @public
 */
export const ShapeOutlineWidth = defineComponent({
  name: 'ShapeOutlineWidth',
  props: objectControlProps,
  setup(props) {
    const { t } = useTranslation();
    const shape = useSelectedShape();
    return () => {
      if (props.hidden) return null;
      const compact = props.variant === 'compact';
      const widthPt = shape.format.value?.outline.widthPt;
      const options = SHAPE_OUTLINE_WIDTHS.map(
        (value) => [String(value), t('shape.pane.widthPoints', { value })] as const
      );
      const list = (
        <ChoiceControl
          {...passOn(props)}
          label={compact ? props.label : t('shape.pane.widthPreset')}
          slotId="shape.outlineWidth"
          options={options}
          other={
            compact && typeof widthPt === 'number'
              ? t('shape.pane.widthPoints', { value: Math.round(widthPt * 100) / 100 })
              : t('shape.pane.otherWidth')
          }
          parse={Number}
        />
      );
      if (compact) return list;
      return (
        <div class="docx-chart-pane__pair">
          {list}
          <TextControl
            slotId="shape.outlineWidth"
            label={props.label}
            numeric
            draftKey={shape.memberId.value ?? shape.drawingNodeId.value ?? ''}
            parse={(text: string) => text}
          />
        </div>
      );
    };
  },
});

/** The outline dash (`shape.outlineDash`): solid, dotted, or dashed. @public */
export const ShapeOutlineDashPart = defineComponent({
  name: 'ShapeOutlineDashPart',
  props: objectControlProps,
  setup(props) {
    const { t } = useTranslation();
    const translate = useChartTranslate();
    const shape = useSelectedShape();
    return () => {
      const options = SHAPE_OUTLINE_DASHES.map(
        (dash) => [dash, translate(shapeDashLabelKey(dash))] as const
      );
      return (
        <ChoiceControl
          {...passOn(props)}
          slotId="shape.outlineDash"
          options={options}
          other={
            shape.format.value?.outline.dash === 'custom'
              ? t('shape.pane.dashes.custom')
              : t('shape.pane.fillTypes.mixed')
          }
        />
      );
    };
  },
});
