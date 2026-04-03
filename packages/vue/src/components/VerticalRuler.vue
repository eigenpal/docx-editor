<template>
  <div class="vruler" :style="{ width: `${RULER_W}px` }">
    <div class="vruler__track" ref="trackRef" :style="trackStyle">
      <!-- Top margin zone -->
      <div class="vruler__margin" :style="{ top: 0, height: `${topMarginPx}px` }" />
      <!-- Bottom margin zone -->
      <div class="vruler__margin" :style="{ bottom: 0, height: `${bottomMarginPx}px` }" />

      <!-- Tick marks -->
      <svg class="vruler__ticks" :viewBox="`0 0 ${RULER_W} ${pageHeightPx}`" preserveAspectRatio="none">
        <template v-for="tick in ticks" :key="tick.y">
          <line :x1="tick.major ? 2 : 6" :y1="tick.y" :x2="RULER_W - 2" :y2="tick.y" stroke="#9ca3af" :stroke-width="tick.major ? 0.8 : 0.5" />
          <text v-if="tick.label" :x="3" :y="tick.y + 10" font-size="8" fill="#9ca3af">{{ tick.label }}</text>
        </template>
      </svg>

      <!-- Top margin drag handle -->
      <div
        v-if="editable"
        class="vruler__handle"
        :style="{ top: `${topMarginPx - 3}px` }"
        title="Top margin"
        @mousedown.prevent="startDrag('topMargin', $event)"
      />

      <!-- Bottom margin drag handle -->
      <div
        v-if="editable"
        class="vruler__handle"
        :style="{ top: `${pageHeightPx - bottomMarginPx - 3}px` }"
        title="Bottom margin"
        @mousedown.prevent="startDrag('bottomMargin', $event)"
      />

      <!-- Drag tooltip -->
      <div v-if="dragging" class="vruler__tooltip" :style="{ top: `${tooltipY}px` }">
        {{ tooltipText }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { SectionProperties } from '@eigenpal/docx-core/types/document';

const props = withDefaults(
  defineProps<{
    sectionProps?: SectionProperties | null;
    zoom?: number;
    editable?: boolean;
    unit?: 'inch' | 'cm';
  }>(),
  { zoom: 1, editable: true, unit: 'inch' }
);

const emit = defineEmits<{
  (e: 'top-margin-change', twips: number): void;
  (e: 'bottom-margin-change', twips: number): void;
}>();

const RULER_W = 22;
const TWIPS_PER_INCH = 1440;
const TWIPS_PER_CM = 567;
const DEFAULT_PAGE_HEIGHT = 15840; // 11 inches
const DEFAULT_MARGIN = 1440;

const trackRef = ref<HTMLElement | null>(null);
const dragging = ref(false);
const dragType = ref<string | null>(null);
const dragStartY = ref(0);
const dragStartValue = ref(0);
const tooltipY = ref(0);
const tooltipText = ref('');

function tw2px(twips: number): number {
  return Math.round((twips / TWIPS_PER_INCH) * 96 * props.zoom);
}
function px2tw(px: number): number {
  return Math.round((px / (96 * props.zoom)) * TWIPS_PER_INCH);
}

const pageHeightTw = computed(() => props.sectionProps?.pageHeight ?? DEFAULT_PAGE_HEIGHT);
const topMarginTw = computed(() => props.sectionProps?.marginTop ?? DEFAULT_MARGIN);
const bottomMarginTw = computed(() => props.sectionProps?.marginBottom ?? DEFAULT_MARGIN);

const pageHeightPx = computed(() => tw2px(pageHeightTw.value));
const topMarginPx = computed(() => tw2px(topMarginTw.value));
const bottomMarginPx = computed(() => tw2px(bottomMarginTw.value));

const trackStyle = computed(() => ({
  width: `${RULER_W}px`,
  height: `${pageHeightPx.value}px`,
}));

const ticks = computed(() => {
  const result: { y: number; major: boolean; label?: string }[] = [];
  const perUnit = props.unit === 'cm' ? TWIPS_PER_CM : TWIPS_PER_INCH;
  const steps = Math.ceil(pageHeightTw.value / perUnit) + 1;
  for (let i = 0; i <= steps; i++) {
    const tw = i * perUnit;
    if (tw > pageHeightTw.value) break;
    result.push({ y: tw2px(tw), major: true, label: i > 0 ? String(i) : undefined });
    const halfTw = tw + perUnit / 2;
    if (halfTw < pageHeightTw.value) {
      result.push({ y: tw2px(halfTw), major: false });
    }
  }
  return result;
});

function formatValue(twips: number): string {
  if (props.unit === 'cm') return (twips / TWIPS_PER_CM).toFixed(1) + ' cm';
  return (twips / TWIPS_PER_INCH).toFixed(2) + '"';
}

function startDrag(type: string, event: MouseEvent) {
  if (!props.editable) return;
  dragging.value = true;
  dragType.value = type;
  dragStartY.value = event.clientY;
  dragStartValue.value = type === 'topMargin' ? topMarginTw.value : bottomMarginTw.value;
  tooltipY.value = event.clientY - (trackRef.value?.getBoundingClientRect().top ?? 0);
  tooltipText.value = formatValue(dragStartValue.value);
}

function handleMouseMove(event: MouseEvent) {
  if (!dragging.value || !dragType.value) return;
  const dy = event.clientY - dragStartY.value;
  const dTwips = px2tw(dragType.value === 'topMargin' ? dy : -dy);
  const newValue = Math.max(0, dragStartValue.value + dTwips);
  tooltipY.value = event.clientY - (trackRef.value?.getBoundingClientRect().top ?? 0);
  tooltipText.value = formatValue(newValue);
}

function handleMouseUp(event: MouseEvent) {
  if (!dragging.value || !dragType.value) return;
  const dy = event.clientY - dragStartY.value;
  const dTwips = px2tw(dragType.value === 'topMargin' ? dy : -dy);
  const newValue = Math.max(0, dragStartValue.value + dTwips);

  if (dragType.value === 'topMargin') emit('top-margin-change', newValue);
  else emit('bottom-margin-change', newValue);

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
.vruler {
  background: #f9fafb;
  border-right: 1px solid #e5e7eb;
  user-select: none;
  overflow: hidden;
  flex-shrink: 0;
}
.vruler__track {
  position: relative;
  background: #fff;
  border-top: 1px solid #d1d5db;
  border-bottom: 1px solid #d1d5db;
}
.vruler__margin {
  position: absolute;
  left: 0;
  right: 0;
  background: rgba(0,0,0,0.03);
}
.vruler__ticks {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.vruler__handle {
  position: absolute;
  left: 2px;
  right: 2px;
  height: 6px;
  cursor: row-resize;
  background: #4285f4;
  border-radius: 2px;
  opacity: 0.5;
  z-index: 2;
}
.vruler__handle:hover { opacity: 1; }
.vruler__tooltip {
  position: absolute;
  left: 24px;
  transform: translateY(-50%);
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
