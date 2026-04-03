<template>
  <div :class="['tc-card', { 'tc-card--expanded': expanded }]" @mousedown.stop>
    <!-- Header -->
    <div class="tc-card__header">
      <div class="tc-card__avatar" :style="{ backgroundColor: avatarColor }">
        {{ initials }}
      </div>
      <div class="tc-card__meta">
        <span class="tc-card__author">{{ change.author }}</span>
        <span class="tc-card__date">{{ formattedDate }}</span>
      </div>
    </div>

    <!-- Change description -->
    <div class="tc-card__body">
      <template v-if="change.type === 'replacement'">
        <span class="tc-card__label">Replaced </span>
        <span class="tc-card__deleted">{{ truncatedDeletedText }}</span>
        <span class="tc-card__label"> with </span>
        <span class="tc-card__inserted">{{ truncatedText }}</span>
      </template>
      <template v-else-if="change.type === 'insertion'">
        <span class="tc-card__label">Added </span>
        <span class="tc-card__inserted">{{ truncatedText }}</span>
      </template>
      <template v-else>
        <span class="tc-card__label">Deleted </span>
        <span class="tc-card__deleted">{{ truncatedText }}</span>
      </template>
    </div>

    <!-- Accept / Reject buttons -->
    <div v-if="expanded" class="tc-card__actions">
      <button class="tc-card__btn tc-card__btn--accept" @mousedown.prevent="$emit('accept', change.from, change.to)">
        &#x2713; Accept
      </button>
      <button class="tc-card__btn tc-card__btn--reject" @mousedown.prevent="$emit('reject', change.from, change.to)">
        &#x2715; Reject
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TrackedChangeEntry } from './sidebarUtils';
import { formatDate, getInitials, getAvatarColor, truncateText } from './sidebarUtils';

const props = defineProps<{
  change: TrackedChangeEntry;
  expanded: boolean;
}>();

defineEmits<{
  (e: 'accept', from: number, to: number): void;
  (e: 'reject', from: number, to: number): void;
}>();

const initials = computed(() => getInitials(props.change.author));
const avatarColor = computed(() => getAvatarColor(props.change.author));
const formattedDate = computed(() => formatDate(props.change.date));
const truncatedText = computed(() => truncateText(props.change.text));
const truncatedDeletedText = computed(() => truncateText(props.change.deletedText || ''));
</script>

<style scoped>
.tc-card {
  background: #fffbf0;
  border: 1px solid #f0e6d2;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: box-shadow 0.15s, background 0.15s;
}
.tc-card--expanded {
  background: #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  cursor: default;
}
.tc-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.tc-card__avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
}
.tc-card__meta { flex: 1; min-width: 0; }
.tc-card__author { font-size: 12px; font-weight: 600; color: #1f2937; display: block; }
.tc-card__date { font-size: 11px; color: #9ca3af; }
.tc-card__body { font-size: 13px; color: #374151; line-height: 1.4; }
.tc-card__label { color: #6b7280; }
.tc-card__inserted { color: #2e7d32; font-weight: 500; }
.tc-card__deleted { color: #c62828; text-decoration: line-through; font-weight: 500; }
.tc-card__actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #e5e7eb;
}
.tc-card__btn {
  flex: 1;
  padding: 5px 12px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  background: #fff;
}
.tc-card__btn--accept { color: #2e7d32; border-color: #a5d6a7; }
.tc-card__btn--accept:hover { background: #e8f5e9; }
.tc-card__btn--reject { color: #c62828; border-color: #ef9a9a; }
.tc-card__btn--reject:hover { background: #ffebee; }
</style>
