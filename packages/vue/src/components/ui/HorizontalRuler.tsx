/**
 * The horizontal ruler — page margins plus Word's four indent handles.
 *
 * Margins are the grey zones at either end; dragging the grey/white boundary moves them.
 *
 * The indent handles are Word's, not Google's three:
 *
 *   ▽  first line   at leftMargin + left + firstLine
 *   △  hanging      at leftMargin + left      — drags `left`, PINS the first-line marker
 *   ▭  left box     at leftMargin + left      — drags `left`, TAKES the first line with it
 *   △  right        at pageWidth - rightMargin - right
 *
 * The hanging triangle and the left box are coincident horizontally, as in Word, and are
 * separated vertically instead — the box sits below the strip. They differ only in what a
 * drag takes with them.
 *
 * All the arithmetic lives in the engine (`ruler-indent.ts`), including the snap grid and
 * the clamps, so this file only converts pixels to twips and paints.
 */

import { defineComponent, ref, type CSSProperties, type PropType, type VNode } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import {
  dragIndent,
  handlePosition,
  SNAP_TWIPS_CM,
  SNAP_TWIPS_INCH,
  type RulerIndent,
  type RulerIndentHandle,
  type RulerPageMetrics,
} from '@docx-editor.dev/core/editor';
import { twipsToPixels, pixelsToTwips, formatPx } from '../../lib/units';
import { useTranslation } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Section page setup as the engine reports it (`Editor.getPageSetup()`) —
 * page size, orientation, and margins, in twips. Derived from the contract.
 */
export type RulerPageSetup = NonNullable<ReturnType<Editor['getPageSetup']>>;

/**
 * A tab stop the ruler paints. `position` is twips from the left margin edge —
 * the same value the `removeTabMark` command takes as `positionTwips`.
 */
export interface RulerTabStop {
  position: number;
  alignment: 'left' | 'center' | 'right' | 'decimal' | 'bar';
}

export interface HorizontalRulerProps {
  pageSetup?: RulerPageSetup | null;
  zoom?: number;
  /** Whether the MARGIN handles drag. */
  editable?: boolean;
  onLeftMarginChange?: (marginTwips: number) => void;
  onRightMarginChange?: (marginTwips: number) => void;
  /** Fires when a margin drag is released — the moment to commit what the drag previewed. */
  onMarginDragEnd?: () => void;
  /**
   * Paint the four indent handles.
   *
   * Off by default so a ruler with no paragraph context does not show handles pinned at
   * zero. When on they are painted whatever `indentEditable` says: Word shows the markers
   * on a read-only document and simply refuses the drag, and hiding them would remove the
   * only place a reader can see a paragraph's indents.
   */
  showIndentHandles?: boolean;
  /** The paragraph's indent in twips; `firstLine` is SIGNED, negative for a hanging. */
  indent?: RulerIndent | null;
  /** Whether the INDENT handles drag — a different capability from `editable`. */
  indentEditable?: boolean;
  /** Fires continuously through an indent drag, for the host to preview. */
  onIndentChange?: (indent: RulerIndent) => void;
  /** Fires when an indent drag is released — the moment to commit one undoable step. */
  onIndentDragEnd?: () => void;
  unit?: 'inch' | 'cm';
  className?: string;
  style?: CSSProperties;
  tabMarks?: RulerTabStop[] | null;
  onTabMarkRemove?: (positionTwips: number) => void;
}

type MarkerType = 'leftMargin' | 'rightMargin' | RulerIndentHandle;

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_PAGE_WIDTH_TWIPS = 12240;
const DEFAULT_MARGIN_TWIPS = 1440;
const TWIPS_PER_INCH = 1440;
const TWIPS_PER_CM = 567;

/** The band carrying the grey margin zones, the ticks and the labels. */
const STRIP_HEIGHT = 20;
/** The left box hangs BELOW the strip, which is how it and the hanging triangle coexist. */
const BOX_HEIGHT = 6;
const RULER_HEIGHT = STRIP_HEIGHT + BOX_HEIGHT + 2;

const RULER_TEXT_COLOR = 'var(--doc-text-muted)';
const RULER_TICK_COLOR = 'var(--doc-text-subtle)';
const MARGIN_ZONE_COLOR = 'var(--doc-shadow-subtle)';
const INDENT_COLOR = 'var(--doc-primary)';
const INDENT_HOVER_COLOR = 'var(--doc-primary-hover)';
const INDENT_DISABLED_COLOR = 'var(--doc-text-subtle)';

const TRI_SIZE = 5; // triangle half-width in px
const TRI_HEIGHT = 7;

const FLUSH: RulerIndent = { left: 0, right: 0, firstLine: 0 };

// ============================================================================
// HELPERS
// ============================================================================

function formatValueForTooltip(twips: number, unit: 'inch' | 'cm'): string {
  if (unit === 'inch') return (twips / TWIPS_PER_INCH).toFixed(2) + '"';
  return (twips / TWIPS_PER_CM).toFixed(1) + ' cm';
}

/** The keyboard nudge: one grid step, or one twip with Shift for fine placement. */
function nudgeStep(unit: 'inch' | 'cm', fine: boolean): number {
  if (fine) return 1;
  return Math.round(unit === 'cm' ? SNAP_TWIPS_CM : SNAP_TWIPS_INCH);
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const HorizontalRuler = defineComponent({
  name: 'HorizontalRuler',
  props: {
    pageSetup: { type: null as unknown as PropType<RulerPageSetup | null>, default: null },
    zoom: { type: Number, default: 1 },
    editable: { type: Boolean, default: false },
    onLeftMarginChange: {
      type: Function as PropType<(marginTwips: number) => void>,
      default: undefined,
    },
    onRightMarginChange: {
      type: Function as PropType<(marginTwips: number) => void>,
      default: undefined,
    },
    onMarginDragEnd: { type: Function as PropType<() => void>, default: undefined },
    showIndentHandles: { type: Boolean, default: false },
    indent: { type: null as unknown as PropType<RulerIndent | null>, default: null },
    indentEditable: { type: Boolean, default: false },
    onIndentChange: {
      type: Function as PropType<(indent: RulerIndent) => void>,
      default: undefined,
    },
    onIndentDragEnd: { type: Function as PropType<() => void>, default: undefined },
    unit: { type: String as PropType<'inch' | 'cm'>, default: 'inch' },
    className: { type: String, default: '' },
    style: { type: null as unknown as PropType<CSSProperties>, default: undefined },
    tabMarks: { type: null as unknown as PropType<RulerTabStop[] | null>, default: null },
    onTabMarkRemove: {
      type: Function as PropType<(positionTwips: number) => void>,
      default: undefined,
    },
  },
  setup(props) {
    const { t } = useTranslation();
    const dragging = ref<MarkerType | null>(null);
    const hoveredMarker = ref<MarkerType | null>(null);
    const dragValue = ref<number | null>(null);
    const dragPositionPx = ref<number | null>(null);
    const rulerRef = ref<HTMLDivElement | null>(null);

    const pageWidthTwips = props.pageSetup?.pageWidthTwips ?? DEFAULT_PAGE_WIDTH_TWIPS;
    const leftMarginTwips = props.pageSetup?.marginsTwips.left ?? DEFAULT_MARGIN_TWIPS;
    const rightMarginTwips = props.pageSetup?.marginsTwips.right ?? DEFAULT_MARGIN_TWIPS;
    const gutterTwips = props.pageSetup?.gutterTwips ?? 0;

    const page: RulerPageMetrics = {
      pageWidth: pageWidthTwips,
      leftMargin: leftMarginTwips,
      rightMargin: rightMarginTwips,
    };
    const current = props.indent ?? FLUSH;

    const pageWidthPx = twipsToPixels(pageWidthTwips) * (props.zoom ?? 1);
    const leftMarginPx = twipsToPixels(leftMarginTwips) * (props.zoom ?? 1);
    const rightMarginPx = twipsToPixels(rightMarginTwips) * (props.zoom ?? 1);

    const twipsAt = (clientX: number): number | null => {
      const rect = rulerRef.value?.getBoundingClientRect();
      if (!rect) return null;
      return pixelsToTwips((clientX - rect.left) / (props.zoom ?? 1));
    };

    const handleMove = (marker: MarkerType, clientX: number, altKey: boolean) => {
      const positionTwips = twipsAt(clientX);
      if (positionTwips === null) return;
      dragPositionPx.value = twipsToPixels(positionTwips) * (props.zoom ?? 1);
      const unit = props.unit ?? 'inch';
      if (marker === 'leftMargin' || marker === 'rightMargin') {
        if (marker === 'leftMargin') {
          const maxMargin = pageWidthTwips - rightMarginTwips - gutterTwips - 720;
          const rounded = Math.round(Math.max(0, Math.min(positionTwips, maxMargin)));
          dragValue.value = rounded;
          props.onLeftMarginChange?.(rounded);
        } else {
          const fromRight = pageWidthTwips - positionTwips;
          const maxMargin = pageWidthTwips - leftMarginTwips - gutterTwips - 720;
          const rounded = Math.round(Math.max(0, Math.min(fromRight, maxMargin)));
          dragValue.value = rounded;
          props.onRightMarginChange?.(rounded);
        }
        return;
      }
      const next = dragIndent(marker, positionTwips, current, page, { unit, precise: altKey });
      dragValue.value =
        marker === 'right' ? next.right : marker === 'firstLine' ? next.firstLine : next.left;
      props.onIndentChange?.(next);
    };

    const endDrag = (marker: MarkerType) => {
      if (marker === 'leftMargin' || marker === 'rightMargin') props.onMarginDragEnd?.();
      else props.onIndentDragEnd?.();
      dragging.value = null;
      dragValue.value = null;
      dragPositionPx.value = null;
    };

    const nudge = (marker: RulerIndentHandle, direction: -1 | 1, fine: boolean) => {
      const unit = props.unit ?? 'inch';
      const at = handlePosition(marker, current, page);
      const next = dragIndent(marker, at + direction * nudgeStep(unit, fine), current, page, {
        unit,
        precise: true,
      });
      props.onIndentChange?.(next);
      props.onIndentDragEnd?.();
    };

    return () => {
      const zoom = props.zoom ?? 1;
      const unit = props.unit ?? 'inch';
      const ticks = generateTicks(pageWidthTwips, zoom, unit);
      const indentDraggable =
        (props.showIndentHandles ?? false) &&
        (props.indentEditable ?? false) &&
        props.onIndentChange !== undefined;

      const marker = (handle: RulerIndentHandle): number =>
        twipsToPixels(handlePosition(handle, current, page)) * zoom;

      const handleProps = (
        handle: RulerIndentHandle,
        labelKey: Parameters<typeof t>[0],
        value: number
      ) => ({
        positionPx: marker(handle),
        editable: indentDraggable,
        isDragging: dragging.value === handle,
        isHovered: hoveredMarker.value === handle,
        onPointerEnter: () => {
          hoveredMarker.value = handle;
        },
        onPointerLeave: () => {
          hoveredMarker.value = null;
        },
        onPointerDown: (event: PointerEvent) => {
          if (!indentDraggable) return;
          event.preventDefault();
          event.stopPropagation();
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          dragging.value = handle;
        },
        onPointerMove: (event: PointerEvent) => {
          if (dragging.value !== handle) return;
          handleMove(handle, event.clientX, event.altKey);
        },
        onPointerUp: (event: PointerEvent) => {
          if (dragging.value !== handle) return;
          (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
          endDrag(handle);
        },
        onKeyDown: (event: KeyboardEvent) => {
          if (!indentDraggable) return;
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          nudge(handle, event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey);
        },
        label: t(labelKey),
        valueNow: value,
        valueText: formatValueForTooltip(value, unit),
        pageWidthTwips,
      });

      return (
        <div
          ref={rulerRef}
          class={`docx-horizontal-ruler ${props.className ?? ''}`}
          style={{
            position: 'relative',
            width: formatPx(pageWidthPx),
            height: RULER_HEIGHT,
            backgroundColor: 'transparent',
            overflow: 'visible',
            userSelect: 'none',
            touchAction: 'none',
            cursor: dragging.value ? 'ew-resize' : 'default',
            ...(props.style ?? {}),
          }}
          // A GROUP, not a slider: it contains sliders. It carried `aria-valuemin`/`max` with
          // no `aria-valuenow`, which describes nothing.
          role="group"
          aria-label={t('ruler.horizontal')}
        >
          {/* Grey margin zones — drag anywhere in the grey to move the margin. */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: formatPx(leftMarginPx),
              height: STRIP_HEIGHT,
              backgroundColor: MARGIN_ZONE_COLOR,
              borderRight: '1px solid var(--doc-shadow-subtle)',
              cursor: (props.editable ?? false) ? 'ew-resize' : 'default',
              zIndex: 1,
            }}
            onPointerdown={
              (props.editable ?? false) && props.onLeftMarginChange
                ? (event) => {
                    event.preventDefault();
                    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
                    dragging.value = 'leftMargin';
                  }
                : undefined
            }
            onPointermove={(event) =>
              dragging.value === 'leftMargin' &&
              handleMove('leftMargin', event.clientX, event.altKey)
            }
            onPointerup={(event) => {
              if (dragging.value !== 'leftMargin') return;
              (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
              endDrag('leftMargin');
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: formatPx(rightMarginPx),
              height: STRIP_HEIGHT,
              backgroundColor: MARGIN_ZONE_COLOR,
              borderLeft: '1px solid var(--doc-shadow-subtle)',
              cursor: (props.editable ?? false) ? 'ew-resize' : 'default',
              zIndex: 1,
            }}
            onPointerdown={
              (props.editable ?? false) && props.onRightMarginChange
                ? (event) => {
                    event.preventDefault();
                    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
                    dragging.value = 'rightMargin';
                  }
                : undefined
            }
            onPointermove={(event) =>
              dragging.value === 'rightMargin' &&
              handleMove('rightMargin', event.clientX, event.altKey)
            }
            onPointerup={(event) => {
              if (dragging.value !== 'rightMargin') return;
              (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
              endDrag('rightMargin');
            }}
          />

          {/* Tick marks, anchored to the bottom of the strip. */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: STRIP_HEIGHT,
              pointerEvents: 'none',
            }}
          >
            {ticks.map((tick, i) => (
              <RulerTick key={i} tick={tick} />
            ))}
          </div>

          {/* Tab stop markers (display only) */}
          {props.tabMarks?.map((tab) => (
            <TabMarker
              key={tab.position}
              tabMark={tab}
              positionPx={twipsToPixels(tab.position) * zoom}
              onDoubleClick={() => props.onTabMarkRemove?.(tab.position)}
            />
          ))}

          {/* === WORD'S FOUR INDENT HANDLES === */}
          {(props.showIndentHandles ?? false) && (
            <>
              <IndentTriangle
                direction="down"
                anchor="top"
                {...handleProps('firstLine', 'ruler.firstLineIndent', current.firstLine)}
              />
              <IndentTriangle
                direction="up"
                anchor="strip"
                {...handleProps('hanging', 'ruler.hangingIndent', current.left)}
              />
              <IndentBox {...handleProps('left', 'ruler.leftIndent', current.left)} />
              <IndentTriangle
                direction="up"
                anchor="strip"
                {...handleProps('right', 'ruler.rightIndent', current.right)}
              />
            </>
          )}

          {/* Drag tooltip */}
          {dragging.value && dragValue.value !== null && dragPositionPx.value !== null && (
            <DragTooltip
              value={formatValueForTooltip(dragValue.value, unit)}
              positionPx={dragPositionPx.value}
            />
          )}
        </div>
      );
    };
  },
});

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface TickData {
  position: number;
  height: number;
  label?: string;
}

function RulerTick({ tick }: { tick: TickData }): VNode {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: formatPx(tick.position),
          bottom: 0,
          width: 1,
          height: tick.height,
          backgroundColor: RULER_TICK_COLOR,
        }}
      />
      {tick.label && (
        <div
          style={{
            position: 'absolute',
            left: formatPx(tick.position),
            top: 2,
            transform: 'translateX(-50%)',
            fontSize: '9px',
            color: RULER_TEXT_COLOR,
            fontFamily: 'sans-serif',
            whiteSpace: 'nowrap',
          }}
        >
          {tick.label}
        </div>
      )}
    </>
  );
}

/** Everything the four handles share: placement, interaction and accessible value. */
interface HandleProps {
  positionPx: number;
  editable: boolean;
  isDragging: boolean;
  isHovered: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  label: string;
  valueNow: number;
  valueText: string;
  pageWidthTwips: number;
}

function handleColor(props: HandleProps): string {
  if (!props.editable) return INDENT_DISABLED_COLOR;
  return props.isDragging || props.isHovered ? INDENT_HOVER_COLOR : INDENT_COLOR;
}

/** The shared wrapper: hit target, focus, and the slider semantics. */
function handleShell(
  props: HandleProps,
  width: number,
  vertical: CSSProperties
): CSSProperties & Record<string, unknown> {
  return {
    position: 'absolute',
    left: formatPx(props.positionPx - width / 2),
    width,
    cursor: props.editable ? 'ew-resize' : 'default',
    zIndex: props.isDragging ? 10 : 4,
    touchAction: 'none',
    ...vertical,
  };
}

function sliderAria(props: HandleProps) {
  return {
    role: 'slider' as const,
    'aria-label': props.label,
    'aria-orientation': 'horizontal' as const,
    // A slider with no value describes nothing; these were missing entirely.
    'aria-valuenow': props.valueNow,
    'aria-valuemin': -props.pageWidthTwips,
    'aria-valuemax': props.pageWidthTwips,
    'aria-valuetext': props.valueText,
    'aria-disabled': props.editable ? undefined : true,
    tabIndex: props.editable ? 0 : -1,
  };
}

interface IndentTriangleProps extends HandleProps {
  direction: 'up' | 'down';
  /** `top` rides the top of the strip; `strip` sits on its bottom edge. */
  anchor: 'top' | 'strip';
}

function IndentTriangle({ direction, anchor, ...props }: IndentTriangleProps): VNode {
  const color = handleColor(props);
  const vertical: CSSProperties =
    anchor === 'top'
      ? { top: 0, height: TRI_HEIGHT + 1 }
      : { top: STRIP_HEIGHT - TRI_HEIGHT, height: TRI_HEIGHT };

  return (
    <div
      class="docx-ruler-indent"
      style={handleShell(props, TRI_SIZE * 2, vertical)}
      onPointerenter={props.onPointerEnter}
      onPointerleave={props.onPointerLeave}
      onPointerdown={props.onPointerDown}
      onPointermove={props.onPointerMove}
      onPointerup={props.onPointerUp}
      onKeydown={props.onKeyDown}
      {...sliderAria(props)}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          width: 0,
          height: 0,
          borderLeft: `${TRI_SIZE}px solid transparent`,
          borderRight: `${TRI_SIZE}px solid transparent`,
          ...(direction === 'down'
            ? { top: 0, borderTop: `${TRI_HEIGHT}px solid ${color}` }
            : { bottom: 0, borderBottom: `${TRI_HEIGHT}px solid ${color}` }),
          transition: 'border-color 0.1s',
        }}
      />
    </div>
  );
}

/**
 * The left-indent box — Word's rectangle below the hanging triangle.
 *
 * Below rather than beside, which is what lets it share an x with the hanging triangle
 * without the two fighting over the same hit target.
 */
function IndentBox(props: HandleProps): VNode {
  return (
    <div
      class="docx-ruler-indent docx-ruler-indent--box"
      style={handleShell(props, TRI_SIZE * 2, { top: STRIP_HEIGHT + 1, height: BOX_HEIGHT })}
      onPointerenter={props.onPointerEnter}
      onPointerleave={props.onPointerLeave}
      onPointerdown={props.onPointerDown}
      onPointermove={props.onPointerMove}
      onPointerup={props.onPointerUp}
      onKeydown={props.onKeyDown}
      {...sliderAria(props)}
    >
      <div
        style={{
          position: 'absolute',
          left: 1,
          top: 0,
          width: TRI_SIZE * 2 - 2,
          height: BOX_HEIGHT,
          backgroundColor: handleColor(props),
          borderRadius: 1,
          transition: 'background-color 0.1s',
        }}
      />
    </div>
  );
}

function DragTooltip({ value, positionPx }: { value: string; positionPx: number }): VNode {
  return (
    <div
      style={{
        position: 'absolute',
        left: formatPx(positionPx),
        top: -22,
        transform: 'translateX(-50%)',
        backgroundColor: 'var(--doc-text)',
        color: 'var(--doc-on-primary)',
        fontSize: '10px',
        fontFamily: 'sans-serif',
        padding: '2px 6px',
        borderRadius: 3,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      {value}
    </div>
  );
}

interface TabMarkerProps {
  tabMark: RulerTabStop;
  positionPx: number;
  onDoubleClick: () => void;
}

const TAB_SYMBOLS: Record<string, string> = {
  left: 'L',
  center: 'C',
  right: 'R',
  decimal: 'D',
  bar: '|',
};

function TabMarker({ tabMark, positionPx, onDoubleClick }: TabMarkerProps): VNode {
  return (
    <div
      style={{
        position: 'absolute',
        left: formatPx(positionPx - 5),
        top: STRIP_HEIGHT - 12,
        width: 10,
        height: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 8,
        fontWeight: 700,
        color: 'var(--doc-text-muted)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onDblclick={(e) => {
        e.stopPropagation();
        onDoubleClick();
      }}
      title={`${tabMark.alignment} tab at ${(tabMark.position / 1440).toFixed(2)}"`}
    >
      {TAB_SYMBOLS[tabMark.alignment] || 'L'}
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateTicks(pageWidthTwips: number, zoom: number, unit: 'inch' | 'cm'): TickData[] {
  const ticks: TickData[] = [];

  if (unit === 'inch') {
    const eighthInchTwips = TWIPS_PER_INCH / 8;
    const totalEighths = Math.ceil(pageWidthTwips / eighthInchTwips);
    for (let i = 0; i <= totalEighths; i++) {
      const twipsPos = i * eighthInchTwips;
      if (twipsPos > pageWidthTwips) break;
      const pxPos = twipsToPixels(twipsPos) * zoom;
      if (i % 8 === 0) {
        ticks.push({ position: pxPos, height: 8, label: i / 8 > 0 ? String(i / 8) : undefined });
      } else if (i % 4 === 0) {
        ticks.push({ position: pxPos, height: 5 });
      } else if (i % 2 === 0) {
        ticks.push({ position: pxPos, height: 3 });
      } else {
        ticks.push({ position: pxPos, height: 2 });
      }
    }
  } else {
    const mmTwips = TWIPS_PER_CM / 10;
    const totalMm = Math.ceil(pageWidthTwips / mmTwips);
    for (let i = 0; i <= totalMm; i++) {
      const twipsPos = i * mmTwips;
      if (twipsPos > pageWidthTwips) break;
      const pxPos = twipsToPixels(twipsPos) * zoom;
      if (i % 10 === 0) {
        ticks.push({ position: pxPos, height: 8, label: i / 10 > 0 ? String(i / 10) : undefined });
      } else if (i % 5 === 0) {
        ticks.push({ position: pxPos, height: 5 });
      } else {
        ticks.push({ position: pxPos, height: 3 });
      }
    }
  }

  return ticks;
}

export function positionToMargin(
  positionPx: number,
  side: 'left' | 'right',
  pageWidthPx: number,
  zoom: number
): number {
  const positionTwips = pixelsToTwips(positionPx / zoom);
  if (side === 'left') return Math.max(0, positionTwips);
  return Math.max(0, pixelsToTwips(pageWidthPx / zoom) - positionTwips);
}

export function getRulerDimensions(
  pageSetup?: RulerPageSetup | null,
  zoom: number = 1
): { width: number; leftMargin: number; rightMargin: number; contentWidth: number } {
  const pw = pageSetup?.pageWidthTwips ?? DEFAULT_PAGE_WIDTH_TWIPS;
  const lm = pageSetup?.marginsTwips.left ?? DEFAULT_MARGIN_TWIPS;
  const rm = pageSetup?.marginsTwips.right ?? DEFAULT_MARGIN_TWIPS;
  const width = twipsToPixels(pw) * zoom;
  const leftMargin = twipsToPixels(lm) * zoom;
  const rightMargin = twipsToPixels(rm) * zoom;
  return { width, leftMargin, rightMargin, contentWidth: width - leftMargin - rightMargin };
}

export function getMarginInUnits(marginTwips: number, unit: 'inch' | 'cm'): string {
  return unit === 'inch'
    ? (marginTwips / TWIPS_PER_INCH).toFixed(2) + '"'
    : (marginTwips / TWIPS_PER_CM).toFixed(1) + ' cm';
}

export function parseMarginFromUnits(value: string, unit: 'inch' | 'cm'): number | null {
  const num = parseFloat(value.replace(/[^\d.]/g, ''));
  if (isNaN(num)) return null;
  return Math.round(num * (unit === 'inch' ? TWIPS_PER_INCH : TWIPS_PER_CM));
}

export default HorizontalRuler;
