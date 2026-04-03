<template>
  <div v-if="isOpen" class="dialog-overlay" @mousedown.self="close">
    <div class="dialog" @mousedown.stop @keydown.stop>
      <div class="dialog__header">
        <span class="dialog__title">Insert Image</span>
        <button class="dialog__close" @click="close">✕</button>
      </div>
      <div class="dialog__body">
        <!-- Drop zone / file input -->
        <div
          class="drop-zone"
          :class="{ 'drop-zone--active': isDragOver }"
          @dragover.prevent="isDragOver = true"
          @dragleave="isDragOver = false"
          @drop.prevent="handleDrop"
          @click="fileInput?.click()"
        >
          <template v-if="!preview">
            <div class="drop-zone__icon">🖼️</div>
            <div class="drop-zone__text">Drop image here or click to browse</div>
            <div class="drop-zone__hint">PNG, JPG, GIF, SVG (max 10MB)</div>
          </template>
          <img v-else :src="preview" class="drop-zone__preview" alt="Preview" />
        </div>
        <input ref="fileInput" type="file" accept="image/*" style="display:none" @change="handleFileChange" />

        <div v-if="error" class="drop-zone__error">{{ error }}</div>

        <!-- Dimensions -->
        <div v-if="preview" class="image-controls">
          <label>Width: <input v-model.number="imgWidth" type="number" min="1" max="2000" class="dim-input" @input="onWidthChange" /></label>
          <label>Height: <input v-model.number="imgHeight" type="number" min="1" max="2000" class="dim-input" @input="onHeightChange" /></label>
          <label class="lock-label"><input type="checkbox" v-model="lockAspect" /> Lock ratio</label>
        </div>

        <!-- Alt text -->
        <div v-if="preview" class="image-controls">
          <label style="flex:1">Alt text: <input v-model="altText" class="alt-input" placeholder="Describe this image" /></label>
        </div>

        <!-- Actions -->
        <div v-if="preview" class="dialog__actions">
          <button class="dialog__btn" @click="reset">Clear</button>
          <button class="dialog__btn dialog__btn--primary" @mousedown.prevent="insertImage">Insert</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'insert', data: { src: string; width: number; height: number; alt: string }): void;
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const preview = ref('');
const imgWidth = ref(400);
const imgHeight = ref(300);
const lockAspect = ref(true);
const altText = ref('');
const error = ref('');
const isDragOver = ref(false);
let aspectRatio = 1;

function close() { emit('close'); }

function reset() {
  preview.value = '';
  error.value = '';
  altText.value = '';
  imgWidth.value = 400;
  imgHeight.value = 300;
}

function handleDrop(e: DragEvent) {
  isDragOver.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFile(file);
}

function handleFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) loadFile(file);
}

function loadFile(file: File) {
  error.value = '';
  if (!file.type.startsWith('image/')) {
    error.value = 'Please select an image file.';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    error.value = 'File too large (max 10MB).';
    return;
  }

  altText.value = file.name.replace(/\.[^.]+$/, '');
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result as string;
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      // Constrain to max 800x600
      if (w > 800) { h = Math.round(h * (800 / w)); w = 800; }
      if (h > 600) { w = Math.round(w * (600 / h)); h = 600; }
      imgWidth.value = w;
      imgHeight.value = h;
      aspectRatio = w / h;
      preview.value = dataUrl;
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

function onWidthChange() {
  if (lockAspect.value && aspectRatio) {
    imgHeight.value = Math.round(imgWidth.value / aspectRatio);
  }
}

function onHeightChange() {
  if (lockAspect.value && aspectRatio) {
    imgWidth.value = Math.round(imgHeight.value * aspectRatio);
  }
}

function insertImage() {
  if (!preview.value) return;
  emit('insert', {
    src: preview.value,
    width: imgWidth.value,
    height: imgHeight.value,
    alt: altText.value,
  });
  reset();
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
.dialog__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.dialog__btn { padding: 6px 16px; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; font-size: 13px; background: #fff; }
.dialog__btn--primary { background: #3b82f6; color: #fff; border-color: #3b82f6; }
.dialog__btn--primary:hover { background: #2563eb; }

.drop-zone { border: 2px dashed #d1d5db; border-radius: 8px; padding: 24px; text-align: center; cursor: pointer; transition: border-color 0.2s; min-height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.drop-zone:hover, .drop-zone--active { border-color: #3b82f6; background: #eff6ff; }
.drop-zone__icon { font-size: 32px; margin-bottom: 8px; }
.drop-zone__text { font-size: 13px; color: #374151; }
.drop-zone__hint { font-size: 11px; color: #9ca3af; margin-top: 4px; }
.drop-zone__preview { max-width: 100%; max-height: 200px; border-radius: 4px; }
.drop-zone__error { color: #dc2626; font-size: 12px; margin-top: 8px; }

.image-controls { display: flex; align-items: center; gap: 12px; margin-top: 12px; font-size: 13px; }
.dim-input { width: 70px; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; }
.alt-input { width: 100%; padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; margin-top: 4px; }
.lock-label { display: flex; align-items: center; gap: 4px; font-size: 12px; white-space: nowrap; }
</style>
