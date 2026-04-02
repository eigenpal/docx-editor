<template>
  <div v-if="isOpen" class="dialog-overlay" @mousedown.self="close">
    <div class="dialog" @mousedown.stop @keydown.stop>
      <div class="dialog__header">
        <span class="dialog__title">Image Properties</span>
        <button class="dialog__close" @click="close">✕</button>
      </div>
      <div class="dialog__body">
        <!-- Alt text -->
        <div class="field">
          <label class="field__label">Alt text</label>
          <textarea v-model="altText" class="field__textarea" placeholder="Describe this image for accessibility" rows="2"></textarea>
        </div>

        <!-- Wrap type -->
        <div class="field">
          <label class="field__label">Text wrapping</label>
          <select v-model="wrapType" class="field__select">
            <option value="inline">Inline with text</option>
            <option value="wrapRight">Wrap text (float left)</option>
            <option value="wrapLeft">Wrap text (float right)</option>
            <option value="topAndBottom">Top and bottom</option>
            <option value="behind">Behind text</option>
            <option value="inFront">In front of text</option>
          </select>
        </div>

        <!-- Border -->
        <div class="field">
          <label class="field__label">Border</label>
          <div class="field-row">
            <label>Width:
              <input v-model.number="borderWidth" type="number" min="0" max="20" step="0.5" class="field__input--small" />px
            </label>
            <label>Style:
              <select v-model="borderStyle" class="field__select--small">
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
                <option value="double">Double</option>
              </select>
            </label>
            <label>Color:
              <input v-model="borderColor" type="color" class="field__color" />
            </label>
          </div>
        </div>

        <!-- Dimensions -->
        <div class="field">
          <label class="field__label">Dimensions</label>
          <div class="field-row">
            <label>Width: <input v-model.number="width" type="number" min="1" max="2000" class="field__input--small" />px</label>
            <label>Height: <input v-model.number="height" type="number" min="1" max="2000" class="field__input--small" />px</label>
          </div>
        </div>

        <div class="dialog__actions">
          <button class="dialog__btn" @click="close">Cancel</button>
          <button class="dialog__btn dialog__btn--primary" @mousedown.prevent="apply">Apply</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { EditorView } from 'prosemirror-view';

const props = defineProps<{
  isOpen: boolean;
  view: EditorView | null;
  pmPos: number | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const altText = ref('');
const wrapType = ref('inline');
const borderWidth = ref(0);
const borderStyle = ref('solid');
const borderColor = ref('#000000');
const width = ref(200);
const height = ref(150);

// Load current image attrs when dialog opens
watch(() => props.isOpen, (open) => {
  if (!open || !props.view || props.pmPos === null) return;
  try {
    const node = props.view.state.doc.nodeAt(props.pmPos);
    if (node && node.type.name === 'image') {
      altText.value = node.attrs.alt || '';
      borderWidth.value = node.attrs.borderWidth || 0;
      borderStyle.value = node.attrs.borderStyle || 'solid';
      borderColor.value = node.attrs.borderColor || '#000000';
      width.value = node.attrs.width || 200;
      height.value = node.attrs.height || 150;

      // Derive wrap type from attrs
      const dm = node.attrs.displayMode;
      const cf = node.attrs.cssFloat;
      const wt = node.attrs.wrapType;
      if (dm === 'float' && cf === 'left') wrapType.value = 'wrapRight';
      else if (dm === 'float' && cf === 'right') wrapType.value = 'wrapLeft';
      else if (dm === 'block') wrapType.value = 'topAndBottom';
      else if (wt === 'behind') wrapType.value = 'behind';
      else if (wt === 'inFront') wrapType.value = 'inFront';
      else wrapType.value = 'inline';
    }
  } catch { /* ignore */ }
});

function close() { emit('close'); }

function apply() {
  const v = props.view;
  if (!v || props.pmPos === null) return;

  try {
    const node = v.state.doc.nodeAt(props.pmPos);
    if (!node || node.type.name !== 'image') return;

    // Map wrap type to PM attributes
    let displayMode = 'inline';
    let cssFloat: string | null = null;
    let wrapTypeAttr = 'inline';

    switch (wrapType.value) {
      case 'wrapRight': displayMode = 'float'; cssFloat = 'left'; wrapTypeAttr = 'square'; break;
      case 'wrapLeft': displayMode = 'float'; cssFloat = 'right'; wrapTypeAttr = 'square'; break;
      case 'topAndBottom': displayMode = 'block'; wrapTypeAttr = 'topAndBottom'; break;
      case 'behind': displayMode = 'float'; cssFloat = 'none'; wrapTypeAttr = 'behind'; break;
      case 'inFront': displayMode = 'float'; cssFloat = 'none'; wrapTypeAttr = 'inFront'; break;
      default: displayMode = 'inline'; wrapTypeAttr = 'inline'; break;
    }

    const tr = v.state.tr.setNodeMarkup(props.pmPos, undefined, {
      ...node.attrs,
      alt: altText.value,
      width: width.value,
      height: height.value,
      borderWidth: borderWidth.value || undefined,
      borderStyle: borderWidth.value > 0 ? borderStyle.value : undefined,
      borderColor: borderWidth.value > 0 ? borderColor.value : undefined,
      displayMode,
      cssFloat,
      wrapType: wrapTypeAttr,
    });
    v.dispatch(tr);
  } catch { /* ignore */ }

  close();
}
</script>

<style scoped>
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 300; display: flex; align-items: center; justify-content: center; }
.dialog { background: #fff; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.2); min-width: 400px; max-width: 90vw; }
.dialog__header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; }
.dialog__title { font-weight: 600; font-size: 14px; color: #1f2937; }
.dialog__close { border: none; background: transparent; cursor: pointer; font-size: 14px; color: #6b7280; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 4px; }
.dialog__close:hover { background: #f3f4f6; }
.dialog__body { padding: 16px; }
.dialog__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.dialog__btn { padding: 6px 16px; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; font-size: 13px; background: #fff; }
.dialog__btn--primary { background: #3b82f6; color: #fff; border-color: #3b82f6; }
.dialog__btn--primary:hover { background: #2563eb; }

.field { margin-bottom: 14px; }
.field__label { display: block; font-size: 12px; font-weight: 500; color: #374151; margin-bottom: 4px; }
.field__textarea { width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; outline: none; resize: vertical; box-sizing: border-box; font-family: inherit; }
.field__textarea:focus { border-color: #3b82f6; }
.field__select { width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; outline: none; background: #fff; }
.field__select--small { padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; background: #fff; }
.field__input--small { width: 60px; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; }
.field__color { width: 32px; height: 26px; border: 1px solid #d1d5db; border-radius: 4px; padding: 1px; cursor: pointer; }
.field-row { display: flex; align-items: center; gap: 12px; font-size: 12px; color: #4b5563; flex-wrap: wrap; }
</style>
