<template>
  <div class="tsg">
    <div class="tsg__grid">
      <button
        v-for="preset in presets"
        :key="preset.id"
        :class="['tsg__item', { 'tsg__item--selected': currentStyleId === preset.id }]"
        :title="presetName(preset)"
        @mousedown.prevent="$emit('apply', preset.id)"
      >
        <div class="tsg__preview">
          <div
            v-for="(cell, idx) in getPreviewCells(preset)"
            :key="idx"
            class="tsg__cell"
            :style="cell"
          />
        </div>
        <span class="tsg__name">{{ presetName(preset) }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '../../i18n';
import {
  BUILTIN_TABLE_STYLES,
  TABLE_STYLE_NAME_KEYS,
  getPreviewCells,
  type TableStylePreset,
} from '../tableStylePresets';

const { t } = useTranslation();

defineProps<{
  currentStyleId?: string | null;
}>();

defineEmits<{
  (e: 'apply', styleId: string): void;
}>();

const presets = BUILTIN_TABLE_STYLES;

function presetName(preset: TableStylePreset): string {
  const key = TABLE_STYLE_NAME_KEYS[preset.id];
  return key ? t(key) : preset.name;
}
</script>

<style scoped>
.tsg__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 6px;
  padding: 8px;
}
.tsg__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border: 2px solid transparent;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
.tsg__item:hover {
  border-color: #d1d5db;
}
.tsg__item--selected {
  border-color: #3b82f6;
  background: #eff6ff;
}
.tsg__preview {
  display: grid;
  grid-template-columns: repeat(3, 20px);
  grid-template-rows: repeat(4, 10px);
  gap: 0;
}
.tsg__cell {
  box-sizing: border-box;
}
.tsg__name {
  font-size: 9px;
  color: #6b7280;
  text-align: center;
  line-height: 1.2;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
