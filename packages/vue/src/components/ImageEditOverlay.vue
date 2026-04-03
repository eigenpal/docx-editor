<template>
  <div ref="overlayRootRef" v-if="imageInfo" class="image-overlay" :style="overlayStyle" @mousedown.stop>
    <!-- Selection border -->
    <div class="image-overlay__border"></div>

    <!-- Resize handles (4 corners) -->
    <div
      v-for="h in handles"
      :key="h.pos"
      class="image-overlay__handle"
      :style="h.style"
      @mousedown.prevent.stop="startResize($event, h.pos)"
    ></div>

    <!-- Dimension label during resize -->
    <div v-if="isResizing" class="image-overlay__dim">
      {{ Math.round(currentWidth) }} &times; {{ Math.round(currentHeight) }}
    </div>

    <!-- Action buttons -->
    <div class="image-overlay__actions" v-if="!isResizing">
      <button title="Image properties" @mousedown.prevent.stop="$emit('open-properties')">&#9881;</button>
      <button title="Delete image" @mousedown.prevent.stop="deleteImage">&#128465;</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue';
import type { EditorView } from 'prosemirror-view';

export interface ImageSelectionInfo {
  element: HTMLElement;
  pmPos: number;
  width: number;
  height: number;
}

type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw';

const props = defineProps<{
  imageInfo: ImageSelectionInfo | null;
  zoom: number;
  view: EditorView | null;
}>();

const emit = defineEmits<{
  (e: 'open-properties'): void;
  (e: 'deselect'): void;
}>();

const overlayRootRef = ref<HTMLElement | null>(null);
const isResizing = ref(false);
const currentWidth = ref(0);
const currentHeight = ref(0);

// Tracked overlay rect (updated from element position)
const overlayRect = ref<{ left: number; top: number; width: number; height: number } | null>(null);

let resizeHandle: ResizeHandle = 'se';
let startX = 0;
let startY = 0;
let startWidth = 0;
let startHeight = 0;
let rafId: number | null = null;

// ---- Position calculation (matches React's approach) ----

function updatePosition() {
  if (!props.imageInfo || !overlayRootRef.value) {
    overlayRect.value = null;
    return;
  }

  const parent = overlayRootRef.value.offsetParent as HTMLElement | null;
  if (!parent) {
    overlayRect.value = null;
    return;
  }

  const parentRect = parent.getBoundingClientRect();
  const imageRect = props.imageInfo.element.getBoundingClientRect();
  const z = props.zoom;

  overlayRect.value = {
    left: (imageRect.left - parentRect.left) / z,
    top: (imageRect.top - parentRect.top) / z,
    width: imageRect.width / z,
    height: imageRect.height / z,
  };
}

// Update when imageInfo changes
watch(
  () => props.imageInfo,
  async () => {
    await nextTick();
    updatePosition();
  },
  { immediate: true }
);

// Update on scroll/resize
watch(
  () => props.imageInfo,
  (_newVal, _oldVal, onCleanup) => {
    if (!props.imageInfo) return;

    const handleScrollOrResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updatePosition);
    };

    const viewport = overlayRootRef.value?.closest('.docx-editor-vue__pages-viewport');
    const scrollParent = viewport?.parentElement;

    scrollParent?.addEventListener('scroll', handleScrollOrResize, { passive: true });
    window.addEventListener('resize', handleScrollOrResize, { passive: true });

    onCleanup(() => {
      scrollParent?.removeEventListener('scroll', handleScrollOrResize);
      window.removeEventListener('resize', handleScrollOrResize);
      if (rafId) cancelAnimationFrame(rafId);
    });
  },
  { immediate: true }
);

// ---- Computed styles ----

const overlayStyle = computed(() => {
  const r = overlayRect.value;
  if (!r) {
    // Use visibility:hidden instead of display:none so offsetParent remains
    // available for position calculation on the next tick.
    return {
      position: 'absolute' as const,
      top: '0px',
      left: '0px',
      visibility: 'hidden' as const,
      pointerEvents: 'none' as const,
    };
  }

  const w = isResizing.value ? currentWidth.value : r.width;
  const h = isResizing.value ? currentHeight.value : r.height;

  return {
    position: 'absolute' as const,
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${w}px`,
    height: `${h}px`,
    zIndex: 15,
    pointerEvents: 'auto' as const,
  };
});

const handles = computed(() => {
  const half = 5;
  const w = isResizing.value ? currentWidth.value : (overlayRect.value?.width || 0);
  const h = isResizing.value ? currentHeight.value : (overlayRect.value?.height || 0);
  return [
    { pos: 'nw' as ResizeHandle, style: { left: `-${half}px`, top: `-${half}px`, cursor: 'nw-resize' } },
    { pos: 'ne' as ResizeHandle, style: { left: `${w - half}px`, top: `-${half}px`, cursor: 'ne-resize' } },
    { pos: 'se' as ResizeHandle, style: { left: `${w - half}px`, top: `${h - half}px`, cursor: 'se-resize' } },
    { pos: 'sw' as ResizeHandle, style: { left: `-${half}px`, top: `${h - half}px`, cursor: 'sw-resize' } },
  ];
});

// ---- Resize logic ----

function calculateNewDimensions(
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  sw: number,
  sh: number,
  lockAspect: boolean
): { width: number; height: number } {
  const signX = handle.includes('w') ? -1 : 1;
  const signY = handle.includes('n') ? -1 : 1;

  let newW = sw + deltaX * signX;
  let newH = sh + deltaY * signY;

  if (lockAspect) {
    const scale = Math.max(newW / sw, newH / sh);
    newW = sw * scale;
    newH = sh * scale;
  }

  return {
    width: Math.max(20, Math.min(2000, newW)),
    height: Math.max(20, Math.min(2000, newH)),
  };
}

function startResize(e: MouseEvent, handle: string) {
  if (!props.imageInfo || !overlayRect.value) return;
  resizeHandle = handle as ResizeHandle;
  startX = e.clientX;
  startY = e.clientY;
  startWidth = overlayRect.value.width;
  startHeight = overlayRect.value.height;
  currentWidth.value = Math.round(startWidth);
  currentHeight.value = Math.round(startHeight);
  isResizing.value = true;

  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
}

function onResizeMove(e: MouseEvent) {
  const z = props.zoom;
  const deltaX = (e.clientX - startX) / z;
  const deltaY = (e.clientY - startY) / z;
  const lockAspect = !e.shiftKey;

  const dims = calculateNewDimensions(resizeHandle, deltaX, deltaY, startWidth, startHeight, lockAspect);
  currentWidth.value = Math.round(dims.width);
  currentHeight.value = Math.round(dims.height);
}

function onResizeEnd() {
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
  isResizing.value = false;

  const v = props.view;
  const info = props.imageInfo;
  if (!v || !info) return;

  try {
    const node = v.state.doc.nodeAt(info.pmPos);
    if (node && node.type.name === 'image') {
      const tr = v.state.tr.setNodeMarkup(info.pmPos, undefined, {
        ...node.attrs,
        width: currentWidth.value,
        height: currentHeight.value,
      });
      v.dispatch(tr);
    }
  } catch {
    // Position might be invalid after concurrent edits
  }
}

function deleteImage() {
  const v = props.view;
  const info = props.imageInfo;
  if (!v || !info) return;
  try {
    const node = v.state.doc.nodeAt(info.pmPos);
    if (node) {
      const tr = v.state.tr.delete(info.pmPos, info.pmPos + node.nodeSize);
      v.dispatch(tr);
      emit('deselect');
    }
  } catch {
    // ignore
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
  if (rafId) cancelAnimationFrame(rafId);
});
</script>

<style scoped>
.image-overlay {
  overflow: visible;
}
.image-overlay__border {
  position: absolute;
  inset: -2px;
  border: 2px solid #2563eb;
  border-radius: 2px;
  pointer-events: none;
}
.image-overlay__handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #2563eb;
  border: 1px solid white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  border-radius: 2px;
  z-index: 16;
}
.image-overlay__dim {
  position: absolute;
  bottom: -24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.75);
  color: #fff;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
}
.image-overlay__actions {
  position: absolute;
  top: -32px;
  right: 0;
  display: flex;
  gap: 2px;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 2px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.image-overlay__actions button {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.image-overlay__actions button:hover { background: #f3f4f6; }
</style>
