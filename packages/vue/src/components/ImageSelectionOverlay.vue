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
import { pixelsToEmu } from '@docx-editor.dev/core/utils';
import { resolveDomPosition } from '@docx-editor.dev/core/flow-model/resolveDomPosition';
import {
  isFloatingImage,
  commitImageResize,
  commitImageFloatMove,
  commitImageInlineMove,
  calculateResizedImageDimensions,
  type ImageResizeHandle,
} from '@docx-editor.dev/core/prosemirror/imageCommit';
import { findBodyPmAnchor } from '@docx-editor.dev/core/flow-model';
import { findImageElement } from '@docx-editor.dev/core/painter-model';
import { Z_INDEX } from '../styles/zIndex';
import { computeImageOverlayRect } from '../composables/imageOverlayRect';
import { useTranslation } from '../i18n';

const { t } = useTranslation();

import type { ImageSelectionInfo } from './imageSelectionTypes';
export type { ImageSelectionInfo };

/** Resize handle position; the resize math lives in core (shared with React). */
type ResizeHandle = ImageResizeHandle;

const props = defineProps<{
  imageInfo: ImageSelectionInfo | null;
  zoom: number;
  view: EditorView | null;
  pagesAreCurrent: () => boolean;
  requestOverlayRefresh: () => void;
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

/** The scaled `.docx-editor-vue__pages` element this overlay is anchored to. */
function getPagesEl(): HTMLElement | null {
  return (
    overlayRootRef.value
      ?.closest('.docx-editor-vue__pages-viewport')
      ?.querySelector<HTMLElement>('.docx-editor-vue__pages') ?? null
  );
}

/**
 * The painted element to anchor the overlay to. After a resize / move / rotate
 * commits — or after the image is pushed onto another page — the painter
 * re-builds the visible pages, so the originally tracked element is detached.
 * Re-find the fresh one by the image's current PM position (covering inline,
 * floating, and block images) through the body-scoped `findBodyPmAnchor`, which
 * restricts the lookup to `.layout-page-content` so a header/footer run (a
 * separate PM doc whose positions overlap the body's) can never match. Mirrors
 * React's single-source resolution. Returns null if it's gone.
 */
function resolveImageEl(): HTMLElement | null {
  if (!props.pagesAreCurrent()) return null;
  const info = props.imageInfo;
  if (!info) return null;
  if (info.element.isConnected) return info.element;
  const pages = getPagesEl();
  if (!pages) return null;
  const anchor = findBodyPmAnchor(pages, info.pmPos);
  return anchor ? findImageElement(anchor) : null;
}

function updatePosition() {
  if (!props.pagesAreCurrent()) {
    overlayRect.value = null;
    props.requestOverlayRefresh();
    return;
  }
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

  // The overlay is `position: absolute` inside its offsetParent, the scroll
  // container (`.docx-editor-vue__pages-viewport`). Absolutely-positioned
  // children are placed relative to the *content* origin, so the scroll offset
  // is added back, and the inline-start scrollbar gutter (from
  // `scrollbar-gutter: stable both-edges`) is subtracted — otherwise the frame
  // lands `scrollTop` px too high after scrolling, or shifted right by the
  // gutter width on platforms with classic scrollbars (issue #764). See
  // `computeImageOverlayRect` for the geometry.
  overlayRect.value = computeImageOverlayRect({
    imageRect,
    parentRect,
    scrollLeft: parent.scrollLeft,
    scrollTop: parent.scrollTop,
    parentOffsetWidth: parent.offsetWidth,
    parentClientWidth: parent.clientWidth,
    zoom: props.zoom,
  });
}

// The image's painted position can keep moving for a few frames after a
// trigger, and this overlay — unlike React's, which lives *inside* the scaled
// container and tracks for free — sits in the unscaled viewport and must
// re-anchor itself across that window. Two triggers need it:
//   - Selecting an image right after load: `.docx-editor-vue__pages` re-centers
//     horizontally as the layout settles (a `translateX` change, so no
//     ResizeObserver would catch it), shifting the image out from under a
//     frame measured one frame too early (issue #764).
//   - Zoom: the pages `transform` animates over ~0.2s (DocxEditor.vue
//     `pagesContainerStyle`); `transitionend` is unreliable (never fires under
//     `prefers-reduced-motion`).
//
// So recompute each frame until the rect holds steady — but only honor
// steadiness AFTER a minimum window: in the first frame or two the rect is
// momentarily steady at its pre-transition position, and latching there strands
// the frame. Track elapsed time from the rAF timestamp (not a per-frame guess)
// so high-refresh displays can't race through the window, and cap it so a
// perpetually-moving rect can't spin.
const SETTLE_MIN_MS = 250; // covers the 0.2s pages transform transition + buffer
const SETTLE_CAP_MS = 700; // hard stop so a perpetually-moving rect can't spin

// Cancel for the in-flight re-anchor loop. Only one runs at a time — a fresh
// trigger cancels and restarts it so overlapping triggers don't pile up rAFs.
let cancelReanchor: (() => void) | null = null;

// Re-measure the frame against the image every frame until the layout holds
// steady. The image's painted position keeps moving for a few frames after a
// trigger (zoom and the comments-sidebar shift both animate the pages
// `transform` over ~0.2s — see DocxEditor.vue `pagesContainerStyle`), and this
// overlay — unlike React's, which lives *inside* the scaled+translated container
// and tracks for free — sits in the unscaled viewport and must re-anchor across
// that window. Only honor steadiness AFTER a minimum window: in the first frame
// or two the rect is momentarily steady at its pre-transition position, and
// latching there strands the frame. Track elapsed from the rAF timestamp so
// high-refresh displays can't race through the window; cap it so a
// perpetually-moving rect can't spin.
function scheduleReanchor() {
  cancelReanchor?.();
  let raf = 0;
  let prevKey = '';
  let stableFrames = 0;
  let startTs = 0;
  const step = (ts: number) => {
    if (startTs === 0) startTs = ts;
    const elapsed = ts - startTs;
    updatePosition();
    const r = overlayRect.value;
    const key = r ? `${r.left}|${r.top}|${r.width}|${r.height}` : '';
    stableFrames = key === prevKey ? stableFrames + 1 : 0;
    prevKey = key;
    const settled = elapsed >= SETTLE_MIN_MS && stableFrames >= 2;
    if (!settled && elapsed < SETTLE_CAP_MS) {
      raf = requestAnimationFrame(step);
    }
  };
  raf = requestAnimationFrame(step);
  // Safety net: rAF is paused while the tab is backgrounded, so a timer also
  // re-measures once the layout has settled, guaranteeing a correct final anchor.
  const settleTimer = setTimeout(updatePosition, SETTLE_MIN_MS);
  cancelReanchor = () => {
    cancelAnimationFrame(raf);
    clearTimeout(settleTimer);
  };
}

// Re-anchor when the selected image changes. The first rAF step runs after Vue
// has mounted the `v-if` overlay, so `overlayRootRef` is available by then.
watch(
  () => props.imageInfo,
  (_info, _prev, onCleanup) => {
    if (!props.imageInfo) {
      overlayRect.value = null;
      return;
    }
    scheduleReanchor();
    onCleanup(() => cancelReanchor?.());
  },
  { immediate: true }
);

// Re-anchor when zoom changes.
watch(
  () => props.zoom,
  () => {
    if (!props.imageInfo) return;
    scheduleReanchor();
  }
);

// While an image is selected, keep the frame on it across the layout shifts
// that fire no zoom/imageInfo event: page scroll/resize, and the comments
// sidebar sliding `.docx-editor-vue__pages` sideways (a `translateX`) to make
// room for the panel. The sidebar shift moves the image with no scroll/resize
// event, so observe the pages container's style and re-anchor through the
// ~0.2s transition — React's overlay lives inside that container and tracks for
// free. The transform observer is deferred to the next tick because the overlay
// mounts via `v-if`, so `getPagesEl` isn't resolvable until then.
watch(
  () => props.imageInfo,
  (_newVal, _oldVal, onCleanup) => {
    if (!props.imageInfo) return;

    const handleScrollOrResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updatePosition);
    };

    // The viewport itself is the scroll container (`overflow-y: auto`); its
    // parent `.docx-editor-vue__editor-area` is `overflow: hidden` and never
    // scrolls. `scroll` events don't bubble, so the listener must sit on the
    // viewport or it never fires and the overlay drifts off the image on scroll.
    const viewport = overlayRootRef.value?.closest('.docx-editor-vue__pages-viewport');
    viewport?.addEventListener('scroll', handleScrollOrResize, { passive: true });
    window.addEventListener('resize', handleScrollOrResize, { passive: true });

    let transformObserver: MutationObserver | null = null;
    let cancelled = false;
    nextTick(() => {
      if (cancelled || !props.imageInfo) return;
      const pages = getPagesEl();
      if (!pages) return;
      transformObserver = new MutationObserver(() => scheduleReanchor());
      transformObserver.observe(pages, { attributes: true, attributeFilter: ['style'] });
    });

    onCleanup(() => {
      cancelled = true;
      viewport?.removeEventListener('scroll', handleScrollOrResize);
      window.removeEventListener('resize', handleScrollOrResize);
      transformObserver?.disconnect();
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

  // `overlayRect` is kept in layout (unscaled) px — the same space the image's
  // `width`/`height` attrs and the resize/drag math live in. But the overlay's
  // offsetParent is `.docx-editor-vue__pages-viewport`, which is NOT scaled
  // (only the inner `.docx-editor-vue__pages` carries `transform: scale(zoom)`).
  // So position the box at real (post-scale) px and scale its contents — border,
  // handles and rotate handle all grow with zoom, mirroring React's overlay,
  // which sits inside its scaled container and scales for free.
  const z = props.zoom || 1;

  return {
    position: 'absolute' as const,
    left: `${r.left * z}px`,
    top: `${r.top * z}px`,
    width: `${w}px`,
    height: `${h}px`,
    transform: z === 1 ? undefined : `scale(${z})`,
    transformOrigin: 'top left' as const,
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
// The dimension math lives in core (`calculateResizedImageDimensions`), shared
// with the React overlay.

function startResize(e: MouseEvent, handle: string) {
  if (!props.imageInfo || !overlayRect.value) return;
  if (!props.pagesAreCurrent()) {
    props.requestOverlayRefresh();
    return;
  }
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

  const dims = calculateResizedImageDimensions(
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
  if (!props.pagesAreCurrent()) {
    props.requestOverlayRefresh();
    return;
  }
  if (!v || !info) {
    updatePosition();
    return;
  }

  // `setNodeMarkup` doesn't reliably keep the NodeSelection on the node, so
  // re-assert it (mirrors React's `setNodeSelection` after resize). Without
  // this the selection collapses to a text caret and the overlay clears.
  const sel = commitImageResize(v, info.pmPos, currentWidth.value, currentHeight.value);
  if (sel !== null) reselectImage(sel);
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
  if (!props.pagesAreCurrent()) {
    props.requestOverlayRefresh();
    return;
  }
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
  if (!props.pagesAreCurrent()) {
    props.requestOverlayRefresh();
    if (rotateImgEl) rotateImgEl.style.transform = '';
    rotateImgEl = null;
    rotateBaseTransform = null;
    return;
  }
  try {
    const node = v && info ? getImageNode(v, info.pmPos) : null;
    if (v && info && node) {
      v.dispatch(
        v.state.tr.setNodeMarkup(info.pmPos, undefined, {
          ...node.attrs,
          transform: writeRotation(node.attrs.transform as string, currentRotation.value),
        })
      );
      // Keep the image node-selected after the markup change (see onResizeEnd).
      reselectImage(info.pmPos);
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
  if (!props.pagesAreCurrent()) {
    props.requestOverlayRefresh();
    return;
  }
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
  if (!props.pagesAreCurrent()) {
    props.requestOverlayRefresh();
    return;
  }
  const v = props.view;
  const info = props.imageInfo;
  if (!v || !info) return;
  const node = getImageNode(v, info.pmPos);
  if (!node) return;

  if (isFloatingImage(node)) {
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
    const hEmu = pixelsToEmu((clientX - contentRect.left) / z);
    const vEmu = pixelsToEmu((clientY - contentRect.top) / z);
    const sel = commitImageFloatMove(v, info.pmPos, hEmu, vEmu);
    if (sel !== null) reselectImage(sel);
  } else {
    // Map the drop point to a PM position via the *visible pages* hit-test —
    // the hidden ProseMirror lives off-screen, so `view.posAtCoords` would
    // never intersect it. Mirrors how the editor places the caret on click.
    const pagesEl = getPagesEl();
    if (!pagesEl) return;
    const dropPos = resolveDomPosition(pagesEl, clientX, clientY, 1);
    if (dropPos == null || dropPos < 0) return;
    const sel = commitImageInlineMove(v, info.pmPos, dropPos);
    if (sel !== null) reselectImage(sel);
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
  cancelReanchor?.();
});
</script>

<style scoped>
.image-overlay {
  overflow: visible;
}
.image-overlay__border {
  position: absolute;
  inset: -2px;
  border: 2px solid var(--doc-primary);
  border-radius: 2px;
  pointer-events: none;
}
.image-overlay__body {
  position: absolute;
  inset: 0;
  pointer-events: auto;
}
/* White circular dots with a thin accent ring — matches the resize handles in
   Word / PowerPoint. Mirrors the React overlay's handleBaseStyles. */
.image-overlay__handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: var(--doc-surface);
  border: 1.5px solid var(--doc-primary);
  box-shadow: 0 1px 2.5px var(--doc-shadow-strong);
  border-radius: 50%;
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
  border-left: 1px solid var(--doc-primary);
  pointer-events: none;
}
.image-overlay__rotate-handle {
  position: absolute;
  top: -32px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--doc-surface);
  border: 2px solid var(--doc-primary);
  box-shadow: 0 1px 3px var(--doc-shadow-strong);
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
  background: var(--doc-overlay);
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
