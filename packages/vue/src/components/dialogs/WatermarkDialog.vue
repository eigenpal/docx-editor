<!-- Watermark dialog — mirrors packages/react/src/components/dialogs/WatermarkDialog.tsx.
     Choose No watermark, a Picture watermark (image + scale + washout), or a Text
     watermark (preset or custom text, font, size, color, layout, semitransparent).
     On apply it emits a `Watermark` (or `null` to remove); the host applies it via
     the undoable `setWatermark` command. -->
<template>
  <div v-if="isOpen" class="wm-overlay" @mousedown.self="close" @keydown="onKeydown">
    <div class="wm-dialog" role="dialog" :aria-label="t('dialogs.watermark.title')" @mousedown.stop>
      <div class="wm-header">{{ t('dialogs.watermark.title') }}</div>

      <div class="wm-body">
        <!-- No watermark -->
        <div class="wm-radio-row">
          <input id="wm-none" type="radio" :checked="mode === 'none'" @change="mode = 'none'" />
          <label for="wm-none" class="wm-inline-label">{{ t('dialogs.watermark.noWatermark') }}</label>
        </div>

        <!-- Picture watermark -->
        <div class="wm-radio-row">
          <input
            id="wm-picture"
            type="radio"
            :checked="mode === 'picture'"
            @change="mode = 'picture'"
          />
          <label for="wm-picture" class="wm-inline-label">{{ t('dialogs.watermark.picture') }}</label>
        </div>
        <div v-if="mode === 'picture'" class="wm-subform">
          <div class="wm-row">
            <input type="file" accept="image/*" @change="onPickFile" />
          </div>
          <div v-if="pictureUrl" class="wm-row">
            <img :src="pictureUrl" alt="" class="wm-preview" />
          </div>
          <div class="wm-row">
            <span class="wm-label">{{ t('dialogs.watermark.scale') }}</span>
            <input
              class="wm-input wm-input--narrow"
              type="number"
              min="10"
              max="500"
              v-model.number="scale"
            />
            <span class="wm-unit">%</span>
          </div>
          <label class="wm-inline-label">
            <input type="checkbox" v-model="washout" />
            {{ t('dialogs.watermark.washout') }}
          </label>
        </div>

        <!-- Text watermark -->
        <div class="wm-radio-row">
          <input id="wm-text" type="radio" :checked="mode === 'text'" @change="mode = 'text'" />
          <label for="wm-text" class="wm-inline-label">{{ t('dialogs.watermark.text') }}</label>
        </div>
        <div v-if="mode === 'text'" class="wm-subform">
          <div class="wm-row">
            <span class="wm-label">{{ t('dialogs.watermark.presetLabel') }}</span>
            <select class="wm-input" :value="PRESETS.includes(text) ? text : ''" @change="onPreset">
              <option value="">—</option>
              <option v-for="p in PRESETS" :key="p" :value="p">{{ p }}</option>
            </select>
          </div>
          <div class="wm-row">
            <span class="wm-label">{{ t('dialogs.watermark.textLabel') }}</span>
            <input class="wm-input" v-model="text" />
          </div>
          <div class="wm-row">
            <span class="wm-label">{{ t('dialogs.watermark.fontLabel') }}</span>
            <select class="wm-input" v-model="font">
              <option v-for="f in FONTS" :key="f" :value="f">{{ f }}</option>
            </select>
          </div>
          <div class="wm-row">
            <span class="wm-label">{{ t('dialogs.watermark.sizeLabel') }}</span>
            <label class="wm-inline-label">
              <input type="checkbox" v-model="autoSize" />
              {{ t('dialogs.watermark.sizeAuto') }}
            </label>
            <input
              v-if="!autoSize"
              class="wm-input wm-input--narrow"
              type="number"
              min="8"
              max="200"
              v-model.number="fontSize"
            />
          </div>
          <div class="wm-row">
            <span class="wm-label">{{ t('dialogs.watermark.colorLabel') }}</span>
            <input type="color" v-model="color" />
          </div>
          <div class="wm-row">
            <span class="wm-label">{{ t('dialogs.watermark.layoutLabel') }}</span>
            <label class="wm-inline-label">
              <input
                type="radio"
                name="wm-layout"
                :checked="layout === 'diagonal'"
                @change="layout = 'diagonal'"
              />
              {{ t('dialogs.watermark.diagonal') }}
            </label>
            <label class="wm-inline-label">
              <input
                type="radio"
                name="wm-layout"
                :checked="layout === 'horizontal'"
                @change="layout = 'horizontal'"
              />
              {{ t('dialogs.watermark.horizontal') }}
            </label>
          </div>
          <label class="wm-inline-label">
            <input type="checkbox" v-model="semitransparent" />
            {{ t('dialogs.watermark.semitransparent') }}
          </label>
        </div>
      </div>

      <div class="wm-footer">
        <button type="button" class="wm-btn" @click="close">
          {{ t('dialogs.watermark.cancelButton') }}
        </button>
        <button
          type="button"
          class="wm-btn wm-btn--primary"
          :class="{ 'wm-btn--disabled': applyDisabled }"
          :disabled="applyDisabled"
          @click="apply"
        >
          {{ t('dialogs.watermark.applyButton') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Watermark } from '@eigenpal/docx-editor-core/types/document';
import { pictureWatermarkDisplayEmu } from '@eigenpal/docx-editor-core/types/document';
import { useTranslation } from '../../i18n';

type Mode = 'none' | 'picture' | 'text';

const PRESETS = ['CONFIDENTIAL', 'DRAFT', 'DO NOT COPY', 'SAMPLE', 'URGENT', 'ASAP'];
const FONTS = ['Calibri', 'Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New'];

const { t } = useTranslation();

const props = defineProps<{
  isOpen: boolean;
  current?: Watermark;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'apply', watermark: Watermark | null): void;
}>();

const mode = ref<Mode>('none');
// Text
const text = ref('CONFIDENTIAL');
const font = ref('Calibri');
const autoSize = ref(true);
const fontSize = ref(54);
const color = ref('#C0C0C0');
const layout = ref<'diagonal' | 'horizontal'>('diagonal');
const semitransparent = ref(true);
// Picture
const pictureUrl = ref<string | undefined>(undefined);
// Display dimensions (EMUs) for the picked image, preserving aspect ratio.
const pictureDims = ref<{ widthEmu: number; heightEmu: number } | undefined>(undefined);
const scale = ref(100);
const washout = ref(true);

// Seed the form from the current watermark each time the dialog opens.
watch(
  () => props.isOpen,
  (open) => {
    if (!open) return;
    const current = props.current;
    if (current?.kind === 'text') {
      mode.value = 'text';
      text.value = current.text;
      font.value = current.font || 'Calibri';
      autoSize.value = current.fontSize === undefined;
      if (current.fontSize !== undefined) fontSize.value = current.fontSize;
      color.value = current.color || '#C0C0C0';
      layout.value = current.layout;
      semitransparent.value = current.semitransparent;
    } else if (current?.kind === 'picture') {
      mode.value = 'picture';
      pictureUrl.value = current.dataUrl;
      pictureDims.value =
        current.widthEmu !== undefined && current.heightEmu !== undefined
          ? { widthEmu: current.widthEmu, heightEmu: current.heightEmu }
          : undefined;
      scale.value = Math.round((current.scale || 1) * 100);
      washout.value = current.washout;
    } else {
      mode.value = 'none';
    }
  },
  { immediate: true }
);

const applyDisabled = computed(() => mode.value === 'picture' && !pictureUrl.value);

function onPreset(e: Event) {
  const value = (e.target as HTMLSelectElement).value;
  if (value) text.value = value;
}

function onPickFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const url = typeof reader.result === 'string' ? reader.result : undefined;
    pictureUrl.value = url;
    pictureDims.value = undefined;
    if (!url) return;
    // Measure the natural size so the watermark keeps the image's aspect ratio.
    const img = new Image();
    img.onload = () => {
      pictureDims.value = pictureWatermarkDisplayEmu(img.naturalWidth, img.naturalHeight);
    };
    img.src = url;
  };
  reader.readAsDataURL(file);
}

function close() {
  emit('close');
}

function apply() {
  if (mode.value === 'none') {
    emit('apply', null);
  } else if (mode.value === 'text') {
    emit('apply', {
      kind: 'text',
      text: text.value,
      font: font.value,
      color: color.value,
      semitransparent: semitransparent.value,
      layout: layout.value,
      fontSize: autoSize.value ? undefined : fontSize.value,
    });
  } else {
    if (!pictureUrl.value) return;
    emit('apply', {
      kind: 'picture',
      dataUrl: pictureUrl.value,
      scale: scale.value / 100,
      washout: washout.value,
      ...(pictureDims.value ?? {}),
    });
  }
  close();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}
</script>

<style scoped>
.wm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}
.wm-dialog {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  min-width: 400px;
  max-width: 480px;
  width: 100%;
  margin: 20px;
}
.wm-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--doc-border);
  font-size: 16px;
  font-weight: 600;
  color: var(--doc-text);
}
.wm-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.wm-radio-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wm-subform {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wm-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.wm-label {
  width: 80px;
  font-size: 13px;
  color: var(--doc-text-muted);
  flex-shrink: 0;
}
.wm-inline-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--doc-text);
}
.wm-input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--doc-border);
  border-radius: 4px;
  font-size: 13px;
  background: #fff;
  color: var(--doc-text);
  box-sizing: border-box;
}
.wm-input--narrow {
  flex: unset;
  width: 80px;
}
.wm-input:focus {
  outline: none;
  border-color: var(--doc-primary);
}
.wm-unit {
  font-size: 11px;
  color: var(--doc-text-muted);
  flex-shrink: 0;
}
.wm-preview {
  max-height: 60px;
  max-width: 120px;
}
.wm-footer {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--doc-border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.wm-btn {
  padding: 6px 16px;
  font-size: 13px;
  border: 1px solid var(--doc-border);
  border-radius: 4px;
  cursor: pointer;
  background: #fff;
  color: var(--doc-text);
}
.wm-btn:hover {
  background: #f9fafb;
}
.wm-btn--primary {
  background: var(--doc-primary);
  color: #fff;
  border-color: var(--doc-primary);
}
.wm-btn--primary:hover {
  background: var(--doc-primary-hover);
}
.wm-btn--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
