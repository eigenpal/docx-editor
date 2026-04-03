<template>
  <div v-if="isOpen" class="dialog-overlay" @mousedown.self="close">
    <div class="dialog" @mousedown.stop @keydown.stop>
      <div class="dialog__header">
        <span class="dialog__title">Page Setup</span>
        <button class="dialog__close" @click="close">✕</button>
      </div>
      <div class="dialog__body">
        <!-- Page size -->
        <div class="field">
          <label class="field__label">Page size</label>
          <select v-model="selectedSize" class="field__select" @change="onSizeChange">
            <option v-for="s in pageSizes" :key="s.label" :value="s.label">{{ s.label }}</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        <!-- Custom dimensions -->
        <div class="field field-row" v-if="selectedSize === 'custom'">
          <label>Width: <input v-model.number="widthInches" type="number" min="1" max="22" step="0.1" class="field__input--small" /> in</label>
          <label>Height: <input v-model.number="heightInches" type="number" min="1" max="22" step="0.1" class="field__input--small" /> in</label>
        </div>

        <!-- Orientation -->
        <div class="field">
          <label class="field__label">Orientation</label>
          <div class="orientation-group">
            <button
              class="orientation-btn"
              :class="{ active: orientation === 'portrait' }"
              @mousedown.prevent="setOrientation('portrait')"
            >📄 Portrait</button>
            <button
              class="orientation-btn"
              :class="{ active: orientation === 'landscape' }"
              @mousedown.prevent="setOrientation('landscape')"
            >📄 Landscape</button>
          </div>
        </div>

        <!-- Margins -->
        <div class="field">
          <label class="field__label">Margins (inches)</label>
          <div class="margins-grid">
            <label>Top: <input v-model.number="marginTop" type="number" min="0" max="5" step="0.1" class="field__input--small" /></label>
            <label>Bottom: <input v-model.number="marginBottom" type="number" min="0" max="5" step="0.1" class="field__input--small" /></label>
            <label>Left: <input v-model.number="marginLeft" type="number" min="0" max="5" step="0.1" class="field__input--small" /></label>
            <label>Right: <input v-model.number="marginRight" type="number" min="0" max="5" step="0.1" class="field__input--small" /></label>
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
import type { SectionProperties } from '@eigenpal/docx-core/types/document';

const TWIPS_PER_INCH = 1440;

const props = defineProps<{
  isOpen: boolean;
  sectionProperties?: SectionProperties | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'apply', props: Partial<SectionProperties>): void;
}>();

const pageSizes = [
  { label: 'Letter (8.5" × 11")', width: 12240, height: 15840 },
  { label: 'A4 (210mm × 297mm)', width: 11906, height: 16838 },
  { label: 'Legal (8.5" × 14")', width: 12240, height: 20160 },
  { label: 'A3', width: 16838, height: 23811 },
  { label: 'A5', width: 8391, height: 11906 },
];

const selectedSize = ref('Letter (8.5" × 11")');
const orientation = ref<'portrait' | 'landscape'>('portrait');
const widthInches = ref(8.5);
const heightInches = ref(11);
const marginTop = ref(1.0);
const marginBottom = ref(1.0);
const marginLeft = ref(1.0);
const marginRight = ref(1.0);

function twipsToInches(twips: number): number {
  return Math.round((twips / TWIPS_PER_INCH) * 10) / 10;
}

function inchesToTwips(inches: number): number {
  return Math.round(inches * TWIPS_PER_INCH);
}

watch(() => props.isOpen, (open) => {
  if (!open) return;
  const sp = props.sectionProperties;
  if (sp) {
    const w = sp.pageWidth || 12240;
    const h = sp.pageHeight || 15840;
    widthInches.value = twipsToInches(w);
    heightInches.value = twipsToInches(h);
    orientation.value = w > h ? 'landscape' : 'portrait';
    marginTop.value = twipsToInches(sp.marginTop || 1440);
    marginBottom.value = twipsToInches(sp.marginBottom || 1440);
    marginLeft.value = twipsToInches(sp.marginLeft || 1440);
    marginRight.value = twipsToInches(sp.marginRight || 1440);

    // Try to match a preset
    const match = pageSizes.find(s =>
      (s.width === w && s.height === h) || (s.width === h && s.height === w)
    );
    selectedSize.value = match?.label || 'custom';
  }
});

function onSizeChange() {
  const preset = pageSizes.find(s => s.label === selectedSize.value);
  if (preset) {
    if (orientation.value === 'landscape') {
      widthInches.value = twipsToInches(preset.height);
      heightInches.value = twipsToInches(preset.width);
    } else {
      widthInches.value = twipsToInches(preset.width);
      heightInches.value = twipsToInches(preset.height);
    }
  }
}

function setOrientation(o: 'portrait' | 'landscape') {
  if (o === orientation.value) return;
  orientation.value = o;
  // Swap width and height
  const tmp = widthInches.value;
  widthInches.value = heightInches.value;
  heightInches.value = tmp;
}

function close() { emit('close'); }

function apply() {
  emit('apply', {
    pageWidth: inchesToTwips(widthInches.value),
    pageHeight: inchesToTwips(heightInches.value),
    marginTop: inchesToTwips(marginTop.value),
    marginBottom: inchesToTwips(marginBottom.value),
    marginLeft: inchesToTwips(marginLeft.value),
    marginRight: inchesToTwips(marginRight.value),
  });
  close();
}
</script>

<style scoped>
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 300; display: flex; align-items: center; justify-content: center; }
.dialog { background: #fff; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.2); min-width: 380px; max-width: 90vw; }
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
.field__select { width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; background: #fff; }
.field__input--small { width: 60px; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; }
.field-row { display: flex; gap: 12px; font-size: 12px; color: #4b5563; }
.orientation-group { display: flex; gap: 8px; }
.orientation-btn { padding: 8px 16px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; cursor: pointer; font-size: 13px; }
.orientation-btn.active { background: #e0e7ff; border-color: #818cf8; color: #3730a3; }
.margins-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; color: #4b5563; }
</style>
