<!--
  Vue port of the spinner variant from
  packages/react/src/components/ui/LoadingIndicator.tsx. The React
  component supports five variants (spinner / dots / bar / pulse /
  progress); Vue covers the two we actually use today (spinner +
  bar with optional progress) so the surface stays small. Add the
  others if the parity sweep flags them as needed.
-->
<template>
  <div
    v-if="isLoading"
    :class="['docx-loading', `docx-loading--${variant}`, `docx-loading--${size}`, { 'docx-loading--overlay': overlay }]"
    role="status"
    :aria-label="message"
  >
    <span v-if="variant === 'spinner'" class="docx-loading__spinner" />
    <div v-else-if="variant === 'bar' || variant === 'progress'" class="docx-loading__bar">
      <div
        class="docx-loading__bar-fill"
        :style="variant === 'progress' && progress != null ? { width: progress + '%' } : undefined"
      />
    </div>
    <span v-if="message" class="docx-loading__message">{{ message }}</span>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    isLoading: boolean;
    variant?: 'spinner' | 'bar' | 'progress';
    size?: 'small' | 'medium' | 'large';
    message?: string;
    overlay?: boolean;
    /** Progress percentage 0-100. Only honored when variant='progress'. */
    progress?: number | null;
  }>(),
  { variant: 'spinner', size: 'medium', overlay: false, progress: null }
);
</script>

<style scoped>
.docx-loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--doc-text-muted);
  font-size: 13px;
}
.docx-loading--overlay {
  position: fixed;
  inset: 0;
  /* Dark modal backdrop with light text, matching React's overlay
     (rgba(0,0,0,0.5) + white message). */
  background: var(--doc-overlay);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.docx-loading--overlay .docx-loading__message {
  color: var(--doc-on-primary);
}
.docx-loading__spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--doc-border);
  border-top-color: var(--doc-primary);
  border-radius: 50%;
  animation: docx-loading-spin 0.8s linear infinite;
}
.docx-loading--small .docx-loading__spinner { width: 14px; height: 14px; border-width: 2px; }
.docx-loading--large .docx-loading__spinner { width: 32px; height: 32px; border-width: 3px; }
.docx-loading__bar {
  width: 100%;
  height: 4px;
  background: var(--doc-border);
  border-radius: 2px;
  overflow: hidden;
}
.docx-loading__bar-fill {
  height: 100%;
  background: var(--doc-primary);
  width: 100%;
  transition: width 0.2s ease;
  animation: docx-loading-bar 1.5s linear infinite;
}
.docx-loading--progress .docx-loading__bar-fill { animation: none; }
@keyframes docx-loading-spin {
  to { transform: rotate(360deg); }
}
@keyframes docx-loading-bar {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
</style>
