<!--
  Vue port of packages/react/src/components/DocxEditorHelpers.tsx —
  small presentational components for loading, placeholder, and
  error states. Same styling (spinner / muted text / centered).

  This is a single SFC bundling all three helpers via a `kind` prop;
  React ships them as separate functions but consumers can pick the
  variant they want here too via the prop.
-->
<template>
  <div class="docx-editor-helpers" :class="`docx-editor-helpers--${kind}`">
    <template v-if="kind === 'loading'">
      <div class="docx-editor-helpers__spinner" />
      <div class="docx-editor-helpers__text">{{ message ?? 'Loading document...' }}</div>
    </template>
    <template v-else-if="kind === 'placeholder'">
      <div class="docx-editor-helpers__icon">📄</div>
      <div class="docx-editor-helpers__text">{{ message ?? 'No document loaded' }}</div>
    </template>
    <template v-else-if="kind === 'error'">
      <div class="docx-editor-helpers__icon">⚠️</div>
      <div class="docx-editor-helpers__text">{{ message ?? 'Failed to load document' }}</div>
      <button
        v-if="onRetry"
        class="docx-editor-helpers__retry"
        @click.prevent="onRetry"
      >Retry</button>
    </template>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  kind: 'loading' | 'placeholder' | 'error';
  message?: string;
  onRetry?: () => void;
}>();
</script>

<style scoped>
.docx-editor-helpers {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 20px;
  color: #5f6368;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.docx-editor-helpers__spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e5e7eb;
  border-top-color: #1a73e8;
  border-radius: 50%;
  animation: docx-helpers-spin 0.8s linear infinite;
}
.docx-editor-helpers__icon {
  font-size: 36px;
}
.docx-editor-helpers__text {
  font-size: 14px;
}
.docx-editor-helpers__retry {
  padding: 6px 16px;
  font-size: 14px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}
.docx-editor-helpers__retry:hover { background: #f1f3f4; }
@keyframes docx-helpers-spin {
  to { transform: rotate(360deg); }
}
</style>
