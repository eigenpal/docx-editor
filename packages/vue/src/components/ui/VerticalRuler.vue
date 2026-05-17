<!--
  Mirrors packages/react/src/components/ui/VerticalRuler.tsx 1:1.
  20px wide, eighth-inch ticks (heights 10/6/4/2 from the right edge),
  same margin-marker styling.
-->
<template>
  <div
    ref="rulerRef"
    class="docx-vertical-ruler"
    :style="containerStyle"
    role="slider"
    aria-label="Vertical ruler"
    aria-orientation="vertical"
  >
    <!-- Tick marks -->
    <div class="docx-vertical-ruler__ticks">
      <template v-for="(tick, i) in ticks" :key="i">
        <div
          class="docx-vertical-ruler__tick-line"
          :style="{ top: tick.position + 'px', width: tick.width + 'px' }"
        />
        <div
          v-if="tick.label"
          class="docx-vertical-ruler__tick-label"
          :style="{ top: tick.position + 'px' }"
        >
          {{ tick.label }}
        </div>
      </template>
    </div>

    <!-- Top margin marker — left-pointing triangle -->
    <div
      v-if="editable"
      class="docx-vertical-ruler__marker"
      :style="markerStyle(topMarginPx)"
      @mousedown.prevent="startDrag('topMargin', $event)"
      @mouseenter="hovered = 'topMargin'"
      @mouseleave="hovered = null"
    >
      <div :style="triangleStyle('topMargin')" />
    </div>

    <!-- Bottom margin marker — left-pointing triangle -->
    <div
      v-if="editable"
      class="docx-vertical-ruler__marker"
      :style="markerStyle(pageHeightPx - bottomMarginPx)"
      @mousedown.prevent="startDrag('bottomMargin', $event)"
      @mouseenter="hovered = 'bottomMargin'"
      @mouseleave="hovered = null"
    >
      <div :style="triangleStyle('bottomMargin')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, type CSSProperties } from 'vue';
import type { SectionProperties } from '@eigenpal/docx-editor-core/types/document';
import { twipsToPixels, pixelsToTwips } from '@eigenpal/docx-editor-core/utils/units';

type MarkerType = 'topMargin' | 'bottomMargin';

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

const DEFAULT_PAGE_HEIGHT_TWIPS = 15840;
const DEFAULT_MARGIN_TWIPS = 1440;
const TWIPS_PER_INCH = 1440;
const TWIPS_PER_CM = 567;
const RULER_W = 20;

const rulerRef = ref<HTMLElement | null>(null);
const dragging = ref<MarkerType | null>(null);
const hovered = ref<MarkerType | null>(null);

// Same wrappers as HorizontalRuler — pin core's units helpers to the
// current zoom factor so subpixel positions match React exactly.
function tw2px(twips: number): number {
  return twipsToPixels(twips) * props.zoom;
}
function px2tw(px: number): number {
  return Math.round(pixelsToTwips(px / props.zoom));
}

const pageHeightTwips = computed(() => props.sectionProps?.pageHeight ?? DEFAULT_PAGE_HEIGHT_TWIPS);
const topMarginTwips = computed(() => props.sectionProps?.marginTop ?? DEFAULT_MARGIN_TWIPS);
const bottomMarginTwips = computed(() => props.sectionProps?.marginBottom ?? DEFAULT_MARGIN_TWIPS);

const pageHeightPx = computed(() => tw2px(pageHeightTwips.value));
const topMarginPx = computed(() => tw2px(topMarginTwips.value));
const bottomMarginPx = computed(() => tw2px(bottomMarginTwips.value));

const containerStyle = computed<CSSProperties>(() => ({
  position: 'relative',
  width: RULER_W + 'px',
  height: pageHeightPx.value + 'px',
  backgroundColor: 'transparent',
  overflow: 'visible',
  userSelect: 'none',
  cursor: dragging.value ? 'ns-resize' : 'default',
}));

// Mirror generateVerticalTicks() from React VerticalRuler.tsx.
const ticks = computed(() => {
  const out: { position: number; width: number; label?: string }[] = [];
  if (props.unit === 'inch') {
    const eighth = TWIPS_PER_INCH / 8;
    const total = Math.ceil(pageHeightTwips.value / eighth);
    for (let i = 0; i <= total; i++) {
      const tw = i * eighth;
      if (tw > pageHeightTwips.value) break;
      const px = tw2px(tw);
      if (i % 8 === 0) {
        out.push({ position: px, width: 10, label: i / 8 > 0 ? String(i / 8) : undefined });
      } else if (i % 4 === 0) {
        out.push({ position: px, width: 6 });
      } else if (i % 2 === 0) {
        out.push({ position: px, width: 4 });
      } else {
        out.push({ position: px, width: 2 });
      }
    }
  } else {
    const mm = TWIPS_PER_CM / 10;
    const total = Math.ceil(pageHeightTwips.value / mm);
    for (let i = 0; i <= total; i++) {
      const tw = i * mm;
      if (tw > pageHeightTwips.value) break;
      const px = tw2px(tw);
      if (i % 10 === 0) {
        out.push({ position: px, width: 10, label: i / 10 > 0 ? String(i / 10) : undefined });
      } else if (i % 5 === 0) {
        out.push({ position: px, width: 6 });
      } else {
        out.push({ position: px, width: 3 });
      }
    }
  }
  return out;
});

function markerStyle(top: number): CSSProperties {
  return {
    position: 'absolute',
    top: top - 5 + 'px',
    right: 0,
    width: RULER_W + 'px',
    height: '10px',
    cursor: props.editable ? 'ns-resize' : 'default',
    zIndex: dragging.value === null ? 1 : 10,
  };
}

// CSS triangle pointing left, mirrors React VerticalRuler.tsx
// triangleStyle: 5px transparent top/bottom + 8px right-border
// (which renders as a triangle pointing toward the page).
function triangleStyle(type: MarkerType): CSSProperties {
  const isActive = dragging.value === type;
  const isHovered = hovered.value === type;
  const color = isActive
    ? 'var(--doc-primary-hover, #1557b0)'
    : isHovered
      ? 'var(--doc-primary, #1a73e8)'
      : 'var(--doc-primary, #1a73e8)';
  return {
    position: 'absolute',
    top: '0px',
    right: '2px',
    width: '0',
    height: '0',
    borderTop: '5px solid transparent',
    borderBottom: '5px solid transparent',
    borderRight: `8px solid ${color}`,
    transition: 'border-right-color 0.1s',
  };
}

let dragStartY = 0;
let dragStartValue = 0;

function startDrag(type: MarkerType, event: MouseEvent) {
  if (!props.editable) return;
  dragging.value = type;
  dragStartY = event.clientY;
  dragStartValue = type === 'topMargin' ? topMarginTwips.value : bottomMarginTwips.value;
  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleUp);
}

function handleMove(e: MouseEvent) {
  if (!dragging.value) return;
  const dy = e.clientY - dragStartY;
  const dTwips = px2tw(dragging.value === 'topMargin' ? dy : -dy);
  const max = pageHeightTwips.value -
    (dragging.value === 'topMargin' ? bottomMarginTwips.value : topMarginTwips.value) - 720;
  const value = Math.round(Math.max(0, Math.min(dragStartValue + dTwips, max)));
  if (dragging.value === 'topMargin') emit('top-margin-change', value);
  else emit('bottom-margin-change', value);
}

function handleUp() {
  dragging.value = null;
  document.removeEventListener('mousemove', handleMove);
  document.removeEventListener('mouseup', handleUp);
}

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', handleMove);
  document.removeEventListener('mouseup', handleUp);
});
</script>

<style scoped>
.docx-vertical-ruler {
  display: block;
  flex-shrink: 0;
}
.docx-vertical-ruler__ticks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.docx-vertical-ruler__tick-line {
  position: absolute;
  right: 0;
  height: 1px;
  background-color: var(--doc-text-subtle, #9aa0a6);
}
.docx-vertical-ruler__tick-label {
  position: absolute;
  left: 2px;
  transform: translateY(-50%);
  font-size: 9px;
  color: var(--doc-text-muted, #5f6368);
  font-family: sans-serif;
  white-space: nowrap;
}
.docx-vertical-ruler__marker {
  background: transparent;
}
</style>
