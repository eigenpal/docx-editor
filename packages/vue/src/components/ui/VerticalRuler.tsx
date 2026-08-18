import { defineComponent, ref, watch, type CSSProperties, type PropType, type VNode } from 'vue';
import type { RulerPageSetup } from './HorizontalRuler';
import { twipsToPixels, pixelsToTwips, formatPx } from '../../lib/units';
import { useTranslation } from '../../i18n';

/** @public */
export interface VerticalRulerProps {
  pageSetup?: RulerPageSetup | null;
  zoom?: number;
  editable?: boolean;
  onTopMarginChange?: (marginTwips: number) => void;
  onBottomMarginChange?: (marginTwips: number) => void;
  onMarginDragEnd?: () => void;
  unit?: 'inch' | 'cm';
  className?: string;
  style?: CSSProperties;
}

type MarkerType = 'topMargin' | 'bottomMargin';

const DEFAULT_PAGE_HEIGHT_TWIPS = 15840;
const DEFAULT_MARGIN_TWIPS = 1440;
const TWIPS_PER_INCH = 1440;
const TWIPS_PER_CM = 567;

/** @public */
export const RULER_WIDTH = 20;
const RULER_TEXT_COLOR = 'var(--doc-text-muted)';
const RULER_TICK_COLOR = 'var(--doc-text-subtle)';
const MARKER_COLOR = 'var(--doc-primary)';
const MARKER_HOVER_COLOR = 'var(--doc-primary)';
const MARKER_ACTIVE_COLOR = 'var(--doc-primary-hover)';

/** @public */
export const VerticalRuler = defineComponent({
  name: 'VerticalRuler',
  props: {
    pageSetup: { type: null as unknown as PropType<RulerPageSetup | null>, default: null },
    zoom: { type: Number, default: 1 },
    editable: { type: Boolean, default: false },
    onTopMarginChange: {
      type: Function as PropType<(marginTwips: number) => void>,
      default: undefined,
    },
    onBottomMarginChange: {
      type: Function as PropType<(marginTwips: number) => void>,
      default: undefined,
    },
    onMarginDragEnd: { type: Function as PropType<() => void>, default: undefined },
    unit: { type: String as PropType<'inch' | 'cm'>, default: 'inch' },
    className: { type: String, default: '' },
    style: { type: null as unknown as PropType<CSSProperties>, default: undefined },
  },
  setup(props) {
    const { t } = useTranslation();
    const dragging = ref<MarkerType | null>(null);
    const hoveredMarker = ref<MarkerType | null>(null);
    const rulerRef = ref<HTMLDivElement | null>(null);

    const handleDragStart = (event: MouseEvent, marker: MarkerType) => {
      if (!props.editable) return;
      event.preventDefault();
      dragging.value = marker;
    };

    const handleDrag = (event: MouseEvent) => {
      const current = dragging.value;
      const ruler = rulerRef.value;
      if (!current || !ruler) return;
      const pageHeightTwips = props.pageSetup?.pageHeightTwips ?? DEFAULT_PAGE_HEIGHT_TWIPS;
      const topMarginTwips = props.pageSetup?.marginsTwips.top ?? DEFAULT_MARGIN_TWIPS;
      const bottomMarginTwips = props.pageSetup?.marginsTwips.bottom ?? DEFAULT_MARGIN_TWIPS;
      const rect = ruler.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const positionTwips = pixelsToTwips(y / (props.zoom ?? 1));
      if (current === 'topMargin') {
        const maxMargin = pageHeightTwips - bottomMarginTwips - 720;
        const newMargin = Math.max(0, Math.min(positionTwips, maxMargin));
        props.onTopMarginChange?.(Math.round(newMargin));
      } else if (current === 'bottomMargin') {
        const fromBottom = pageHeightTwips - positionTwips;
        const maxMargin = pageHeightTwips - topMarginTwips - 720;
        const newMargin = Math.max(0, Math.min(fromBottom, maxMargin));
        props.onBottomMarginChange?.(Math.round(newMargin));
      }
    };

    const handleDragEnd = () => {
      if (dragging.value !== null) props.onMarginDragEnd?.();
      dragging.value = null;
    };

    watch(dragging, (current, _, onCleanup) => {
      if (!current) return;
      document.addEventListener('mousemove', handleDrag);
      document.addEventListener('mouseup', handleDragEnd);
      onCleanup(() => {
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', handleDragEnd);
      });
    });

    return () => {
      const pageHeightTwips = props.pageSetup?.pageHeightTwips ?? DEFAULT_PAGE_HEIGHT_TWIPS;
      const topMarginTwips = props.pageSetup?.marginsTwips.top ?? DEFAULT_MARGIN_TWIPS;
      const bottomMarginTwips = props.pageSetup?.marginsTwips.bottom ?? DEFAULT_MARGIN_TWIPS;
      const zoom = props.zoom ?? 1;
      const pageHeightPx = twipsToPixels(pageHeightTwips) * zoom;
      const topMarginPx = twipsToPixels(topMarginTwips) * zoom;
      const bottomMarginPx = twipsToPixels(bottomMarginTwips) * zoom;
      const ticks = generateVerticalTicks(pageHeightTwips, zoom, props.unit ?? 'inch');
      const rulerStyle: CSSProperties = {
        position: 'relative',
        width: RULER_WIDTH,
        height: formatPx(pageHeightPx),
        backgroundColor: 'transparent',
        overflow: 'visible',
        userSelect: 'none',
        cursor: dragging.value ? 'ns-resize' : 'default',
        ...props.style,
      };

      return (
        <div
          ref={rulerRef}
          class={`docx-vertical-ruler ${props.className ?? ''}`}
          style={rulerStyle}
          role="slider"
          aria-label={t('ruler.vertical')}
          aria-orientation="vertical"
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              pointerEvents: 'none',
            }}
          >
            {ticks.map((tick, index) => (
              <VerticalTick key={index} tick={tick} />
            ))}
          </div>
          <VerticalMarginMarker
            type="topMargin"
            position={topMarginPx}
            editable={props.editable ?? false}
            isDragging={dragging.value === 'topMargin'}
            isHovered={hoveredMarker.value === 'topMargin'}
            onMouseenter={() => {
              hoveredMarker.value = 'topMargin';
            }}
            onMouseleave={() => {
              hoveredMarker.value = null;
            }}
            onMousedown={(event) => handleDragStart(event, 'topMargin')}
          />
          <VerticalMarginMarker
            type="bottomMargin"
            position={pageHeightPx - bottomMarginPx}
            editable={props.editable ?? false}
            isDragging={dragging.value === 'bottomMargin'}
            isHovered={hoveredMarker.value === 'bottomMargin'}
            onMouseenter={() => {
              hoveredMarker.value = 'bottomMargin';
            }}
            onMouseleave={() => {
              hoveredMarker.value = null;
            }}
            onMousedown={(event) => handleDragStart(event, 'bottomMargin')}
          />
        </div>
      );
    };
  },
});

interface VerticalTickData {
  position: number;
  width: number;
  label?: string;
}

function VerticalTick(props: { tick: VerticalTickData }): VNode {
  const tickStyle: CSSProperties = {
    position: 'absolute',
    top: formatPx(props.tick.position),
    right: 0,
    height: 1,
    width: props.tick.width,
    backgroundColor: RULER_TICK_COLOR,
  };
  const labelStyle: CSSProperties = {
    position: 'absolute',
    top: formatPx(props.tick.position),
    left: 2,
    transform: 'translateY(-50%)',
    fontSize: '9px',
    color: RULER_TEXT_COLOR,
    fontFamily: 'sans-serif',
    whiteSpace: 'nowrap',
  };
  return (
    <>
      <div style={tickStyle} />
      {props.tick.label ? <div style={labelStyle}>{props.tick.label}</div> : null}
    </>
  );
}

function VerticalMarginMarker(props: {
  type: 'topMargin' | 'bottomMargin';
  position: number;
  editable: boolean;
  isDragging: boolean;
  isHovered: boolean;
  onMouseenter: () => void;
  onMouseleave: () => void;
  onMousedown: (event: MouseEvent) => void;
}): VNode {
  const { t } = useTranslation();
  const color = props.isDragging
    ? MARKER_ACTIVE_COLOR
    : props.isHovered
      ? MARKER_HOVER_COLOR
      : MARKER_COLOR;
  const markerStyle: CSSProperties = {
    position: 'absolute',
    top: formatPx(props.position - 5),
    right: 0,
    width: RULER_WIDTH,
    height: 10,
    cursor: props.editable ? 'ns-resize' : 'default',
    zIndex: props.isDragging ? 10 : 1,
  };
  const triangleStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    right: 2,
    width: 0,
    height: 0,
    borderTop: '5px solid transparent',
    borderBottom: '5px solid transparent',
    borderRight: `8px solid ${color}`,
    transition: 'border-right-color 0.1s',
  };
  return (
    <div
      class={`docx-ruler-marker docx-ruler-marker-${props.type}`}
      style={markerStyle}
      onMouseenter={props.onMouseenter}
      onMouseleave={props.onMouseleave}
      onMousedown={props.onMousedown}
      role="slider"
      aria-label={props.type === 'topMargin' ? t('ruler.topMargin') : t('ruler.bottomMargin')}
      aria-orientation="vertical"
      tabindex={props.editable ? 0 : -1}
    >
      <div style={triangleStyle} />
    </div>
  );
}

function generateVerticalTicks(
  pageHeightTwips: number,
  zoom: number,
  unit: 'inch' | 'cm'
): VerticalTickData[] {
  const ticks: VerticalTickData[] = [];
  if (unit === 'inch') {
    const eighthInchTwips = TWIPS_PER_INCH / 8;
    const totalEighths = Math.ceil(pageHeightTwips / eighthInchTwips);
    for (let i = 0; i <= totalEighths; i++) {
      const twipsPos = i * eighthInchTwips;
      if (twipsPos > pageHeightTwips) break;
      const pxPos = twipsToPixels(twipsPos) * zoom;
      if (i % 8 === 0) {
        const inches = i / 8;
        ticks.push({ position: pxPos, width: 10, label: inches > 0 ? String(inches) : undefined });
      } else if (i % 4 === 0) {
        ticks.push({ position: pxPos, width: 6 });
      } else if (i % 2 === 0) {
        ticks.push({ position: pxPos, width: 4 });
      } else {
        ticks.push({ position: pxPos, width: 2 });
      }
    }
  } else {
    const mmTwips = TWIPS_PER_CM / 10;
    const totalMm = Math.ceil(pageHeightTwips / mmTwips);
    for (let i = 0; i <= totalMm; i++) {
      const twipsPos = i * mmTwips;
      if (twipsPos > pageHeightTwips) break;
      const pxPos = twipsToPixels(twipsPos) * zoom;
      if (i % 10 === 0) {
        const cm = i / 10;
        ticks.push({ position: pxPos, width: 10, label: cm > 0 ? String(cm) : undefined });
      } else if (i % 5 === 0) {
        ticks.push({ position: pxPos, width: 6 });
      } else {
        ticks.push({ position: pxPos, width: 3 });
      }
    }
  }
  return ticks;
}

export default VerticalRuler;
