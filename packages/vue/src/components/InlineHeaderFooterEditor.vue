<template>
  <div
    v-if="isOpen"
    class="hf-editor"
    :style="overlayStyle"
    @mousedown.stop
    @contextmenu.stop
  >
    <div class="hf-editor__toolbar">
      <span class="hf-editor__label">{{ position === 'header' ? 'Header' : 'Footer' }}</span>
      <div class="hf-editor__actions">
        <button class="hf-editor__btn" title="Remove" @mousedown.prevent="$emit('remove')">
          Remove
        </button>
        <button
          class="hf-editor__btn hf-editor__btn--primary"
          title="Save"
          @mousedown.prevent="handleSave"
        >
          Save
        </button>
        <button class="hf-editor__btn" title="Cancel" @mousedown.prevent="$emit('close')">
          Cancel
        </button>
      </div>
    </div>
    <div ref="editorRef" class="hf-editor__content" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount, nextTick } from 'vue';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { singletonManager } from '@eigenpal/docx-editor-core/prosemirror/schema';
import {
  headerFooterToProseDoc,
  proseDocToBlocks,
} from '@eigenpal/docx-editor-core/prosemirror/conversion';
import type { HeaderFooter } from '@eigenpal/docx-editor-core/types/content';
import type {
  StyleDefinitions,
  Theme,
} from '@eigenpal/docx-editor-core/types/document';

import 'prosemirror-view/style/prosemirror.css';

const props = defineProps<{
  isOpen: boolean;
  position: 'header' | 'footer';
  /** The HeaderFooter being edited. Pass `null` to start from blank. */
  headerFooter: HeaderFooter | null;
  /** Style definitions used by toProseDoc to resolve paragraph styles. */
  styles?: StyleDefinitions | null;
  /** Theme used to resolve theme fonts/colors during ProseMirror conversion. */
  theme?: Theme | null;
  /** Position of the HF region relative to the editor's pages-viewport. */
  targetRect?: { top: number; left: number; width: number; height: number } | null;
}>();

const emit = defineEmits<{
  /**
   * Emitted with the updated content blocks (paragraphs / tables).
   * Caller is responsible for assigning these into the right
   * `pkg.headers`/`pkg.footers` Map entry and triggering a re-layout.
   */
  (e: 'save', content: ReturnType<typeof proseDocToBlocks>): void;
  (e: 'close'): void;
  (e: 'remove'): void;
}>();

const editorRef = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

const overlayStyle = ref<Record<string, string>>({});

function updatePosition() {
  const rect = props.targetRect;
  if (!rect) return;
  overlayStyle.value = {
    position: 'absolute',
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    minHeight: `${Math.max(rect.height, 60)}px`,
    zIndex: '100',
  };
}

watch(
  () => props.isOpen,
  async (open) => {
    if (open) {
      updatePosition();
      await nextTick();
      createEditor();
    } else {
      destroyEditor();
    }
  }
);

watch(
  () => props.targetRect,
  () => {
    if (props.isOpen) updatePosition();
  },
  { deep: true }
);

function createEditor() {
  const host = editorRef.value;
  if (!host || view) return;

  const mgr = singletonManager;
  const content = props.headerFooter?.content ?? [];
  const doc = headerFooterToProseDoc(content, {
    styles: props.styles ?? undefined,
    theme: props.theme ?? null,
  });

  const state = EditorState.create({
    doc,
    schema: mgr.getSchema(),
    plugins: mgr.getPlugins() ?? [],
  });

  view = new EditorView(host, {
    state,
    editable: () => true,
  });

  view.focus();
}

function destroyEditor() {
  if (view) {
    view.destroy();
    view = null;
  }
}

function handleSave() {
  if (!view) return;
  const blocks = proseDocToBlocks(view.state.doc);
  emit('save', blocks);
  emit('close');
}

onBeforeUnmount(() => {
  destroyEditor();
});
</script>

<style scoped>
.hf-editor {
  background: #fff;
  border: 2px solid #4285f4;
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}
.hf-editor__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: #f0f4ff;
  border-bottom: 1px solid #d0daf0;
}
.hf-editor__label {
  font-size: 12px;
  font-weight: 600;
  color: #1a73e8;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.hf-editor__actions {
  display: flex;
  gap: 4px;
}
.hf-editor__btn {
  padding: 3px 10px;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  color: #374151;
}
.hf-editor__btn:hover {
  background: #f3f4f6;
}
.hf-editor__btn--primary {
  background: #1a73e8;
  color: #fff;
  border-color: #1a73e8;
}
.hf-editor__btn--primary:hover {
  background: #1557b0;
}
.hf-editor__content {
  padding: 8px 12px;
  min-height: 40px;
  outline: none;
}
.hf-editor__content :deep(.ProseMirror) {
  outline: none;
  min-height: 30px;
}
</style>
