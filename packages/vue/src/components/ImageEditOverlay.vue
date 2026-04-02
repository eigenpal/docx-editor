<template>
  <div v-if="imageInfo" class="image-overlay" :style="overlayStyle">
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
      {{ Math.round(currentWidth) }} × {{ Math.round(currentHeight) }}
    </div>

    <!-- Action buttons -->
    <div class="image-overlay__actions" v-if="!isResizing">
      <button title="Image properties" @mousedown.prevent.stop="$emit('open-properties')">⚙</button>
      <button title="Delete image" @mousedown.prevent.stop="deleteImage">🗑</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { EditorView } from 'prosemirror-view';

export interface ImageSelectionInfo {
  element: HTMLElement;
  pmPos: number;
  width: number;
  height: number;
}

const props = defineProps<{
  imageInfo: ImageSelectionInfo | null;
  container: HTMLElement | null;
  view: EditorView | null;
}>();

const emit = defineEmits<{
  (e: 'open-properties'): void;
  (e: 'deselect'): void;
}>();

const isResizing = ref(false);
const currentWidth = ref(0);
const currentHeight = ref(0);
let resizeHandle = '';
let startX = 0;
let startY = 0;
let startWidth = 0;
let startHeight = 0;
let aspectRatio = 1;

const handles = computed(() => {
  const size = 10;
  const half = size / 2;
  const w = isResizing.value ? currentWidth.value : (props.imageInfo?.width || 0);
  const h = isResizing.value ? currentHeight.value : (props.imageInfo?.height || 0);
  return [
    { pos: 'nw', style: { left: `-${half}px`, top: `-${half}px`, cursor: 'nw-resize' } },
    { pos: 'ne', style: { left: `${w - half}px`, top: `-${half}px`, cursor: 'ne-resize' } },
    { pos: 'se', style: { left: `${w - half}px`, top: `${h - half}px`, cursor: 'se-resize' } },
    { pos: 'sw', style: { left: `-${half}px`, top: `${h - half}px`, cursor: 'sw-resize' } },
  ];
});

const overlayStyle = computed(() => {
  if (!props.imageInfo || !props.container) return { display: 'none' };

  const containerRect = props.container.getBoundingClientRect();
  const imgRect = props.imageInfo.element.getBoundingClientRect();

  const scrollTop = props.container.scrollTop;
  const scrollLeft = props.container.scrollLeft;

  const x = imgRect.left - containerRect.left + scrollLeft;
  const y = imgRect.top - containerRect.top + scrollTop;
  const w = isResizing.value ? currentWidth.value : props.imageInfo.width;
  const h = isResizing.value ? currentHeight.value : props.imageInfo.height;

  return {
    position: 'absolute' as const,
    left: `${x}px`,
    top: `${y}px`,
    width: `${w}px`,
    height: `${h}px`,
    zIndex: 15,
    pointerEvents: 'auto' as const,
  };
});

function startResize(e: MouseEvent, handle: string) {
  if (!props.imageInfo) return;
  resizeHandle = handle;
  startX = e.clientX;
  startY = e.clientY;
  startWidth = props.imageInfo.width;
  startHeight = props.imageInfo.height;
  aspectRatio = startWidth / startHeight;
  currentWidth.value = startWidth;
  currentHeight.value = startHeight;
  isResizing.value = true;

  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
}

function onResizeMove(e: MouseEvent) {
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;

  let newW = startWidth;
  let newH = startHeight;

  if (resizeHandle.includes('e')) newW = startWidth + dx;
  if (resizeHandle.includes('w')) newW = startWidth - dx;
  if (resizeHandle.includes('s')) newH = startHeight + dy;
  if (resizeHandle.includes('n')) newH = startHeight - dy;

  // Maintain aspect ratio (default behavior)
  if (!e.shiftKey) {
    // Use the larger delta to determine scale
    const scaleX = newW / startWidth;
    const scaleY = newH / startHeight;
    const scale = Math.abs(scaleX - 1) > Math.abs(scaleY - 1) ? scaleX : scaleY;
    newW = startWidth * scale;
    newH = startHeight * scale;
  }

  // Enforce minimum size
  newW = Math.max(20, newW);
  newH = Math.max(20, newH);

  currentWidth.value = Math.round(newW);
  currentHeight.value = Math.round(newH);
}

function onResizeEnd() {
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
  isResizing.value = false;

  // Dispatch the size change to ProseMirror
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
});
</script>

<style scoped>
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
  background: #fff;
  border: 2px solid #2563eb;
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
