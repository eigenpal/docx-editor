<template>
  <div
    ref="overlayRootRef"
    v-if="imageInfo"
    class="image-overlay"
    :style="overlayStyle"
    @mousedown.stop
  >
    <!-- Selection border -->
    <div class="image-overlay__border"></div>

    <!-- Draggable body — press + drag past the threshold moves the image -->
    <div
      class="image-overlay__body"
      :style="{ cursor: isDragging ? 'grabbing' : 'grab' }"
      @mousedown.prevent.stop="startDragMove($event)"
      @contextmenu.prevent.stop="$emit('context-menu', $event)"
    ></div>

    <!-- Resize handles: 4 corners + 4 edge midpoints -->
    <div
      v-for="h in handles"
      :key="h.pos"
      class="image-overlay__handle"
      :style="h.style"
      :data-handle="h.pos"
      @mousedown.prevent.stop="startResize($event, h.pos)"
    ></div>

    <!-- Rotation handle (above the top edge, with a connector line) -->
    <div class="image-overlay__rotate-line"></div>
    <div
      class="image-overlay__rotate-handle"
      :style="{ left: `${currentRectWidth / 2 - 7}px` }"
      :title="t('imageOverlay.rotate')"
      @mousedown.prevent.stop="startRotate($event)"
    ></div>

    <!-- Dimension label during resize -->
    <div v-if="isResizing" class="image-overlay__dim">
      {{ Math.round(currentWidth) }} &times; {{ Math.round(currentHeight) }}
    </div>

    <!-- Rotation label while rotating -->
    <div v-if="isRotating" class="image-overlay__dim image-overlay__dim--rotate">
      {{ Math.round(currentRotation) }}&deg;
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { NodeSelection } from 'prosemirror-state';
import { pixelsToEmu } from '@eigenpal/docx-editor-core/utils';
import { resolveDomPosition } from '@eigenpal/docx-editor-core/layout-bridge/resolveDomPosition';
import { findImageElement } from '@eigenpal/docx-editor-core/layout-painter';
import { Z_INDEX } from '../styles/zIndex';
import { useTranslation } from '../i18n';

const { t } = useTranslation();

import type { ImageSelectionInfo } from './imageSelectionTypes';
export type { ImageSelectionInfo };

/** 4 corners + 4 edge midpoints — mirrors the React overlay's handle set. */
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const props = defineProps<{
  imageInfo: ImageSelectionInfo | null;
  zoom: number;
  view: EditorView | null;
}>();

const emit = defineEmits<{
  (e: 'deselect'): void;
  /** Fired when a resize / move / rotate gesture begins (parity with React's onResizeStart/onDragStart). */
  (e: 'interact-start'): void;
  /** Fired when a resize / move / rotate gesture ends. */
  (e: 'interact-end'): void;
  /** Fired when the selected image overlay receives a context-menu gesture. */
  (e: 'context-menu', event: MouseEvent): void;
}>();

const overlayRootRef = ref<HTMLElement | null>(null);

const isResizing = ref(false);
const isDragging = ref(false);
const isRotating = ref(false);

const currentWidth = ref(0);
const currentHeight = ref(0);
const currentRotation = ref(0);

// Tracked overlay rect (updated from element position). During a resize this is
// mutated live so the painted border/handles follow the pointer.
const overlayRect = ref<{ left: number; top: number; width: number; height: number } | null>(null);

const DRAG_THRESHOLD = 4; // px before a press becomes a move drag — matches React.
const ROTATION_SNAP_DEG = 15; // snap increments (released by holding Shift) — matches Word.

let resizeHandle: ResizeHandle = 'se';
let startX = 0;
let startY = 0;
let startWidth = 0;
let startHeight = 0;
// Immutable snapshot of the overlay rect when a resize starts — west/north
// handles compute their new left/top from this, never accumulating.
let resizeStartRect: { left: number; top: number; width: number; height: number } | null = null;
let rafId: number | null = null;

// drag-to-move's listeners are closures, so hold refs to them so onBeforeUnmount
// can detach them if the component unmounts mid-drag (e.g. the image is deleted
// via keyboard during a drag).
let dragMoveListener: ((e: MouseEvent) => void) | null = null;
let dragUpListener: ((e: MouseEvent) => void) | null = null;

/** The image PM node at `pos`, or null if it's gone / not an image. */
function getImageNode(v: EditorView | null, pos: number) {
  if (!v) return null;
  try {
    const node = v.state.doc.nodeAt(pos);
    return node && node.type.name === 'image' ? node : null;
  } catch {
    return null;
  }
}

// ---- Position calculation (matches React's approach) ----

/**
 * The painted element to anchor the overlay to. After a resize / move / rotate
 * commits, the layout-painter re-builds the visible pages, so the originally
 * tracked element is detached — re-find the fresh one by PM position (covering
 * inline, floating, and block images). A single PM position can carry
 * `data-doc-from` on more than one painted element (e.g. a run span next to
 * the image's wrapper), so scan the matches and take the one that resolves to
 * an actual image wrapper. Returns null if it's gone.
 */
function resolveImageEl(): HTMLElement | null {
  const info = props.imageInfo;
  if (!info) return null;
  if (info.element.isConnected) return info.element;
  const pages = overlayRootRef.value
    ?.closest('.docx-editor-vue__pages-viewport')
    ?.querySelector<HTMLElement>('.docx-editor-vue__pages');
  if (!pages) return null;
  for (const el of pages.querySelectorAll<HTMLElement>(`[data-doc-from="${info.pmPos}"]`)) {
    const img = findImageElement(el);
    if (img) return img;
  }
  return null;
}

function updatePosition() {
  const imgEl = resolveImageEl();
  if (!imgEl || !overlayRootRef.value) {
    overlayRect.value = null;
    return;
  }

  const parent = overlayRootRef.value.offsetParent as HTMLElement | null;
  if (!parent) {
    overlayRect.value = null;
    return;
  }

  const parentRect = parent.getBoundingClientRect();
  const imageRect = imgEl.getBoundingClientRect();
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

const currentRectWidth = computed(() =>
  isResizing.value ? currentWidth.value : overlayRect.value?.width || 0
);
const currentRectHeight = computed(() =>
  isResizing.value ? currentHeight.value : overlayRect.value?.height || 0
);

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
    zIndex: Z_INDEX.imageOverlay,
    pointerEvents: 'auto' as const,
  };
});

/**
 * Handle geometry. Corners sit on the box corners; edge handles sit on the
 * midpoint of each side. Cursors match the React overlay
 * (nwse / nesw for corners, ns / ew for edges).
 */
const handles = computed<Array<{ pos: ResizeHandle; style: Record<string, string> }>>(() => {
  const half = 5; // half the 10px handle
  const w = currentRectWidth.value;
  const h = currentRectHeight.value;
  const midX = `${w / 2 - half}px`;
  const midY = `${h / 2 - half}px`;
  const right = `${w - half}px`;
  const bottom = `${h - half}px`;
  const neg = `-${half}px`;
  return [
    { pos: 'nw', style: { left: neg, top: neg, cursor: 'nwse-resize' } },
    { pos: 'n', style: { left: midX, top: neg, cursor: 'ns-resize' } },
    { pos: 'ne', style: { left: right, top: neg, cursor: 'nesw-resize' } },
    { pos: 'e', style: { left: right, top: midY, cursor: 'ew-resize' } },
    { pos: 'se', style: { left: right, top: bottom, cursor: 'nwse-resize' } },
    { pos: 's', style: { left: midX, top: bottom, cursor: 'ns-resize' } },
    { pos: 'sw', style: { left: neg, top: bottom, cursor: 'nesw-resize' } },
    { pos: 'w', style: { left: neg, top: midY, cursor: 'ew-resize' } },
  ];
});

// ---- Resize logic ----

const isCornerHandle = (h: ResizeHandle): boolean => h.length === 2;

/**
 * Resize math, mirroring React's `calculateNewDimensions`:
 *  - corner handles move both edges; aspect ratio is preserved unless Shift is held
 *  - edge handles move exactly one dimension and never preserve aspect
 */
function calculateNewDimensions(
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  sw: number,
  sh: number,
  lockAspect: boolean
): { width: number; height: number } {
  const signX = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
  const signY = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;

  let newW = sw + deltaX * signX;
  let newH = sh + deltaY * signY;

  if (isCornerHandle(handle) && lockAspect) {
    const scale = Math.max(newW / sw, newH / sh);
    newW = sw * scale;
    newH = sh * scale;
  }

  return {
    width: signX === 0 ? sw : Math.max(20, Math.min(2000, newW)),
    height: signY === 0 ? sh : Math.max(20, Math.min(2000, newH)),
  };
}

function startResize(e: MouseEvent, handle: string) {
  if (!props.imageInfo || !overlayRect.value) return;
  resizeHandle = handle as ResizeHandle;
  startX = e.clientX;
  startY = e.clientY;
  startWidth = overlayRect.value.width;
  startHeight = overlayRect.value.height;
  resizeStartRect = { ...overlayRect.value };
  currentWidth.value = Math.round(startWidth);
  currentHeight.value = Math.round(startHeight);
  isResizing.value = true;
  emit('interact-start');

  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
}

function onResizeMove(e: MouseEvent) {
  const z = props.zoom;
  const deltaX = (e.clientX - startX) / z;
  const deltaY = (e.clientY - startY) / z;
  const lockAspect = !e.shiftKey;

  const dims = calculateNewDimensions(
    resizeHandle,
    deltaX,
    deltaY,
    startWidth,
    startHeight,
    lockAspect
  );
  currentWidth.value = Math.round(dims.width);
  currentHeight.value = Math.round(dims.height);

  // Keep the painted box pinned at the opposite edge when dragging a
  // west/north handle, so the resize grows toward the pointer. Computed from
  // the immutable start-rect so repeated moves never drift.
  const base = resizeStartRect;
  if (base) {
    const nextLeft = resizeHandle.includes('w') ? base.left + (base.width - dims.width) : base.left;
    const nextTop = resizeHandle.includes('n') ? base.top + (base.height - dims.height) : base.top;
    overlayRect.value = { left: nextLeft, top: nextTop, width: base.width, height: base.height };
  }
}

function onResizeEnd() {
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
  isResizing.value = false;
  resizeStartRect = null;
  emit('interact-end');

  const v = props.view;
  const info = props.imageInfo;
  if (!v || !info) {
    updatePosition();
    return;
  }

  const node = getImageNode(v, info.pmPos);
  if (node) {
    try {
      v.dispatch(
        v.state.tr.setNodeMarkup(info.pmPos, undefined, {
          ...node.attrs,
          width: currentWidth.value,
          height: currentHeight.value,
        })
      );
    } catch {
      // Position might be invalid after concurrent edits
    }
  }
  // Re-derive the rect from the freshly painted element.
  nextTick(() => updatePosition());
}

// ---- Rotation logic ----

// Snapshotted in startRotate — none of these change during a rotate, so the
// per-mousemove handler never has to re-query the DOM or the PM doc.
let rotateCenterX = 0;
let rotateCenterY = 0;
let rotateStartAngle = 0; // pointer angle at gesture start (degrees)
let rotateBaseRotation = 0; // image rotation at gesture start (degrees)
let rotateBaseTransform: string | null = null; // the image's transform attr at start (flip terms preserved)
let rotateImgEl: HTMLElement | null = null; // the painted <img> the live preview is applied to

/** Pull the `rotate(Ndeg)` term out of an existing CSS transform string. */
function readRotation(transform: string | null | undefined): number {
  if (!transform) return 0;
  const m = transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
  return m ? parseFloat(m[1]) : 0;
}

/** Re-assemble a transform string keeping any flip terms intact (mirrors DocxEditor's logic). */
function writeRotation(transform: string | null | undefined, rotation: number): string | null {
  const hasFlipH = /scaleX\(-1\)/.test(transform || '');
  const hasFlipV = /scaleY\(-1\)/.test(transform || '');
  const parts: string[] = [];
  const norm = ((rotation % 360) + 360) % 360;
  if (norm !== 0) parts.push(`rotate(${norm}deg)`);
  if (hasFlipH) parts.push('scaleX(-1)');
  if (hasFlipV) parts.push('scaleY(-1)');
  return parts.length > 0 ? parts.join(' ') : null;
}

function angleFromCenter(clientX: number, clientY: number): number {
  // Angle of the pointer relative to the box centre, with 0° pointing up
  // (the rotation handle's resting position).
  return (Math.atan2(clientX - rotateCenterX, -(clientY - rotateCenterY)) * 180) / Math.PI;
}

function startRotate(e: MouseEvent) {
  if (!props.imageInfo) return;
  const rect = props.imageInfo.element.getBoundingClientRect();
  rotateCenterX = rect.left + rect.width / 2;
  rotateCenterY = rect.top + rect.height / 2;

  const node = getImageNode(props.view, props.imageInfo.pmPos);
  rotateBaseTransform = node ? (node.attrs.transform as string) || null : null;
  rotateBaseRotation = readRotation(rotateBaseTransform);
  rotateImgEl = props.imageInfo.element.querySelector('img');
  rotateStartAngle = angleFromCenter(e.clientX, e.clientY);
  currentRotation.value = rotateBaseRotation;
  isRotating.value = true;
  emit('interact-start');

  document.addEventListener('mousemove', onRotateMove);
  document.addEventListener('mouseup', onRotateEnd);
}

function onRotateMove(e: MouseEvent) {
  const delta = angleFromCenter(e.clientX, e.clientY) - rotateStartAngle;
  let next = rotateBaseRotation + delta;
  if (!e.shiftKey) {
    next = Math.round(next / ROTATION_SNAP_DEG) * ROTATION_SNAP_DEG;
  }
  currentRotation.value = ((next % 360) + 360) % 360;
  // Live preview on the painted <img> (the painter applies `transform` there,
  // not on the container — which is `overflow:hidden`, so rotating the
  // container would just clip the still-upright image). Element + base transform
  // were snapshotted in startRotate; this only writes a style.
  if (rotateImgEl) {
    rotateImgEl.style.transform = writeRotation(rotateBaseTransform, currentRotation.value) || '';
  }
}

function onRotateEnd() {
  document.removeEventListener('mousemove', onRotateMove);
  document.removeEventListener('mouseup', onRotateEnd);
  isRotating.value = false;
  emit('interact-end');

  const v = props.view;
  const info = props.imageInfo;
  try {
    const node = v && info ? getImageNode(v, info.pmPos) : null;
    if (v && info && node) {
      v.dispatch(
        v.state.tr.setNodeMarkup(info.pmPos, undefined, {
          ...node.attrs,
          transform: writeRotation(node.attrs.transform as string, currentRotation.value),
        })
      );
    }
  } catch {
    /* position invalid after a concurrent edit */
  } finally {
    // Drop the live-preview inline transform. On the happy path the dispatch
    // above re-paints the pages and replaces this <img> anyway; this matters
    // for the catch path, where no re-paint follows and the stale transform
    // would otherwise stick.
    if (rotateImgEl) rotateImgEl.style.transform = '';
    rotateImgEl = null;
    rotateBaseTransform = null;
  }
  nextTick(() => updatePosition());
}

// ---- Drag-to-move logic ----

let moveGhostEl: HTMLElement | null = null;

function startDragMove(e: MouseEvent) {
  if (!props.imageInfo || !overlayRect.value) return;
  const sx = e.clientX;
  const sy = e.clientY;
  const rect = overlayRect.value;
  let dragStarted = false;

  const onMove = (moveEvent: MouseEvent) => {
    const dx = moveEvent.clientX - sx;
    const dy = moveEvent.clientY - sy;
    if (!dragStarted && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;

    if (!dragStarted) {
      dragStarted = true;
      isDragging.value = true;
      emit('interact-start');
      moveGhostEl = document.createElement('div');
      moveGhostEl.style.cssText =
        'position: fixed; pointer-events: none; z-index: 10000; opacity: 0.5; ' +
        'border: 2px dashed #2563eb; border-radius: 4px; background: rgba(37, 99, 235, 0.1);';
      const z = props.zoom;
      moveGhostEl.style.width = `${rect.width * z}px`;
      moveGhostEl.style.height = `${rect.height * z}px`;
      document.body.appendChild(moveGhostEl);
    }

    if (moveGhostEl) {
      const z = props.zoom;
      moveGhostEl.style.left = `${moveEvent.clientX - (rect.width * z) / 2}px`;
      moveGhostEl.style.top = `${moveEvent.clientY - (rect.height * z) / 2}px`;
    }
  };

  const onUp = (upEvent: MouseEvent) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    dragMoveListener = null;
    dragUpListener = null;
    if (moveGhostEl) {
      moveGhostEl.remove();
      moveGhostEl = null;
    }
    isDragging.value = false;
    if (dragStarted) {
      emit('interact-end');
      commitDragMove(upEvent.clientX, upEvent.clientY);
    }
  };

  dragMoveListener = onMove;
  dragUpListener = onUp;
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/**
 * Commit a drag-to-move. Mirrors React's `handleImageDragMove`:
 *  - floating images (square / tight / through wrap, or displayMode === 'float'):
 *    rewrite the anchor `position` offsets so the image moves to the drop point
 *  - inline images: re-insert the image node at the text position under the drop
 */
function commitDragMove(clientX: number, clientY: number) {
  const v = props.view;
  const info = props.imageInfo;
  if (!v || !info) return;
  const node = getImageNode(v, info.pmPos);
  if (!node) return;

  const wrapType = node.attrs.wrapType as string | undefined;
  const isFloating =
    node.attrs.displayMode === 'float' ||
    (wrapType ? ['square', 'tight', 'through'].includes(wrapType) : false);

  try {
    if (isFloating) {
      const viewport = overlayRootRef.value?.closest('.docx-editor-vue__pages-viewport');
      const pages = viewport?.querySelectorAll<HTMLElement>('.layout-page');
      if (!pages || pages.length === 0) return;

      let contentEl: HTMLElement | null = null;
      for (const page of pages) {
        const r = page.getBoundingClientRect();
        if (clientY >= r.top && clientY <= r.bottom) {
          contentEl = page.querySelector<HTMLElement>('.layout-page-content');
          break;
        }
      }
      if (!contentEl) {
        contentEl = pages[pages.length - 1].querySelector<HTMLElement>('.layout-page-content');
      }
      if (!contentEl) return;

      const contentRect = contentEl.getBoundingClientRect();
      const z = props.zoom;
      const dropX = (clientX - contentRect.left) / z;
      const dropY = (clientY - contentRect.top) / z;
      const newPosition = {
        horizontal: { posOffset: pixelsToEmu(dropX), relativeTo: 'margin' },
        vertical: { posOffset: pixelsToEmu(dropY), relativeTo: 'margin' },
      };

      const tr = v.state.tr.setNodeMarkup(info.pmPos, undefined, {
        ...node.attrs,
        position: newPosition,
      });
      v.dispatch(tr);
      reselectImage(info.pmPos);
    } else {
      // Map the drop point to a PM position via the *visible pages* hit-test —
      // the hidden ProseMirror lives off-screen, so `view.posAtCoords` would
      // never intersect it. Mirrors how the editor places the caret on click.
      const pagesEl = overlayRootRef.value
        ?.closest('.docx-editor-vue__pages-viewport')
        ?.querySelector<HTMLElement>('.docx-editor-vue__pages');
      if (!pagesEl) return;
      const dropPos = resolveDomPosition(pagesEl, clientX, clientY, 1);
      if (dropPos == null || dropPos < 0) return;
      if (dropPos === info.pmPos || dropPos === info.pmPos + 1) return;

      let tr = v.state.tr;
      const size = node.nodeSize;
      if (dropPos <= info.pmPos) {
        tr = tr.delete(info.pmPos, info.pmPos + size);
        tr = tr.insert(dropPos, node);
        v.dispatch(tr);
        reselectImage(dropPos);
      } else {
        tr = tr.delete(info.pmPos, info.pmPos + size);
        const adjusted = Math.min(dropPos - size, tr.doc.content.size);
        tr = tr.insert(adjusted, node);
        v.dispatch(tr);
        reselectImage(Math.min(adjusted, v.state.doc.content.size - 1));
      }
    }
  } catch {
    /* position invalid after concurrent edits */
  }
  nextTick(() => updatePosition());
}

function reselectImage(pos: number) {
  const v = props.view;
  if (!v) return;
  try {
    const sel = NodeSelection.create(v.state.doc, pos);
    v.dispatch(v.state.tr.setSelection(sel));
  } catch {
    /* ignore */
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
  document.removeEventListener('mousemove', onRotateMove);
  document.removeEventListener('mouseup', onRotateEnd);
  if (dragMoveListener) document.removeEventListener('mousemove', dragMoveListener);
  if (dragUpListener) document.removeEventListener('mouseup', dragUpListener);
  if (moveGhostEl) {
    moveGhostEl.remove();
    moveGhostEl = null;
  }
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
.image-overlay__body {
  position: absolute;
  inset: 0;
  pointer-events: auto;
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
  box-sizing: border-box;
  pointer-events: auto;
}
.image-overlay__rotate-line {
  position: absolute;
  left: 50%;
  top: -22px;
  width: 0;
  height: 22px;
  border-left: 1px solid #2563eb;
  pointer-events: none;
}
.image-overlay__rotate-handle {
  position: absolute;
  top: -32px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #2563eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  cursor: grab;
  z-index: 16;
  box-sizing: border-box;
  pointer-events: auto;
}
.image-overlay__rotate-handle:active {
  cursor: grabbing;
}
.image-overlay__dim {
  position: absolute;
  bottom: -24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
}
.image-overlay__dim--rotate {
  bottom: auto;
  top: -52px;
}
</style>
