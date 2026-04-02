<template>
  <div v-if="isOpen" class="tpd-overlay" @mousedown.self="$emit('close')">
    <div class="tpd-dialog" @keydown.escape="$emit('close')" @keydown.enter="apply">
      <div class="tpd-dialog__header">Table Properties</div>
      <div class="tpd-dialog__body">
        <div class="tpd-row">
          <label class="tpd-label">Width type</label>
          <select v-model="widthType" class="tpd-select">
            <option value="auto">Auto</option>
            <option value="dxa">Fixed (twips)</option>
            <option value="pct">Percentage</option>
          </select>
        </div>
        <div v-if="widthType !== 'auto'" class="tpd-row">
          <label class="tpd-label">Width</label>
          <input v-model.number="width" type="number" class="tpd-input" :min="0" :step="widthType === 'pct' ? 5 : 100" />
          <span class="tpd-unit">{{ widthType === 'pct' ? '50ths of %' : 'twips' }}</span>
        </div>
        <div class="tpd-row">
          <label class="tpd-label">Alignment</label>
          <select v-model="justification" class="tpd-select">
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      </div>
      <div class="tpd-dialog__footer">
        <button class="tpd-btn" @click="$emit('close')">Cancel</button>
        <button class="tpd-btn tpd-btn--primary" @click="apply">Apply</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

export interface TableProperties {
  width?: number | null;
  widthType?: string | null;
  justification?: 'left' | 'center' | 'right' | null;
}

const props = defineProps<{
  isOpen: boolean;
  currentProps?: { width?: number; widthType?: string; justification?: string };
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'apply', props: TableProperties): void;
}>();

const width = ref(0);
const widthType = ref('auto');
const justification = ref('left');

watch(() => props.isOpen, (open) => {
  if (open) {
    width.value = props.currentProps?.width ?? 0;
    widthType.value = props.currentProps?.widthType ?? 'auto';
    justification.value = props.currentProps?.justification ?? 'left';
  }
});

function apply() {
  const result: TableProperties = {
    justification: justification.value as 'left' | 'center' | 'right',
  };
  if (widthType.value === 'auto') {
    result.width = null;
    result.widthType = 'auto';
  } else {
    result.width = width.value;
    result.widthType = widthType.value;
  }
  emit('apply', result);
  emit('close');
}
</script>

<style scoped>
.tpd-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 10000; }
.tpd-dialog { background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); min-width: 360px; max-width: 440px; width: 100%; }
.tpd-dialog__header { padding: 16px 20px 12px; border-bottom: 1px solid #e5e7eb; font-size: 16px; font-weight: 600; color: #1f2937; }
.tpd-dialog__body { padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }
.tpd-dialog__footer { padding: 12px 20px 16px; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 8px; }
.tpd-row { display: flex; align-items: center; gap: 12px; }
.tpd-label { width: 80px; font-size: 13px; color: #6b7280; }
.tpd-input, .tpd-select { flex: 1; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; }
.tpd-unit { font-size: 11px; color: #9ca3af; }
.tpd-btn { padding: 6px 16px; font-size: 13px; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; background: #fff; }
.tpd-btn--primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
</style>
