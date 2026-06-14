<template>
  <div v-if="isOpen" class="hf-editor" :style="overlayStyle">
    <div
      class="hf-editor__toolbar"
      :class="position === 'footer' ? 'hf-editor__toolbar--below' : 'hf-editor__toolbar--above'"
      @mousedown.stop
      @contextmenu.stop
    >
      <span class="hf-editor__label">{{ position === 'header' ? 'Header' : 'Footer' }}</span>
      <div class="hf-editor__actions" style="position: relative">
        <button
          class="hf-editor__btn"
          title="Options"
          @mousedown.prevent
          @click="showOptions = !showOptions"
        >
          Options ▾
        </button>
        <div
          v-if="showOptions"
          class="hf-editor__dropdown"
          @mousedown.stop
          @contextmenu.stop
        >
          <button
            type="button"
            class="hf-editor__dropdown-item"
            @click="
              showOptions = false;
              insertField('PAGE');
            "
          >
            Insert current page number
          </button>
          <button
            type="button"
            class="hf-editor__dropdown-item"
            @click="
              showOptions = false;
              insertField('NUMPAGES');
            "
          >
            Insert total page count
          </button>
        </div>
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
  </div>
</template>

<script setup lang="ts">
/**
 * InlineHeaderFooterEditor — UI chrome only (Vue parity for the React-side
 * phase 5 of the HF editing unification, openspec/changes/unify-hf-editing).
 *
 * The component no longer mounts its own ProseMirror EditorView. The
 * painter is the sole visible HF renderer (the `.layout-page-header` /
 * `.layout-page-footer` region of the page), and the persistent hidden
 * HF PM mounted by `useDocxEditor.syncHfPMs` is the sole editor. This
 * overlay just floats the toolbar (Remove / Save / Cancel) over the
 * painted region and wires save-on-click into the persistent PM via the
 * `view` prop.
 */
import { ref, watch } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { proseDocToBlocks } from '@eigenpal/docx-editor-core/prosemirror/conversion';
import { schema } from '@eigenpal/docx-editor-core/prosemirror';

const props = defineProps<{
  isOpen: boolean;
  position: 'header' | 'footer';
  /**
   * Persistent hidden HF EditorView for this slot. Provided by
   * `useDocxEditor.getHfPmView(headerFooter)` upstream. Save reads its
   * current doc; the painter has already been reading it since
   * `runLayoutPipeline` routes HF rendering through
   * `convertHeaderFooterPmDocToContent` whenever a view exists.
   */
  view?: EditorView | null;
  /** Position of the HF region relative to the editor's pages-viewport. */
  targetRect?: { top: number; left: number; width: number; height: number } | null;
}>();

const emit = defineEmits<{
  /**
   * Emitted with the persistent PM's current content blocks
   * (paragraphs / tables). Caller writes them back into the right
   * `pkg.headers/footers[rId].content` and triggers a re-layout — see
   * `usePagesPointer.handleHfSave`.
   */
  (e: 'save', content: ReturnType<typeof proseDocToBlocks>): void;
  (e: 'close'): void;
  (e: 'remove'): void;
}>();

const overlayStyle = ref<Record<string, string>>({});
const showOptions = ref(false);

function insertField(fieldType: 'PAGE' | 'NUMPAGES') {
  const view = props.view;
  if (!view) return;
  const { $from, from } = view.state.selection;
  const marks = view.state.storedMarks || $from.marks();
  const node = schema.nodes.field.create({
    fieldType,
    instruction: ` ${fieldType} \\* MERGEFORMAT `,
    fieldKind: 'simple',
    dirty: true,
  });
  view.dispatch(view.state.tr.insert(from, node.mark(marks)));
  view.focus();
}

function updatePosition() {
  const rect = props.targetRect;
  if (!rect) return;
  // Float just the chrome on top of the painted HF region. The PM lives
  // off-screen (mounted by useDocxEditor); we don't need its dimensions
  // here at all — the painter owns what the user sees.
  overlayStyle.value = {
    position: 'absolute',
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    zIndex: '100',
    // Container is invisible to the mouse — only the chrome toolbar inside
    // re-enables pointer events. Without this, clicks in the painted HF
    // region were swallowed by this overlay and the persistent HF
    // EditorView never received them (visible as "cursor doesn't move").
    pointerEvents: 'none',
  };
}

watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      updatePosition();
      // Phase 5 parity: focus the persistent PM on open so typing lands
      // in HF content right away. Click translation routes follow-up
      // clicks via usePagesPointer.
      props.view?.focus();
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

function handleSave() {
  if (!props.view) return;
  const blocks = proseDocToBlocks(props.view.state.doc);
  emit('save', blocks);
  emit('close');
}
</script>

<style scoped>
.hf-editor {
  /* Container itself has pointer-events: none (set inline) so painter clicks
     pass through. Border is purely visual chrome. */
  border: 2px solid var(--doc-primary);
  border-radius: 4px;
}
.hf-editor__toolbar {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: var(--doc-primary-light);
  box-shadow: 0 1px 4px var(--doc-shadow-subtle);
  pointer-events: auto;
}
.hf-editor__toolbar--above {
  bottom: 100%;
  border-bottom: 1px solid var(--doc-primary-light);
}
.hf-editor__toolbar--below {
  top: 100%;
  border-top: 1px solid var(--doc-primary-light);
}
.hf-editor__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--doc-primary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.hf-editor__actions {
  display: flex;
  gap: 4px;
}
.hf-editor__btn {
  padding: 3px 10px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 3px;
  background: var(--doc-surface);
  cursor: pointer;
  font-size: 12px;
  color: var(--doc-text-muted);
}
.hf-editor__btn:hover {
  background: var(--doc-bg-hover);
}
.hf-editor__btn--primary {
  background: var(--doc-primary);
  color: var(--doc-on-primary);
  border-color: var(--doc-primary);
}
.hf-editor__btn--primary:hover {
  background: var(--doc-primary-hover);
}
.hf-editor__dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 2px;
  background: var(--doc-surface);
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  box-shadow: 0 2px 8px var(--doc-shadow);
  min-width: 200px;
  z-index: 10;
  padding: 4px 0;
}
.hf-editor__dropdown-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  background: none;
  border: none;
  text-align: left;
  font-size: 13px;
  color: var(--doc-text-muted);
  cursor: pointer;
}
.hf-editor__dropdown-item:hover {
  background: var(--doc-bg-hover);
}
</style>
