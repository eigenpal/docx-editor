<template>
  <div class="hruler" :style="{ height: `${RULER_H}px` }">
    <div class="hruler__track" ref="trackRef" :style="trackStyle">
      <!-- Left margin zone -->
      <div class="hruler__margin" :style="{ left: 0, width: `${leftMarginPx}px` }" />
      <!-- Right margin zone -->
      <div class="hruler__margin" :style="{ right: 0, width: `${rightMarginPx}px` }" />

      <!-- Tick marks -->
      <svg class="hruler__ticks" :viewBox="`0 0 ${pageWidthPx} ${RULER_H}`" preserveAspectRatio="none">
        <template v-for="tick in ticks" :key="tick.x">
          <line :x1="tick.x" :y1="tick.major ? 2 : 6" :x2="tick.x" :y2="RULER_H - 2" stroke="#9ca3af" :stroke-width="tick.major ? 0.8 : 0.5" />
          <text v-if="tick.label" :x="tick.x + 3" :y="10" font-size="8" fill="#9ca3af">{{ tick.label }}</text>
        </template>
      </svg>

      <!-- Left indent handle (▲) -->
      <div
        v-if="editable"
        class="hruler__handle hruler__handle--left-indent"
        :style="{ left: `${leftMarginPx + leftIndentPx}px` }"
        title="Left indent"
        @mousedown.prevent="startDrag('leftIndent', $event)"
      >&#x25B2;</div>

      <!-- First-line indent handle (▼) -->
      <div
        v-if="editable && showFirstLineIndent"
        class="hruler__handle hruler__handle--first-line"
        :style="{ left: `${leftMarginPx + firstLineIndentPx}px` }"
        title="First-line indent"
        @mousedown.prevent="startDrag('firstLineIndent', $event)"
      >&#x25BC;</div>

      <!-- Right indent handle (▼) -->
      <div
        v-if="editable"
        class="hruler__handle hruler__handle--right-indent"
        :style="{ right: `${rightMarginPx + rightIndentPx}px` }"
        title="Right indent"
        @mousedown.prevent="startDrag('rightIndent', $event)"
      >&#x25BC;</div>

      <!-- Tab stops -->
      <div
        v-for="(tab, i) in tabStopPositions"
        :key="i"
        class="hruler__tab"
        :style="{ left: `${tab.px}px` }"
        :title="`Tab stop: ${tab.label}`"
        @dblclick.prevent="$emit('tab-stop-remove', tab.twips)"
      >&#x2514;</div>

      <!-- Drag tooltip -->
      <div v-if="dragging" class="hruler__tooltip" :style="{ left: `${tooltipX}px` }">
        {{ tooltipText }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { SectionProperties, TabStop } from '@eigenpal/docx-core/types/document';

const props = withDefaults(
  defineProps<{
    sectionProps?: SectionProperties | null;
    zoom?: number;
    editable?: boolean;
    showFirstLineIndent?: boolean;
    firstLineIndent?: number;
    indentLeft?: number;
    indentRight?: number;
    unit?: 'inch' | 'cm';
    tabStops?: TabStop[] | null;
  }>(),
  {
    zoom: 1,
    editable: true,
    showFirstLineIndent: true,
    firstLineIndent: 0,
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

const RULER_H = 22;
const TWIPS_PER_INCH = 1440;
const TWIPS_PER_CM = 567;
const DEFAULT_PAGE_WIDTH = 12240;
const DEFAULT_MARGIN = 1440;

const trackRef = ref<HTMLElement | null>(null);
const dragging = ref(false);
const dragType = ref<string | null>(null);
const dragStartX = ref(0);
const dragStartValue = ref(0);
const tooltipX = ref(0);
const tooltipText = ref('');

function tw2px(twips: number): number {
  return Math.round((twips / TWIPS_PER_INCH) * 96 * props.zoom);
}
function px2tw(px: number): number {
  return Math.round((px / (96 * props.zoom)) * TWIPS_PER_INCH);
}

const pageWidthTw = computed(() => props.sectionProps?.pageWidth ?? DEFAULT_PAGE_WIDTH);
const leftMarginTw = computed(() => props.sectionProps?.marginLeft ?? DEFAULT_MARGIN);
const rightMarginTw = computed(() => props.sectionProps?.marginRight ?? DEFAULT_MARGIN);

const pageWidthPx = computed(() => tw2px(pageWidthTw.value));
const leftMarginPx = computed(() => tw2px(leftMarginTw.value));
const rightMarginPx = computed(() => tw2px(rightMarginTw.value));
const leftIndentPx = computed(() => tw2px(props.indentLeft ?? 0));
const rightIndentPx = computed(() => tw2px(props.indentRight ?? 0));
const firstLineIndentPx = computed(() => tw2px(props.firstLineIndent ?? 0));

const trackStyle = computed(() => ({
  width: `${pageWidthPx.value}px`,
  height: `${RULER_H}px`,
}));

const ticks = computed(() => {
  const result: { x: number; major: boolean; label?: string }[] = [];
  const perUnit = props.unit === 'cm' ? TWIPS_PER_CM : TWIPS_PER_INCH;
  const steps = Math.ceil(pageWidthTw.value / perUnit) + 1;
  for (let i = 0; i <= steps; i++) {
    const tw = i * perUnit;
    if (tw > pageWidthTw.value) break;
    result.push({ x: tw2px(tw), major: true, label: i > 0 ? String(i) : undefined });
    // Half-unit tick
    const halfTw = tw + perUnit / 2;
    if (halfTw < pageWidthTw.value) {
      result.push({ x: tw2px(halfTw), major: false });
    }
  }
  return result;
});

const tabStopPositions = computed(() => {
  if (!props.tabStops?.length) return [];
  return props.tabStops.map(ts => ({
    px: tw2px((ts as any).position ?? ts.pos ?? 0) + leftMarginPx.value,
    twips: (ts as any).position ?? ts.pos ?? 0,
    label: formatValue((ts as any).position ?? ts.pos ?? 0),
  }));
});

function formatValue(twips: number): string {
  if (props.unit === 'cm') return (twips / TWIPS_PER_CM).toFixed(1) + ' cm';
  return (twips / TWIPS_PER_INCH).toFixed(2) + '"';
}

function startDrag(type: string, event: MouseEvent) {
  if (!props.editable) return;
  dragging.value = true;
  dragType.value = type;
  dragStartX.value = event.clientX;

  if (type === 'leftIndent') dragStartValue.value = props.indentLeft ?? 0;
  else if (type === 'rightIndent') dragStartValue.value = props.indentRight ?? 0;
  else if (type === 'firstLineIndent') dragStartValue.value = props.firstLineIndent ?? 0;

  tooltipX.value = event.clientX - (trackRef.value?.getBoundingClientRect().left ?? 0);
  tooltipText.value = formatValue(dragStartValue.value);
}

function handleMouseMove(event: MouseEvent) {
  if (!dragging.value || !dragType.value) return;
  const dx = event.clientX - dragStartX.value;
  const dTwips = px2tw(dx);
  const newValue = Math.max(0, dragStartValue.value + dTwips);

  tooltipX.value = event.clientX - (trackRef.value?.getBoundingClientRect().left ?? 0);
  tooltipText.value = formatValue(newValue);
}

function handleMouseUp(event: MouseEvent) {
  if (!dragging.value || !dragType.value) return;
  const dx = event.clientX - dragStartX.value;
  const dTwips = px2tw(dx);
  const newValue = Math.max(0, dragStartValue.value + dTwips);

  switch (dragType.value) {
    case 'leftIndent': emit('indent-left-change', newValue); break;
    case 'rightIndent': emit('indent-right-change', newValue); break;
    case 'firstLineIndent': emit('first-line-indent-change', newValue); break;
  }

  dragging.value = false;
  dragType.value = null;
}

onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
});
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
});
</script>

<style scoped>
.hruler {
  display: flex;
  justify-content: center;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  user-select: none;
  overflow: hidden;
}
.hruler__track {
  position: relative;
  background: #fff;
  border-left: 1px solid #d1d5db;
  border-right: 1px solid #d1d5db;
}
.hruler__margin {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(0,0,0,0.03);
}
.hruler__ticks {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.hruler__handle {
  position: absolute;
  cursor: col-resize;
  font-size: 8px;
  color: #4285f4;
  width: 10px;
  text-align: center;
  z-index: 2;
}
.hruler__handle:hover { color: #2a56c6; }
.hruler__handle--left-indent { bottom: 0; transform: translateX(-5px); }
.hruler__handle--first-line { top: 0; transform: translateX(-5px); }
.hruler__handle--right-indent { top: 0; }
.hruler__tab {
  position: absolute;
  bottom: 2px;
  font-size: 8px;
  color: #6b7280;
  cursor: pointer;
  transform: translateX(-4px);
  z-index: 1;
}
.hruler__tab:hover { color: #374151; }
.hruler__tooltip {
  position: absolute;
  top: -22px;
  transform: translateX(-50%);
  background: #1f2937;
  color: #fff;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  white-space: nowrap;
  z-index: 10;
  pointer-events: none;
}
</style>
