<template>
  <div v-if="isVisible" class="ai-preview">
    <div class="ai-preview__header">
      <span class="ai-preview__title">{{ actionLabel }}</span>
      <button class="ai-preview__close" @click="$emit('reject')">&#x2715;</button>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="ai-preview__loading">
      <span class="ai-preview__spinner" />
      <span>Processing...</span>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="ai-preview__error">
      <span>{{ error }}</span>
      <button v-if="showRetry" class="ai-preview__retry" @mousedown.prevent="$emit('retry')">Retry</button>
    </div>

    <!-- Diff view -->
    <div v-else class="ai-preview__content">
      <div v-if="showDiff" class="ai-preview__diff">
        <div class="ai-preview__diff-label">Original:</div>
        <div class="ai-preview__diff-text ai-preview__diff-text--old">{{ originalText }}</div>
        <div class="ai-preview__diff-label">Suggested:</div>
        <div class="ai-preview__diff-text ai-preview__diff-text--new">{{ responseText }}</div>
      </div>
      <div v-else class="ai-preview__result">
        {{ responseText }}
      </div>

      <!-- Edit mode -->
      <textarea
        v-if="allowEdit && isEditing"
        v-model="editedText"
        class="ai-preview__textarea"
        rows="4"
      />
    </div>

    <!-- Footer actions -->
    <div v-if="!isLoading && !error" class="ai-preview__footer">
      <button v-if="allowEdit && !isEditing" class="ai-preview__btn" @mousedown.prevent="isEditing = true">Edit</button>
      <button class="ai-preview__btn" @mousedown.prevent="$emit('reject')">Discard</button>
      <button class="ai-preview__btn ai-preview__btn--primary" @mousedown.prevent="handleAccept">Accept</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    isVisible: boolean;
    originalText: string;
    responseText: string;
    action: string;
    isLoading: boolean;
    error?: string;
    allowEdit?: boolean;
    showDiff?: boolean;
    showRetry?: boolean;
  }>(),
  {
    allowEdit: true,
    showDiff: true,
    showRetry: true,
  }
);

const emit = defineEmits<{
  (e: 'accept', text: string): void;
  (e: 'reject'): void;
  (e: 'retry'): void;
}>();

const isEditing = ref(false);
const editedText = ref('');

const actionLabels: Record<string, string> = {
  rewrite: 'Rewrite',
  expand: 'Expand',
  summarize: 'Summary',
  translate: 'Translation',
  explain: 'Explanation',
  fixGrammar: 'Grammar Fix',
  makeFormal: 'Formal Version',
  makeCasual: 'Casual Version',
  custom: 'AI Response',
  askAI: 'AI Response',
};

const actionLabel = computed(() => actionLabels[props.action] || 'AI Response');

watch(() => props.responseText, (text) => {
  editedText.value = text;
  isEditing.value = false;
});

function handleAccept() {
  emit('accept', isEditing.value ? editedText.value : props.responseText);
}
</script>

<style scoped>
.ai-preview {
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  width: 420px;
  max-width: 90vw;
  overflow: hidden;
}
.ai-preview__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #f0f4ff;
  border-bottom: 1px solid #d0daf0;
}
.ai-preview__title { font-size: 13px; font-weight: 600; color: #1a73e8; }
.ai-preview__close { border: none; background: transparent; cursor: pointer; font-size: 14px; color: #6b7280; }
.ai-preview__loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px 14px;
  color: #6b7280;
  font-size: 13px;
}
.ai-preview__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.ai-preview__error {
  padding: 16px 14px;
  color: #dc2626;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ai-preview__retry {
  padding: 4px 10px;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
}
.ai-preview__content { padding: 12px 14px; }
.ai-preview__diff-label { font-size: 11px; font-weight: 600; color: #6b7280; margin-bottom: 4px; text-transform: uppercase; }
.ai-preview__diff-text { font-size: 13px; line-height: 1.5; padding: 8px 10px; border-radius: 4px; margin-bottom: 10px; }
.ai-preview__diff-text--old { background: #fef2f2; color: #991b1b; }
.ai-preview__diff-text--new { background: #f0fdf4; color: #166534; }
.ai-preview__result { font-size: 13px; line-height: 1.5; color: #1f2937; }
.ai-preview__textarea {
  width: 100%;
  padding: 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  margin-top: 8px;
  outline: none;
}
.ai-preview__textarea:focus { border-color: #3b82f6; }
.ai-preview__footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 10px 14px;
  border-top: 1px solid #e5e7eb;
}
.ai-preview__btn {
  padding: 5px 14px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
}
.ai-preview__btn:hover { background: #f3f4f6; }
.ai-preview__btn--primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
.ai-preview__btn--primary:hover { background: #1557b0; }
</style>
