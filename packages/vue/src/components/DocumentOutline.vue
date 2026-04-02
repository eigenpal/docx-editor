<template>
  <div v-if="isOpen" class="doc-outline">
    <div class="doc-outline__header">
      <button class="doc-outline__back" @click="$emit('close')">←</button>
      <span class="doc-outline__title">Document Outline</span>
    </div>
    <div class="doc-outline__body">
      <div v-if="headings.length === 0" class="doc-outline__empty">
        No headings found
      </div>
      <button
        v-for="(h, i) in headings"
        :key="i"
        class="doc-outline__item"
        :style="{ paddingLeft: (12 + h.level * 16) + 'px' }"
        @mousedown.prevent="$emit('navigate', h.pmPos)"
      >{{ h.text || '(untitled)' }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { HeadingInfo } from '@eigenpal/docx-core/utils/headingCollector';

defineProps<{
  isOpen: boolean;
  headings: HeadingInfo[];
}>();

defineEmits<{
  (e: 'close'): void;
  (e: 'navigate', pmPos: number): void;
}>();
</script>

<style scoped>
.doc-outline {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 240px;
  background: #fff;
  border-right: 1px solid #e2e8f0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  box-shadow: 2px 0 8px rgba(0,0,0,0.08);
  animation: slideIn 0.15s ease-out;
}
@keyframes slideIn {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}
.doc-outline__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #e5e7eb;
}
.doc-outline__back {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  color: #6b7280;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.doc-outline__back:hover { background: #f3f4f6; }
.doc-outline__title { font-weight: 600; font-size: 13px; color: #1f2937; }
.doc-outline__body { flex: 1; overflow-y: auto; padding: 4px 0; }
.doc-outline__empty { padding: 24px 16px; text-align: center; color: #9ca3af; font-size: 13px; }
.doc-outline__item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: #374151;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.doc-outline__item:hover { background: #f3f4f6; }
</style>
