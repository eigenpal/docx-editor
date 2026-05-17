<!--
  AIResponsePreview — diff/loading/error preview for an AI action result.
  Migrated from packages/vue in the 1.0 train. Labels default to bundled
  English (`packages/agent-use/i18n/en.json`); pass `labels` to translate.
-->
<template>
  <!-- role=region (not dialog) — focus management for a real dialog
       (initial focus + return on close + trap) is a follow-up. -->
  <div
    v-if="isVisible"
    class="ai-preview"
    role="region"
    :aria-label="actionLabel"
    tabindex="-1"
    @keydown.esc.stop="emit('reject')"
  >
    <div class="ai-preview__header">
      <span class="ai-preview__title">{{ actionLabel }}</span>
      <button
        class="ai-preview__close"
        :aria-label="resolved.close"
        @click="emit('reject')"
      >
        &#x2715;
      </button>
    </div>

    <div v-if="isLoading" class="ai-preview__loading">
      <span class="ai-preview__spinner" />
      <span>{{ resolved.loading }}</span>
    </div>

    <div v-else-if="error" class="ai-preview__error">
      <span>{{ error }}</span>
      <button
        v-if="showRetry"
        class="ai-preview__retry"
        @mousedown.prevent="emit('retry')"
      >
        {{ resolved.retry }}
      </button>
    </div>

    <div v-else class="ai-preview__content">
      <div v-if="showDiff" class="ai-preview__diff">
        <div class="ai-preview__diff-label">{{ resolved.original }}</div>
        <div class="ai-preview__diff-text ai-preview__diff-text--old">{{ originalText }}</div>
        <div class="ai-preview__diff-label">{{ resolved.suggested }}</div>
        <div class="ai-preview__diff-text ai-preview__diff-text--new">{{ responseText }}</div>
      </div>
      <div v-else class="ai-preview__result">{{ responseText }}</div>

      <textarea
        v-if="allowEdit && isEditing"
        v-model="editedText"
        class="ai-preview__textarea"
        rows="4"
      />
    </div>

    <div v-if="!isLoading && !error" class="ai-preview__footer">
      <button
        v-if="allowEdit && !isEditing"
        class="ai-preview__btn"
        @mousedown.prevent="isEditing = true"
      >
        {{ resolved.edit }}
      </button>
      <button class="ai-preview__btn" @mousedown.prevent="emit('reject')">
        {{ resolved.discard }}
      </button>
      <button
        class="ai-preview__btn ai-preview__btn--primary"
        @mousedown.prevent="handleAccept"
      >
        {{ resolved.accept }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import en from '../../../i18n/en.json';

export interface AIResponsePreviewLabels {
  loading?: string;
  original?: string;
  suggested?: string;
  edit?: string;
  discard?: string;
  accept?: string;
  retry?: string;
  close?: string;
  /** Per-action title overrides (e.g. `{ rewrite: 'Перефразировать' }`). */
  actionTitles?: Partial<Record<string, string>>;
}

export interface AIResponsePreviewProps {
  isVisible: boolean;
  originalText: string;
  responseText: string;
  action: string;
  isLoading: boolean;
  error?: string;
  allowEdit?: boolean;
  showDiff?: boolean;
  showRetry?: boolean;
  labels?: AIResponsePreviewLabels;
}

const props = withDefaults(defineProps<AIResponsePreviewProps>(), {
  allowEdit: true,
  showDiff: true,
  showRetry: true,
  error: undefined,
  labels: () => ({}),
});

const emit = defineEmits<{
  (e: 'accept', text: string): void;
  (e: 'reject'): void;
  (e: 'retry'): void;
}>();

const isEditing = ref(false);
const editedText = ref('');

const resolved = computed(() => ({
  loading: props.labels?.loading ?? en.aiPreview.loading,
  original: props.labels?.original ?? en.aiPreview.original,
  suggested: props.labels?.suggested ?? en.aiPreview.suggested,
  edit: props.labels?.edit ?? en.aiPreview.edit,
  discard: props.labels?.discard ?? en.aiPreview.discard,
  accept: props.labels?.accept ?? en.aiPreview.accept,
  retry: props.labels?.retry ?? en.aiPreview.retry,
  close: props.labels?.close ?? en.aiPreview.close,
}));

const actionLabel = computed(() => {
  const override = props.labels?.actionTitles?.[props.action];
  if (override) return override;
  return (
    (en.aiPreview.labels as Record<string, string>)[props.action] ?? en.aiPreview.defaultTitle
  );
});

watch(
  () => props.responseText,
  (text) => {
    editedText.value = text;
    isEditing.value = false;
  }
);

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
/* #1557b0 on #f0f4ff is 5.8:1 (WCAG AA pass for normal text); was #1a73e8 ≈ 4.4:1 (fail). */
.ai-preview__title { font-size: 13px; font-weight: 600; color: #1557b0; }
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
