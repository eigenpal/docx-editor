<template>
  <div v-if="isOpen" class="ipd-overlay" @mousedown.self="$emit('close')">
    <div class="ipd-dialog" @keydown.escape="$emit('close')">
      <div class="ipd-dialog__header">Image Position</div>

      <div class="ipd-dialog__body">
        <!-- Horizontal -->
        <fieldset class="ipd-fieldset">
          <legend class="ipd-legend">Horizontal</legend>
          <div class="ipd-row">
            <label class="ipd-label">Mode</label>
            <select v-model="hMode" class="ipd-select">
              <option value="align">Alignment</option>
              <option value="offset">Offset</option>
            </select>
          </div>
          <div v-if="hMode === 'align'" class="ipd-row">
            <label class="ipd-label">Align</label>
            <select v-model="hAlign" class="ipd-select">
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div v-else class="ipd-row">
            <label class="ipd-label">Offset (px)</label>
            <input v-model.number="hOffset" type="number" class="ipd-input" />
          </div>
          <div class="ipd-row">
            <label class="ipd-label">Relative to</label>
            <select v-model="hRelativeTo" class="ipd-select">
              <option value="page">Page</option>
              <option value="column">Column</option>
              <option value="margin">Margin</option>
              <option value="character">Character</option>
            </select>
          </div>
        </fieldset>

        <!-- Vertical -->
        <fieldset class="ipd-fieldset">
          <legend class="ipd-legend">Vertical</legend>
          <div class="ipd-row">
            <label class="ipd-label">Mode</label>
            <select v-model="vMode" class="ipd-select">
              <option value="align">Alignment</option>
              <option value="offset">Offset</option>
            </select>
          </div>
          <div v-if="vMode === 'align'" class="ipd-row">
            <label class="ipd-label">Align</label>
            <select v-model="vAlign" class="ipd-select">
              <option value="top">Top</option>
              <option value="center">Center</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
          <div v-else class="ipd-row">
            <label class="ipd-label">Offset (px)</label>
            <input v-model.number="vOffset" type="number" class="ipd-input" />
          </div>
          <div class="ipd-row">
            <label class="ipd-label">Relative to</label>
            <select v-model="vRelativeTo" class="ipd-select">
              <option value="page">Page</option>
              <option value="margin">Margin</option>
              <option value="paragraph">Paragraph</option>
              <option value="line">Line</option>
            </select>
          </div>
        </fieldset>

        <!-- Distance from text -->
        <fieldset class="ipd-fieldset">
          <legend class="ipd-legend">Distance from text (px)</legend>
          <div class="ipd-row">
            <label class="ipd-label">Top</label>
            <input v-model.number="distTop" type="number" class="ipd-input" min="0" />
            <label class="ipd-label" style="width:60px">Bottom</label>
            <input v-model.number="distBottom" type="number" class="ipd-input" min="0" />
          </div>
          <div class="ipd-row">
            <label class="ipd-label">Left</label>
            <input v-model.number="distLeft" type="number" class="ipd-input" min="0" />
            <label class="ipd-label" style="width:60px">Right</label>
            <input v-model.number="distRight" type="number" class="ipd-input" min="0" />
          </div>
        </fieldset>
      </div>

      <div class="ipd-dialog__footer">
        <button class="ipd-btn" @click="$emit('close')">Cancel</button>
        <button class="ipd-btn ipd-btn--primary" @click="apply">Apply</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

export interface ImagePositionData {
  horizontal?: { relativeTo?: string; posOffset?: number; align?: string };
  vertical?: { relativeTo?: string; posOffset?: number; align?: string };
  distTop?: number;
  distBottom?: number;
  distLeft?: number;
  distRight?: number;
}

const props = defineProps<{
  isOpen: boolean;
  currentData?: ImagePositionData;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'apply', data: ImagePositionData): void;
}>();

const hMode = ref<'align' | 'offset'>('align');
const hAlign = ref('left');
const hOffset = ref(0);
const hRelativeTo = ref('column');
const vMode = ref<'align' | 'offset'>('align');
const vAlign = ref('top');
const vOffset = ref(0);
const vRelativeTo = ref('paragraph');
const distTop = ref(0);
const distBottom = ref(0);
const distLeft = ref(0);
const distRight = ref(0);

watch(() => props.isOpen, (open) => {
  if (!open) return;
  const d = props.currentData;
  if (d?.horizontal?.align) { hMode.value = 'align'; hAlign.value = d.horizontal.align; }
  else if (d?.horizontal?.posOffset != null) { hMode.value = 'offset'; hOffset.value = d.horizontal.posOffset; }
  hRelativeTo.value = d?.horizontal?.relativeTo ?? 'column';
  if (d?.vertical?.align) { vMode.value = 'align'; vAlign.value = d.vertical.align; }
  else if (d?.vertical?.posOffset != null) { vMode.value = 'offset'; vOffset.value = d.vertical.posOffset; }
  vRelativeTo.value = d?.vertical?.relativeTo ?? 'paragraph';
  distTop.value = d?.distTop ?? 0;
  distBottom.value = d?.distBottom ?? 0;
  distLeft.value = d?.distLeft ?? 0;
  distRight.value = d?.distRight ?? 0;
});

function apply() {
  const data: ImagePositionData = {
    horizontal: {
      relativeTo: hRelativeTo.value,
      ...(hMode.value === 'align' ? { align: hAlign.value } : { posOffset: hOffset.value }),
    },
    vertical: {
      relativeTo: vRelativeTo.value,
      ...(vMode.value === 'align' ? { align: vAlign.value } : { posOffset: vOffset.value }),
    },
    distTop: distTop.value,
    distBottom: distBottom.value,
    distLeft: distLeft.value,
    distRight: distRight.value,
  };
  emit('apply', data);
  emit('close');
}
</script>

<style scoped>
.ipd-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 10000; }
.ipd-dialog { background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); width: 420px; max-width: 90vw; }
.ipd-dialog__header { padding: 16px 20px 12px; border-bottom: 1px solid #e5e7eb; font-size: 16px; font-weight: 600; color: #1f2937; }
.ipd-dialog__body { padding: 12px 20px; display: flex; flex-direction: column; gap: 12px; max-height: 60vh; overflow-y: auto; }
.ipd-dialog__footer { padding: 12px 20px 16px; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 8px; }
.ipd-fieldset { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; margin: 0; }
.ipd-legend { font-size: 12px; font-weight: 600; color: #4b5563; padding: 0 4px; }
.ipd-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.ipd-row:last-child { margin-bottom: 0; }
.ipd-label { width: 70px; font-size: 13px; color: #6b7280; flex-shrink: 0; }
.ipd-input, .ipd-select { flex: 1; padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; }
.ipd-btn { padding: 6px 16px; font-size: 13px; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; background: #fff; }
.ipd-btn--primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
</style>
