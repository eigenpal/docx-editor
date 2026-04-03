<template>
  <div v-if="isOpen" class="fnpd-overlay" @mousedown.self="$emit('close')">
    <div class="fnpd-dialog" @keydown.escape="$emit('close')">
      <div class="fnpd-dialog__header">Footnote & Endnote Properties</div>

      <div class="fnpd-dialog__body">
        <!-- Footnotes -->
        <fieldset class="fnpd-fieldset">
          <legend class="fnpd-legend">Footnotes</legend>
          <div class="fnpd-row">
            <label class="fnpd-label">Position</label>
            <select v-model="fnPosition" class="fnpd-select">
              <option value="pageBottom">Bottom of page</option>
              <option value="beneathText">Below text</option>
            </select>
          </div>
          <div class="fnpd-row">
            <label class="fnpd-label">Number format</label>
            <select v-model="fnNumFmt" class="fnpd-select">
              <option v-for="fmt in numberFormats" :key="fmt.value" :value="fmt.value">{{ fmt.label }}</option>
            </select>
          </div>
          <div class="fnpd-row">
            <label class="fnpd-label">Start at</label>
            <input v-model.number="fnStart" type="number" class="fnpd-input" min="1" />
          </div>
          <div class="fnpd-row">
            <label class="fnpd-label">Numbering</label>
            <select v-model="fnRestart" class="fnpd-select">
              <option value="continuous">Continuous</option>
              <option value="eachSect">Restart each section</option>
              <option value="eachPage">Restart each page</option>
            </select>
          </div>
        </fieldset>

        <!-- Endnotes -->
        <fieldset class="fnpd-fieldset">
          <legend class="fnpd-legend">Endnotes</legend>
          <div class="fnpd-row">
            <label class="fnpd-label">Position</label>
            <select v-model="enPosition" class="fnpd-select">
              <option value="docEnd">End of document</option>
              <option value="sectEnd">End of section</option>
            </select>
          </div>
          <div class="fnpd-row">
            <label class="fnpd-label">Number format</label>
            <select v-model="enNumFmt" class="fnpd-select">
              <option v-for="fmt in numberFormats" :key="fmt.value" :value="fmt.value">{{ fmt.label }}</option>
            </select>
          </div>
          <div class="fnpd-row">
            <label class="fnpd-label">Start at</label>
            <input v-model.number="enStart" type="number" class="fnpd-input" min="1" />
          </div>
          <div class="fnpd-row">
            <label class="fnpd-label">Numbering</label>
            <select v-model="enRestart" class="fnpd-select">
              <option value="continuous">Continuous</option>
              <option value="eachSect">Restart each section</option>
            </select>
          </div>
        </fieldset>
      </div>

      <div class="fnpd-dialog__footer">
        <button class="fnpd-btn" @click="$emit('close')">Cancel</button>
        <button class="fnpd-btn fnpd-btn--primary" @click="apply">Apply</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { FootnoteProperties, EndnoteProperties } from '@eigenpal/docx-core/types/content';

const props = defineProps<{
  isOpen: boolean;
  footnotePr?: FootnoteProperties;
  endnotePr?: EndnoteProperties;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'apply', footnotePr: FootnoteProperties, endnotePr: EndnoteProperties): void;
}>();

const numberFormats = [
  { value: 'decimal', label: '1, 2, 3...' },
  { value: 'lowerLetter', label: 'a, b, c...' },
  { value: 'upperLetter', label: 'A, B, C...' },
  { value: 'lowerRoman', label: 'i, ii, iii...' },
  { value: 'upperRoman', label: 'I, II, III...' },
  { value: 'chicago', label: '*, \u2020, \u2021...' },
];

const fnPosition = ref('pageBottom');
const fnNumFmt = ref('decimal');
const fnStart = ref(1);
const fnRestart = ref('continuous');
const enPosition = ref('docEnd');
const enNumFmt = ref('lowerRoman');
const enStart = ref(1);
const enRestart = ref('continuous');

watch(() => props.isOpen, (open) => {
  if (!open) return;
  fnPosition.value = props.footnotePr?.position ?? 'pageBottom';
  fnNumFmt.value = props.footnotePr?.numFmt ?? 'decimal';
  fnStart.value = props.footnotePr?.numStart ?? 1;
  fnRestart.value = props.footnotePr?.numRestart ?? 'continuous';
  enPosition.value = props.endnotePr?.position ?? 'docEnd';
  enNumFmt.value = props.endnotePr?.numFmt ?? 'lowerRoman';
  enStart.value = props.endnotePr?.numStart ?? 1;
  enRestart.value = props.endnotePr?.numRestart ?? 'continuous';
});

function apply() {
  emit('apply',
    { position: fnPosition.value as any, numFmt: fnNumFmt.value as any, numStart: fnStart.value, numRestart: fnRestart.value as any },
    { position: enPosition.value as any, numFmt: enNumFmt.value as any, numStart: enStart.value, numRestart: enRestart.value as any },
  );
  emit('close');
}
</script>

<style scoped>
.fnpd-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 10000; }
.fnpd-dialog { background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); width: 440px; max-width: 90vw; }
.fnpd-dialog__header { padding: 16px 20px 12px; border-bottom: 1px solid #e5e7eb; font-size: 16px; font-weight: 600; color: #1f2937; }
.fnpd-dialog__body { padding: 12px 20px; display: flex; flex-direction: column; gap: 12px; max-height: 60vh; overflow-y: auto; }
.fnpd-dialog__footer { padding: 12px 20px 16px; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 8px; }
.fnpd-fieldset { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; margin: 0; }
.fnpd-legend { font-size: 12px; font-weight: 600; color: #4b5563; padding: 0 4px; }
.fnpd-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.fnpd-row:last-child { margin-bottom: 0; }
.fnpd-label { width: 100px; font-size: 13px; color: #6b7280; flex-shrink: 0; }
.fnpd-input, .fnpd-select { flex: 1; padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; }
.fnpd-btn { padding: 6px 16px; font-size: 13px; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; background: #fff; }
.fnpd-btn--primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
</style>
