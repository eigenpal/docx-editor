<!--
  Mirrors packages/react/src/components/ui/HorizontalRuler.tsx 1:1.
  Same constants, same eighth-inch tick generation (heights 10/6/4/2 px),
  same CSS-triangle indent handles, same margin-zone backgrounds.
-->
<template>
  <div
    ref="rulerRef"
    class="docx-horizontal-ruler"
    :style="containerStyle"
    role="slider"
    aria-label="Horizontal ruler"
    :aria-valuemin="0"
    :aria-valuemax="pageWidthTwips"
  >
    <!-- Margin zones (drag to adjust margin) -->
    <div
      class="docx-horizontal-ruler__margin"
      :style="leftMarginStyle"
      @mousedown.prevent.stop="editable ? startDrag('leftMargin', $event) : null"
    />
    <div
      class="docx-horizontal-ruler__margin"
      :style="rightMarginStyle"
      @mousedown.prevent.stop="editable ? startDrag('rightMargin', $event) : null"
    />

    <!-- Tick marks -->
    <div class="docx-horizontal-ruler__ticks">
      <template v-for="(tick, i) in ticks" :key="i">
        <div
          class="docx-horizontal-ruler__tick-line"
          :style="{ left: tick.position + 'px', height: tick.height + 'px' }"
        />
        <div
          v-if="tick.label"
          class="docx-horizontal-ruler__tick-label"
          :style="{ left: tick.position + 'px' }"
        >
          {{ tick.label }}
        </div>
      </template>
    </div>

    <!-- First-line indent: ▼ down at top -->
    <div
      v-if="showFirstLineIndent"
      class="docx-ruler-indent"
      :style="indentContainerStyle('down', firstLinePosPx, dragging === 'firstLineIndent')"
      @mousedown.prevent.stop="editable ? startDrag('firstLineIndent', $event) : null"
      @mouseenter="hovered = 'firstLineIndent'"
      @mouseleave="hovered = null"
    >
      <div :style="triangleStyle('down', triColor('firstLineIndent'))" />
    </div>

    <!-- Left indent: ▲ up at bottom -->
    <div
      v-if="editable"
      class="docx-ruler-indent"
      :style="indentContainerStyle('up', leftIndentPosPx, dragging === 'leftIndent')"
      @mousedown.prevent.stop="startDrag('leftIndent', $event)"
      @mouseenter="hovered = 'leftIndent'"
      @mouseleave="hovered = null"
    >
      <div :style="triangleStyle('up', triColor('leftIndent'))" />
    </div>

    <!-- Right indent: ▼ down at top -->
    <div
      v-if="editable"
      class="docx-ruler-indent"
      :style="indentContainerStyle('down', rightIndentPosPx, dragging === 'rightIndent')"
      @mousedown.prevent.stop="startDrag('rightIndent', $event)"
      @mouseenter="hovered = 'rightIndent'"
      @mouseleave="hovered = null"
    >
      <div :style="triangleStyle('down', triColor('rightIndent'))" />
    </div>

    <!-- Tab stops -->
    <div
      v-for="(tab, i) in tabMarkPositions"
      :key="i"
      class="docx-horizontal-ruler__tab"
      :style="{ left: tab.px + 'px' }"
      :title="`${tab.label}`"
      @dblclick.prevent="$emit('tab-stop-remove', tab.twips)"
    >L</div>

    <!-- Drag tooltip -->
    <div
      v-if="dragging && tooltipText"
      class="docx-horizontal-ruler__tooltip"
      :style="{ left: tooltipX + 'px' }"
    >
      {{ tooltipText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, type CSSProperties } from 'vue';
import type { SectionProperties, TabMark } from '@eigenpal/docx-editor-core/types/document';
import { twipsToPixels, pixelsToTwips } from '@eigenpal/docx-editor-core/utils/units';

type MarkerType =
  | 'leftMargin'
  | 'rightMargin'
  | 'firstLineIndent'
  | 'leftIndent'
  | 'rightIndent';

const props = withDefaults(
  defineProps<{
    sectionProps?: SectionProperties | null;
    zoom?: number;
    editable?: boolean;
    showFirstLineIndent?: boolean;
    firstLineIndent?: number;
    hangingIndent?: boolean;
    indentLeft?: number;
    indentRight?: number;
    unit?: 'inch' | 'cm';
    tabMarks?: TabMark[] | null;
  }>(),
  {
    zoom: 1,
    editable: true,
    showFirstLineIndent: false,
    firstLineIndent: 0,
    hangingIndent: false,
    indentLeft: 0,
    indentRight: 0,
    unit: 'inch',
  }
);

const emit = defineEmits<{
  (e: 'left-margin-change', twips: number): void;
  (e: 'right-margin-change', twips: number): void;
  (e: 'first-line-indent-change', twips: number): void;
  (e: 'indent-left-change', twips: number): void;
  (e: 'indent-right-change', twips: number): void;
  (e: 'tab-stop-remove', twips: number): void;
}>();

// Mirror React HorizontalRuler.tsx:50-63
const DEFAULT_PAGE_WIDTH_TWIPS = 12240;
const DEFAULT_MARGIN_TWIPS = 1440;
const TWIPS_PER_INCH = 1440;
const TWIPS_PER_CM = 567;
const RULER_HEIGHT = 22;
const INDENT_COLOR = 'var(--doc-primary)';
const INDENT_HOVER_COLOR = 'var(--doc-primary)';
const INDENT_ACTIVE_COLOR = 'var(--doc-primary-hover)';
const TRI_SIZE = 5;
const TRI_HEIGHT = Math.round(TRI_SIZE * 1.6); // 8

const rulerRef = ref<HTMLElement | null>(null);
const dragging = ref<MarkerType | null>(null);
const hovered = ref<MarkerType | null>(null);
const tooltipX = ref(0);
const tooltipText = ref('');

// Wrappers around core's twipsToPixels/pixelsToTwips that fold in the
// current zoom factor (core helpers are zoom-agnostic).
function tw2px(twips: number): number {
  return twipsToPixels(twips) * props.zoom;
}
function px2tw(px: number): number {
  return Math.round(pixelsToTwips(px / props.zoom));
}

const pageWidthTwips = computed(() => props.sectionProps?.pageWidth ?? DEFAULT_PAGE_WIDTH_TWIPS);
const leftMarginTwips = computed(() => props.sectionProps?.marginLeft ?? DEFAULT_MARGIN_TWIPS);
const rightMarginTwips = computed(() => props.sectionProps?.marginRight ?? DEFAULT_MARGIN_TWIPS);
const contentTwips = computed(
  () => pageWidthTwips.value - leftMarginTwips.value - rightMarginTwips.value
);

const pageWidthPx = computed(() => tw2px(pageWidthTwips.value));
const leftMarginPx = computed(() => tw2px(leftMarginTwips.value));
const rightMarginPx = computed(() => tw2px(rightMarginTwips.value));
const indentLeftPx = computed(() => tw2px(props.indentLeft));
const indentRightPx = computed(() => tw2px(props.indentRight));
const effectiveFirstLine = computed(() =>
  props.hangingIndent ? -props.firstLineIndent : props.firstLineIndent
);
const firstLineIndentPx = computed(() => tw2px(effectiveFirstLine.value));

const leftIndentPosPx = computed(() => leftMarginPx.value + indentLeftPx.value);
const rightIndentPosPx = computed(
  () => pageWidthPx.value - rightMarginPx.value - indentRightPx.value
);
const firstLinePosPx = computed(
  () => leftMarginPx.value + indentLeftPx.value + firstLineIndentPx.value
);

const containerStyle = computed<CSSProperties>(() => ({
  position: 'relative',
  width: pageWidthPx.value + 'px',
  height: RULER_HEIGHT + 'px',
  backgroundColor: 'transparent',
  overflow: 'visible',
  userSelect: 'none',
  cursor: dragging.value ? 'ew-resize' : 'default',
}));

const leftMarginStyle = computed<CSSProperties>(() => ({
  position: 'absolute',
  top: 0,
  left: 0,
  width: leftMarginPx.value + 'px',
  height: RULER_HEIGHT + 'px',
  backgroundColor: 'var(--doc-shadow-subtle)',
  borderRight: '1px solid var(--doc-shadow-subtle)',
  cursor: props.editable ? 'ew-resize' : 'default',
  zIndex: 1,
}));
const rightMarginStyle = computed<CSSProperties>(() => ({
  position: 'absolute',
  top: 0,
  right: 0,
  width: rightMarginPx.value + 'px',
  height: RULER_HEIGHT + 'px',
  backgroundColor: 'var(--doc-shadow-subtle)',
  borderLeft: '1px solid var(--doc-shadow-subtle)',
  cursor: props.editable ? 'ew-resize' : 'default',
  zIndex: 1,
}));

// Mirror generateTicks() in React HorizontalRuler.tsx:549.
// Eighth-inch ticks; major every inch (height 10), quarters height 6,
// halves height 4, eighths height 2.
const ticks = computed(() => {
  const out: { position: number; height: number; label?: string }[] = [];
  if (props.unit === 'inch') {
    const eighth = TWIPS_PER_INCH / 8;
    const total = Math.ceil(pageWidthTwips.value / eighth);
    for (let i = 0; i <= total; i++) {
      const twPos = i * eighth;
      if (twPos > pageWidthTwips.value) break;
      const px = tw2px(twPos);
      if (i % 8 === 0) {
        out.push({ position: px, height: 10, label: i / 8 > 0 ? String(i / 8) : undefined });
      } else if (i % 4 === 0) {
        out.push({ position: px, height: 6 });
      } else if (i % 2 === 0) {
        out.push({ position: px, height: 4 });
      } else {
        out.push({ position: px, height: 2 });
      }
    }
  } else {
    const mm = TWIPS_PER_CM / 10;
    const total = Math.ceil(pageWidthTwips.value / mm);
    for (let i = 0; i <= total; i++) {
      const twPos = i * mm;
      if (twPos > pageWidthTwips.value) break;
      const px = tw2px(twPos);
      if (i % 10 === 0) {
        out.push({ position: px, height: 10, label: i / 10 > 0 ? String(i / 10) : undefined });
      } else if (i % 5 === 0) {
        out.push({ position: px, height: 6 });
      } else {
        out.push({ position: px, height: 3 });
      }
    }
  }
  return out;
});

const tabMarkPositions = computed(() => {
  if (!props.tabMarks?.length) return [];
  return props.tabMarks.map((ts) => {
    const pos = (ts as any).position ?? ts.pos ?? 0;
    return { px: tw2px(pos), twips: pos, label: formatValue(pos) };
  });
});

function formatValue(twips: number): string {
  if (props.unit === 'cm') return (twips / TWIPS_PER_CM).toFixed(1) + ' cm';
  return (twips / TWIPS_PER_INCH).toFixed(2) + '"';
}

function triColor(marker: MarkerType): string {
  if (dragging.value === marker) return INDENT_ACTIVE_COLOR;
  if (hovered.value === marker) return INDENT_HOVER_COLOR;
  return INDENT_COLOR;
}

function indentContainerStyle(
  direction: 'up' | 'down',
  positionPx: number,
  isDragging: boolean
): CSSProperties {
  return {
    position: 'absolute',
    left: positionPx - TRI_SIZE + 'px',
    width: TRI_SIZE * 2 + 'px',
    height: TRI_HEIGHT + 2 + 'px',
    cursor: props.editable ? 'ew-resize' : 'default',
    zIndex: isDragging ? 10 : 4,
    ...(direction === 'down' ? { top: 0 } : { bottom: 0 }),
  };
}

function triangleStyle(direction: 'up' | 'down', color: string): CSSProperties {
  if (direction === 'down') {
    return {
      position: 'absolute',
      top: '1px',
      left: 0,
      width: 0,
      height: 0,
      borderLeft: `${TRI_SIZE}px solid transparent`,
      borderRight: `${TRI_SIZE}px solid transparent`,
      borderTop: `${TRI_HEIGHT}px solid ${color}`,
      transition: 'border-top-color 0.1s',
    };
  }
  return {
    position: 'absolute',
    bottom: '1px',
    left: 0,
    width: 0,
    height: 0,
    borderLeft: `${TRI_SIZE}px solid transparent`,
    borderRight: `${TRI_SIZE}px solid transparent`,
    borderBottom: `${TRI_HEIGHT}px solid ${color}`,
    transition: 'border-bottom-color 0.1s',
  };
}

// Drag handlers: dragStart values are captured per-marker so tooltip
// reflects the in-progress value while the user drags.
let dragStartX = 0;
let dragStartValue = 0;

function startDrag(type: MarkerType, event: MouseEvent) {
  if (!props.editable) return;
  dragging.value = type;
  dragStartX = event.clientX;
  if (type === 'leftMargin') dragStartValue = leftMarginTwips.value;
  else if (type === 'rightMargin') dragStartValue = rightMarginTwips.value;
  else if (type === 'leftIndent') dragStartValue = props.indentLeft;
  else if (type === 'rightIndent') dragStartValue = props.indentRight;
  else if (type === 'firstLineIndent') dragStartValue = props.firstLineIndent;

  tooltipX.value = event.clientX - (rulerRef.value?.getBoundingClientRect().left ?? 0);
  tooltipText.value = formatValue(dragStartValue);

  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleUp);
}

function handleMove(e: MouseEvent) {
  if (!dragging.value || !rulerRef.value) return;
  const rect = rulerRef.value.getBoundingClientRect();
  if (!rect) return;
  const x = e.clientX - rect.left;
  tooltipX.value = x;
  const positionTwips = px2tw(x);
  const value = computeNewValue(dragging.value, positionTwips);
  tooltipText.value = formatValue(value);
  emitChange(dragging.value, value);
}

function handleUp(_e: MouseEvent) {
  dragging.value = null;
  document.removeEventListener('mousemove', handleMove);
  document.removeEventListener('mouseup', handleUp);
}

function computeNewValue(marker: MarkerType, positionTwips: number): number {
  if (marker === 'leftMargin') {
    const max = pageWidthTwips.value - rightMarginTwips.value - 720;
    return Math.round(Math.max(0, Math.min(positionTwips, max)));
  }
  if (marker === 'rightMargin') {
    const fromRight = pageWidthTwips.value - positionTwips;
    const max = pageWidthTwips.value - leftMarginTwips.value - 720;
    return Math.round(Math.max(0, Math.min(fromRight, max)));
  }
  if (marker === 'firstLineIndent') {
    const base = leftMarginTwips.value + props.indentLeft;
    const indentFromBase = positionTwips - base;
    const max = contentTwips.value - props.indentLeft - props.indentRight - 720;
    return Math.round(Math.max(-props.indentLeft, Math.min(indentFromBase, max)));
  }
  if (marker === 'leftIndent') {
    const indentFromMargin = positionTwips - leftMarginTwips.value;
    const max = contentTwips.value - props.indentRight - 720;
    return Math.round(Math.max(0, Math.min(indentFromMargin, max)));
  }
  // rightIndent
  const rightEdge = pageWidthTwips.value - rightMarginTwips.value;
  const indentFromRight = rightEdge - positionTwips;
  const max = contentTwips.value - props.indentLeft - 720;
  return Math.round(Math.max(0, Math.min(indentFromRight, max)));
}

function emitChange(marker: MarkerType, value: number) {
  switch (marker) {
    case 'leftMargin': emit('left-margin-change', value); break;
    case 'rightMargin': emit('right-margin-change', value); break;
    case 'firstLineIndent': emit('first-line-indent-change', value); break;
    case 'leftIndent': emit('indent-left-change', value); break;
    case 'rightIndent': emit('indent-right-change', value); break;
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', handleMove);
  document.removeEventListener('mouseup', handleUp);
});
</script>

<style scoped>
.docx-horizontal-ruler {
  display: block;
  position: relative;
  flex-shrink: 0;
}
.docx-horizontal-ruler__ticks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
/* Mirror React RulerTick: line at bottom, 1px wide, color via CSS var
   (--doc-text-subtle); falls back to #9aa0a6 if --doc-text-subtle is unset
   in the consumer scope. */
.docx-horizontal-ruler__tick-line {
  position: absolute;
  bottom: 0;
  width: 1px;
  background-color: var(--doc-text-subtle);
}
.docx-horizontal-ruler__tick-label {
  position: absolute;
  top: 3px;
  transform: translateX(-50%);
  font-size: 9px;
  color: var(--doc-text-muted);
  font-family: sans-serif;
  white-space: nowrap;
}
.docx-horizontal-ruler__tab {
  position: absolute;
  bottom: 0;
  width: 10px;
  height: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 700;
  color: var(--doc-text-muted);
  cursor: pointer;
  user-select: none;
  transform: translateX(-5px);
}
.docx-horizontal-ruler__tooltip {
  position: absolute;
  top: -22px;
  transform: translateX(-50%);
  background: var(--doc-text);
  color: var(--doc-on-primary);
  font-size: 10px;
  font-family: sans-serif;
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 20;
}
</style>
