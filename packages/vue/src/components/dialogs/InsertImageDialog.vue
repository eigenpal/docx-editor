<template>
  <div v-if="isOpen" class="dialog-overlay" @mousedown.self="close">
    <div class="dialog" @mousedown.stop @keydown.stop>
      <div class="dialog__header">
        <span class="dialog__title">{{ t('dialogs.insertImage.title') }}</span>
        <button class="dialog__close" :aria-label="t('common.closeDialog')" @click="close">
          ✕
        </button>
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
            <div class="drop-zone__icon">
              <MaterialSymbol name="image" :size="48" />
            </div>
            <div class="drop-zone__text">{{ t('dialogs.insertImage.uploadText') }}</div>
            <div class="drop-zone__hint">{{ t('dialogs.insertImage.uploadSubtext') }}</div>
          </template>
          <img
            v-else
            :src="preview"
            class="drop-zone__preview"
            :alt="t('dialogs.insertImage.preview')"
          />
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          style="display: none"
          :aria-label="t('dialogs.insertImage.uploadAriaLabel')"
          @change="handleFileChange"
        />

        <div v-if="error" class="drop-zone__error">{{ error }}</div>

        <!-- Dimensions -->
        <div v-if="preview" class="image-controls">
          <label
            >{{ t('dialogs.insertImage.widthLabel') }}
            <input
              v-model.number="imgWidth"
              type="number"
              min="1"
              max="2000"
              class="dim-input"
              @input="onWidthChange"
          /></label>
          <label
            >{{ t('dialogs.insertImage.heightLabel') }}
            <input
              v-model.number="imgHeight"
              type="number"
              min="1"
              max="2000"
              class="dim-input"
              @input="onHeightChange"
          /></label>
          <label class="lock-label"
            ><input type="checkbox" v-model="lockAspect" />
            {{
              lockAspect
                ? t('dialogs.insertImage.aspectRatioLocked')
                : t('dialogs.insertImage.aspectRatioUnlocked')
            }}</label
          >
        </div>

        <!-- Alt text -->
        <div v-if="preview" class="image-controls">
          <label style="flex: 1"
            >{{ t('dialogs.insertImage.altTextLabel') }}
            <input
              v-model="altText"
              class="alt-input"
              :placeholder="t('dialogs.insertImage.altTextPlaceholder')"
          /></label>
        </div>

        <!-- Actions -->
        <div v-if="preview" class="dialog__actions">
          <button class="dialog__btn" @click="reset">{{ t('common.clear') }}</button>
          <button class="dialog__btn dialog__btn--primary" @mousedown.prevent="insertImage">
            {{ t('dialogs.insertImage.insertButton') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '../../i18n';
import MaterialSymbol from '../ui/MaterialSymbol.vue';

const { t } = useTranslation();

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

function close() {
  emit('close');
}

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
    error.value = t('dialogs.insertImage.invalidFile');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    error.value = t('dialogs.insertImage.fileTooLarge');
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
      if (w > 800) {
        h = Math.round(h * (800 / w));
        w = 800;
      }
      if (h > 600) {
        w = Math.round(w * (600 / h));
        h = 600;
      }
      imgWidth.value = w;
      imgHeight.value = h;
      aspectRatio = w / h;
      preview.value = dataUrl;
    };
    img.onerror = () => {
      error.value = t('dialogs.insertImage.loadFailed');
    };
    img.src = dataUrl;
  };
  reader.onerror = () => {
    error.value = t('dialogs.insertImage.readFailed');
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
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: var(--doc-overlay);
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog {
  background: var(--doc-surface);
  border-radius: 8px;
  box-shadow: 0 8px 30px var(--doc-shadow);
  min-width: 400px;
  max-width: 90vw;
}
.dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--doc-border);
}
.dialog__title {
  font-weight: 600;
  font-size: 14px;
  color: var(--doc-text);
}
.dialog__close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: var(--doc-text-muted);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.dialog__close:hover {
  background: var(--doc-bg-hover);
}
.dialog__body {
  padding: 16px;
}
.dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.dialog__btn {
  padding: 6px 16px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  background: var(--doc-surface);
}
.dialog__btn--primary {
  background: var(--doc-primary);
  color: var(--doc-on-primary);
  border-color: var(--doc-primary);
}
.dialog__btn--primary:hover {
  background: var(--doc-primary);
}

.drop-zone {
  border: 2px dashed var(--doc-border-dark);
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.drop-zone:hover,
.drop-zone--active {
  border-color: var(--doc-primary);
  background: var(--doc-primary-light);
}
.drop-zone__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--doc-text-subtle);
  margin-bottom: 8px;
}
.drop-zone__text {
  font-size: 13px;
  color: var(--doc-text-muted);
}
.drop-zone__hint {
  font-size: 11px;
  color: var(--doc-text-subtle);
  margin-top: 4px;
}
.drop-zone__preview {
  max-width: 100%;
  max-height: 200px;
  border-radius: 4px;
}
.drop-zone__error {
  color: var(--doc-error);
  font-size: 12px;
  margin-top: 8px;
}

.image-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  font-size: 13px;
}
.dim-input {
  width: 70px;
  padding: 4px 6px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  font-size: 13px;
}
.alt-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  font-size: 13px;
  margin-top: 4px;
}
.lock-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  white-space: nowrap;
}
</style>
