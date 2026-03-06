<template>
  <div class="docx-editor-vue">
    <BasicToolbar v-if="showToolbar" :view="editorView" />

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
import { ref, watch, onMounted, nextTick } from 'vue';
import BasicToolbar from './BasicToolbar.vue';
import { useDocxEditor } from '../composables/useDocxEditor';
import { TextSelection } from 'prosemirror-state';
import type { Document } from '@eigenpal/docx-core/types/document';
import { clickToPositionDom } from '@eigenpal/docx-core/layout-bridge/clickToPositionDom';

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
} = useDocxEditor({
  hiddenContainer: hiddenPmRef,
  pagesContainer: pagesRef,
  readOnly: props.readOnly,
  onChange: (doc) => emit('change', doc),
  onError: (err) => emit('error', err),
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

function handlePagesMouseDown(event: MouseEvent) {
  const container = pagesRef.value;
  const view = editorView.value;
  if (!container || !view) return;

  const pos = clickToPositionDom(container, event.clientX, event.clientY, 1);
  if (pos !== null && pos >= 0) {
    const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
    view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
    view.focus();
  } else {
    view.focus();
  }
}

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
