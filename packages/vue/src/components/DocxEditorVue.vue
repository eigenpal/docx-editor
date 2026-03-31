<template>
  <div class="docx-editor-vue">
    <BasicToolbar v-if="showToolbar" :view="editorView" :get-commands="getCommands" :state-tick="stateTick" />

    <div v-if="parseError" class="docx-editor-vue__error">
      {{ parseError }}
    </div>

    <div v-if="!isReady && !parseError" class="docx-editor-vue__loading">
      Loading...
    </div>

    <!-- Hidden ProseMirror (off-screen, receives keyboard input) -->
    <div ref="hiddenPmRef" class="docx-editor-vue__hidden-pm" />

    <!-- Visible pages (rendered by layout-painter) -->
    <div
      ref="pagesRef"
      class="docx-editor-vue__pages"
      @mousedown="handlePagesMouseDown"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import BasicToolbar from './BasicToolbar.vue';
import { useDocxEditor } from '../composables/useDocxEditor';
import { TextSelection } from 'prosemirror-state';
import type { Document } from '@eigenpal/docx-core/types/document';
import { clickToPositionDom } from '@eigenpal/docx-core/layout-bridge/clickToPositionDom';
import {
  getSelectionRectsFromDom,
  getCaretPositionFromDom,
} from '@eigenpal/docx-core/layout-bridge/clickToPositionDom';

const props = withDefaults(
  defineProps<{
    documentBuffer?: ArrayBuffer | null;
    document?: Document | null;
    showToolbar?: boolean;
    readOnly?: boolean;
  }>(),
  {
    documentBuffer: null,
    document: null,
    showToolbar: true,
    readOnly: false,
  }
);

const emit = defineEmits<{
  (e: 'change', doc: Document): void;
  (e: 'error', error: Error): void;
  (e: 'ready'): void;
}>();

const hiddenPmRef = ref<HTMLElement | null>(null);
const pagesRef = ref<HTMLElement | null>(null);
const stateTick = ref(0);

const {
  editorView,
  isReady,
  parseError,
  loadBuffer,
  loadDocument,
  save,
  focus,
  destroy,
  getDocument,
  getCommands,
} = useDocxEditor({
  hiddenContainer: hiddenPmRef,
  pagesContainer: pagesRef,
  readOnly: props.readOnly,
  onChange: (doc) => emit('change', doc),
  onError: (err) => emit('error', err),
  onSelectionUpdate: () => {
    stateTick.value++;
    updateSelectionOverlay();
  },
});

watch(
  () => props.documentBuffer,
  async (buf) => {
    if (buf) {
      await loadBuffer(buf);
      emit('ready');
    }
  }
);

watch(
  () => props.document,
  (doc) => {
    if (doc) {
      loadDocument(doc);
      emit('ready');
    }
  }
);

onMounted(async () => {
  await nextTick();
  if (props.documentBuffer) {
    await loadBuffer(props.documentBuffer);
    emit('ready');
  } else if (props.document) {
    loadDocument(props.document);
    emit('ready');
  }
});

// =========================================================================
// Selection & caret overlay
// =========================================================================

let caretBlinkInterval: ReturnType<typeof setInterval> | null = null;
let caretEl: HTMLElement | null = null;

function clearOverlay() {
  const container = pagesRef.value;
  if (!container) return;
  container.querySelectorAll('.vue-sel-rect, .vue-caret').forEach((el) => el.remove());
  if (caretBlinkInterval !== null) {
    clearInterval(caretBlinkInterval);
    caretBlinkInterval = null;
  }
  caretEl = null;
}

function updateSelectionOverlay() {
  const container = pagesRef.value;
  const view = editorView.value;
  if (!container || !view) return;

  clearOverlay();

  const { from, to, empty } = view.state.selection;

  // Account for scroll offset: overlays are position:absolute inside the
  // scrollable container, so we need to add scrollTop/scrollLeft to convert
  // viewport-relative coordinates from getBoundingClientRect to container-relative.
  const scrollTop = container.scrollTop;
  const scrollLeft = container.scrollLeft;

  if (empty) {
    // Draw blinking caret
    const overlayRect = container.getBoundingClientRect();
    const caret = getCaretPositionFromDom(container, from, overlayRect);
    if (caret) {
      const el = document.createElement('div');
      el.className = 'vue-caret';
      el.style.cssText = `
        position: absolute;
        left: ${caret.x + scrollLeft}px;
        top: ${caret.y + scrollTop}px;
        width: 1.5px;
        height: ${caret.height}px;
        background: #000;
        pointer-events: none;
        z-index: 2;
      `;
      container.appendChild(el);
      caretEl = el;

      // Blink
      let visible = true;
      caretBlinkInterval = setInterval(() => {
        visible = !visible;
        if (caretEl) caretEl.style.opacity = visible ? '1' : '0';
      }, 530);
    }
    return;
  }

  // Draw selection highlight rects (character-level)
  const overlayRect = container.getBoundingClientRect();
  const rects = getSelectionRectsFromDom(container, from, to, overlayRect);

  for (const rect of rects) {
    const el = document.createElement('div');
    el.className = 'vue-sel-rect';
    el.style.cssText = `
      position: absolute;
      left: ${rect.x + scrollLeft}px;
      top: ${rect.y + scrollTop}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      background: rgba(66, 133, 244, 0.3);
      pointer-events: none;
      z-index: 1;
    `;
    container.appendChild(el);
  }
}

// =========================================================================
// Drag-to-select support
// =========================================================================

let isDragging = false;
let dragAnchor: number | null = null;

function resolvePos(clientX: number, clientY: number): number | null {
  const container = pagesRef.value;
  if (!container) return null;
  const pos = clickToPositionDom(container, clientX, clientY, 1);
  if (pos === null || pos < 0) return null;
  const view = editorView.value;
  if (!view) return null;
  return Math.min(pos, view.state.doc.content.size);
}

function setPmSelection(anchor: number, head?: number) {
  const view = editorView.value;
  if (!view) return;
  const $anchor = view.state.doc.resolve(anchor);
  const $head = head !== undefined ? view.state.doc.resolve(head) : $anchor;
  const sel = TextSelection.between($anchor, $head);
  view.dispatch(view.state.tr.setSelection(sel));
}

function handlePagesMouseDown(event: MouseEvent) {
  if (event.button !== 0) return;
  const view = editorView.value;
  if (!view) return;

  // Prevent browser from moving focus to the pages div — PM must keep focus
  event.preventDefault();

  const pos = resolvePos(event.clientX, event.clientY);
  if (pos !== null) {
    setPmSelection(pos);
    dragAnchor = pos;
    isDragging = true;
  }
  view.focus();
}

function handleMouseMove(event: MouseEvent) {
  if (!isDragging || dragAnchor === null) return;
  const pos = resolvePos(event.clientX, event.clientY);
  if (pos !== null && pos !== dragAnchor) {
    setPmSelection(dragAnchor, pos);
  }
}

function handleMouseUp() {
  isDragging = false;
}

onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
});

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
  clearOverlay();
});

defineExpose({ save, focus, destroy, getDocument });
</script>

<style>
.docx-editor-vue {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.docx-editor-vue__hidden-pm {
  position: fixed;
  left: -9999px;
  top: 0;
  opacity: 0;
  z-index: -1;
  pointer-events: none;
  user-select: none;
  overflow-anchor: none;
}
.docx-editor-vue__pages {
  flex: 1;
  overflow-y: auto;
  background: var(--doc-bg, #f8f9fa);
  cursor: text;
  position: relative;
}
.docx-editor-vue__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: #64748b;
  font-size: 14px;
}
.docx-editor-vue__error {
  padding: 1rem;
  background: #fef2f2;
  color: #dc2626;
  font-size: 13px;
  border-bottom: 1px solid #fecaca;
}
</style>
